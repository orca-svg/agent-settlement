// 비서끼리 처리(#9): 청구서 보내기, 각자의 규칙대로 답하기, 이의, 송금 안내.
// 상태는 Store(invoices·disputes·transfers)에 두고, 사람에게 보이는 일은 비서 기록과 pendingActions(현재 상태에서 계산)로 알린다.
// LLM은 중재안만 낸다. 금액은 public/core.js가 계산한다.
import { randomUUID } from 'node:crypto';
import { ledger, won } from '../../public/core.js';
import { topic, subj, obj } from '../../public/ui.js';
import { HttpError } from '../http.mjs';
import { isFlagged } from '../actions.mjs';
import { evaluateInvoice } from './rules.mjs';

const OPEN = ['open', 'proposed'];
const DEFAULT_RULES = { autoAccept: 0, sendWhen: 'now', onDispute: 'ask' };

export function createOrchestrator({ store, gemini = null, clock = () => new Date(), evidenceFor = async () => [] }) {
  const say = (roomId, ev) => store.appendEvent(roomId, ev);
  const settingsOf = async (uid) => (await store.get('agents', uid)) ?? { uid, memory: [], rules: DEFAULT_RULES, payout: null };

  async function load(roomId) {
    const room = await store.get('rooms', roomId);
    if (!room) throw new HttpError(404, '방을 찾을 수 없어요');
    const expenses = await store.list('expenses', { roomId });
    const name = (uid) => room.members.find((m) => m.uid === uid)?.name ?? uid;
    return { room, expenses, name };
  }

  // 이 사람이 함께한 지출 중 근거가 있는 첫 지출
  async function firstEvidence(uid, room, expenses) {
    for (const exp of expenses.filter((e) => e.present.includes(uid))) {
      const evidence = await evidenceFor(uid, exp, room);
      if (evidence.length) return { exp, evidence };
    }
    return null;
  }

  const claimFrom = (name, { evidence }) => {
    const left = evidence.find((e) => e.kind === 'left_at' && e.time);
    return left
      ? `${topic(name)} ${left.time}에 자리를 떠났어요. 그 뒤에 시킨 것까지 똑같이 나누는 건 맞지 않아요.`
      : `${subj(name)} 이 지출을 모두 함께 쓰지 않았다는 근거가 있어요.`;
  };

  const acceptedText = (net) => (net < 0 ? `${won(-net)} 청구서를 확인했어요` : net > 0 ? `받을 돈 ${won(net)}을 확인했어요` : '정산할 금액이 없어요');

  // 방 version마다 한 번만 보낸다. 같은 version이면 이미 보낸 청구서를 돌려준다(두 번 눌러도 중복 없음)
  async function sendInvoices(roomId, actorUid) {
    const { room, expenses, name } = await load(roomId);
    if (expenses.some((e) => (e.items ?? []).some((it) => isFlagged(e.alloc?.[it.id])))) throw new HttpError(409, '확인이 필요한 줄이 있어요');
    const all = await store.list('invoices', { roomId });
    const current = all.filter((i) => i.version === room.version);
    if (current.length) return { version: room.version, invoices: current };

    const stale = all.filter((i) => i.version < room.version && ['pending', 'accepted', 'asked'].includes(i.status));
    for (const i of stale) await store.put('invoices', { ...i, status: 'superseded' });
    if (stale.length) await say(roomId, { from: actorUid, to: 'all', kind: 'invoices_superseded', text: '지출이 바뀌어 다시 보내요' });

    const rows = ledger(room, expenses, room.policy);
    await say(roomId, { from: actorUid, to: 'all', kind: 'invoices_sent', text: `지출 ${expenses.length}건으로 각자의 비서에게 청구서를 보냈어요`, meta: `version ${room.version}` });
    const invoices = [];
    for (const m of room.members) {
      const r = rows[m.uid];
      const base = { id: `${roomId}:v${room.version}:${m.uid}`, roomId, version: room.version, to: m.uid, owed: r.owed, paid: r.paid, net: r.net };
      const found = await firstEvidence(m.uid, room, expenses);
      const { decision, reasons } = evaluateInvoice({ invoice: base, settings: await settingsOf(m.uid), evidence: found?.evidence ?? [] });
      const invoice = {
        ...base,
        status: { accept: 'accepted', ask: 'asked', dispute: 'disputed' }[decision],
        decidedBy: decision === 'ask' ? null : 'agent',
        reasons,
      };
      await store.put('invoices', invoice);
      invoices.push(invoice);
      if (decision === 'accept') {
        await say(roomId, { from: m.uid, to: actorUid, kind: 'invoice_accepted', text: acceptedText(r.net), meta: `규칙 · ${reasons.join(' · ')}` });
      } else if (decision === 'ask') {
        await say(roomId, {
          from: m.uid, to: m.uid, kind: 'invoice_asked', text: `${won(-r.net)} 청구서가 왔어요. ${reasons[0]}`,
          action: { type: 'answer_invoice', ref: invoice.id, for: m.uid },
        });
      } else {
        await raiseDispute(roomId, { by: m.uid, expenseId: found.exp.id, claim: claimFrom(name(m.uid), found), evidence: found.evidence });
      }
    }
    await settleIfReady(roomId);
    return { version: room.version, invoices };
  }

  // 한도를 넘어 주인에게 물은 청구서에 본인이 답한다
  async function answerInvoice(roomId, invoiceId, actorUid, { decision, expenseId, claim } = {}) {
    const invoice = await store.get('invoices', invoiceId);
    if (!invoice || invoice.roomId !== roomId) throw new HttpError(404, '청구서를 찾을 수 없어요');
    if (invoice.to !== actorUid) throw new HttpError(403, '내 청구서에만 답할 수 있어요');
    if (invoice.status !== 'asked') throw new HttpError(409, '이미 답했거나 바뀐 청구서예요');
    if (!['accept', 'dispute'].includes(decision)) throw new HttpError(400, '수락하거나 이의를 제기해 주세요');
    if (decision === 'dispute') await raiseDispute(roomId, { by: actorUid, expenseId, claim, evidence: [] });
    const saved = { ...invoice, status: decision === 'accept' ? 'accepted' : 'disputed', decidedBy: 'human' };
    await store.put('invoices', saved);
    if (decision === 'accept') await say(roomId, { from: actorUid, to: 'all', kind: 'invoice_accepted', text: acceptedText(invoice.net), meta: 'human: 확인' });
    await settleIfReady(roomId);
    return { invoice: saved };
  }

  // 같은 사람이 같은 지출에 이미 낸 이의가 열려 있으면 그것을 쓴다(다시 보내도 중복 없음)
  async function raiseDispute(roomId, { by, expenseId, claim, evidence = [] }) {
    const { expenses } = await load(roomId);
    const exp = expenses.find((e) => e.id === expenseId);
    if (!exp) throw new HttpError(400, '이의를 제기할 지출을 골라 주세요');
    if (!String(claim ?? '').trim()) throw new HttpError(400, '무엇이 맞지 않는지 적어 주세요');
    const existing = (await store.list('disputes', { roomId })).find((d) => d.by === by && d.expenseId === expenseId && OPEN.includes(d.status));
    if (existing) return existing;
    const dispute = { id: `${roomId}:d-${randomUUID().slice(0, 8)}`, roomId, expenseId, by, claim: String(claim).trim().slice(0, 300), evidence, status: 'open', agreedBy: [] };
    await store.put('disputes', dispute);
    await say(roomId, {
      from: by, to: exp.payer, kind: 'dispute_raised', text: `${obj(`‘${exp.title}’`)} 다시 나누자고 이의를 제기했어요`,
      ...(evidence.length ? { meta: `근거: ${evidence.map((e) => e.summary).join(' · ')}` } : {}),
    });
    return dispute;
  }

  // 지금 version의 청구서에 묻는 중인 것도, 열린 이의도 없으면 송금으로 넘어간다
  async function settleIfReady(roomId) {
    const room = await store.get('rooms', roomId);
    const invoices = (await store.list('invoices', { roomId })).filter((i) => i.version === room.version);
    const disputes = await store.list('disputes', { roomId });
    if (!invoices.length || invoices.some((i) => i.status === 'asked') || disputes.some((d) => OPEN.includes(d.status))) return [];
    return createTransfers(roomId);
  }

  // Task 11에서 채운다
  async function createTransfers() {
    return [];
  }

  return { sendInvoices, answerInvoice, raiseDispute, createTransfers };
}
