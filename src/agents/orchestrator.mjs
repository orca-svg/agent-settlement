// 비서끼리 처리(#9): 청구서 보내기, 각자의 규칙대로 답하기, 이의, 송금 안내.
// 상태는 Store(invoices·disputes·transfers)에 두고, 사람에게 보이는 일은 비서 기록과 pendingActions(현재 상태에서 계산)로 알린다.
// LLM은 중재안만 낸다. 금액은 public/core.js가 계산한다.
import { randomUUID } from 'node:crypto';
import { ledger, settle, won, dayLabel } from '../../public/core.js';
import { topic, subj, obj } from '../../public/ui.js';
import { HttpError } from '../http.mjs';
import { isFlagged } from '../actions.mjs';
import { evaluateInvoice, nextSendAt } from './rules.mjs';
import { tossSendLink, payoutFallback } from '../payments/toss.mjs';
import { signQrToken } from '../payments/qr.mjs';
import { mediateWithGemini } from './mediate.mjs';
import { findBank } from '../../public/banks.js';

const OPEN = ['open', 'proposed'];
const STALE = '지출이 바뀌었어요. 청구서를 다시 보낸 뒤 새 금액으로 보내 주세요';
const DEFAULT_RULES = { autoAccept: 0, sendWhen: 'now', onDispute: 'ask' };

export function createOrchestrator({ store, gemini = null, clock = () => new Date(), evidenceFor = async () => [], counterFor = async () => [] }) {
  const say = (roomId, ev) => store.appendEvent(roomId, ev);
  const settingsOf = async (uid) => (await store.get('agents', uid)) ?? { uid, memory: [], rules: DEFAULT_RULES, payout: null };

  async function load(roomId) {
    const room = await store.get('rooms', roomId);
    if (!room) throw new HttpError(404, '방을 찾을 수 없어요');
    const expenses = await store.list('expenses', { roomId });
    const name = (uid) => room.members.find((m) => m.uid === uid)?.name ?? uid;
    return { room, expenses, name };
  }

  // 이 사람이 함께한 지출 중 근거가 있는 첫 지출. 이미 이의가 해결된 지출은 다시 보지 않는다
  async function firstEvidence(uid, room, expenses, resolved) {
    for (const exp of expenses.filter((e) => e.present.includes(uid) && !resolved.has(`${uid}:${e.id}`))) {
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
    const resolved = new Set((await store.list('disputes', { roomId })).filter((d) => d.status === 'resolved').map((d) => `${d.by}:${d.expenseId}`));
    await say(roomId, { from: actorUid, to: 'all', kind: 'invoices_sent', text: `지출 ${expenses.length}건으로 각자의 비서에게 청구서를 보냈어요`, meta: `version ${room.version}` });
    const invoices = [];
    for (const m of room.members) {
      const r = rows[m.uid];
      const base = { id: `${roomId}:v${room.version}:${m.uid}`, roomId, version: room.version, to: m.uid, owed: r.owed, paid: r.paid, net: r.net };
      const found = await firstEvidence(m.uid, room, expenses, resolved);
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
    if (invoice.version !== (await store.get('rooms', roomId)).version) throw new HttpError(409, STALE);
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
    // 지출을 낸 사람이 이의를 중재 비서에게 맡겨 두었으면 바로 중재한다. 아니면 낸 사람에게 묻는다(pendingActions)
    if ((await settingsOf(exp.payer)).rules.onDispute === 'mediator') return mediate(roomId, dispute.id, exp.payer);
    return dispute;
  }

  async function disputeOf(roomId, disputeId) {
    const dispute = await store.get('disputes', disputeId);
    if (!dispute || dispute.roomId !== roomId) throw new HttpError(404, '이의를 찾을 수 없어요');
    const { room, expenses } = await load(roomId);
    const exp = expenses.find((e) => e.id === dispute.expenseId);
    return { dispute, room, exp, parties: [exp.payer, dispute.by] };
  }

  // 근거의 '떠난 시각' 뒤 주문에서 이의를 낸 사람이 빠졌는지
  const matchesEvidence = (exp, dispute, alloc) => {
    const left = dispute.evidence.find((e) => e.kind === 'left_at' && e.time);
    return Boolean(left) && exp.items.filter((it) => it.time && it.time > left.time).every((it) => !alloc[it.id]?.consumers.includes(dispute.by));
  };

  // 중재 비서가 양쪽 주장·근거·영수증 주문 시각으로 나누는 법을 제안한다
  async function mediate(roomId, disputeId, actorUid) {
    const { dispute, room, exp, parties } = await disputeOf(roomId, disputeId);
    if (!parties.includes(actorUid)) throw new HttpError(403, '이의 당사자만 중재를 맡길 수 있어요');
    if (dispute.status !== 'open') throw new HttpError(409, '이미 중재안이 나왔어요');
    if (!exp.items?.length) throw new HttpError(409, '영수증 줄이 없어 중재할 수 없어요. 지출을 고쳐 줄을 넣어 주세요');
    const memoryByUid = Object.fromEntries(await Promise.all(room.members.map(async (m) => [m.uid, (await settingsOf(m.uid)).memory ?? []])));
    const started = Date.now();
    const out = await mediateWithGemini(gemini, { exp, room, dispute, counter: await counterFor(exp, room), memoryByUid });
    const proposed = { ...dispute, status: 'proposed', proposal: { summary: out.summary, alloc: out.alloc, source: out.source } };
    await store.put('disputes', proposed);
    await say(roomId, {
      from: 'mediator', to: 'all', kind: 'dispute_proposed', text: out.summary,
      meta: `mediate · ${out.source === 'rules' ? '규칙' : out.source} · ${((Date.now() - started) / 1000).toFixed(1)}초`,
    });
    // 이의를 낸 비서는 '근거가 있으면 이의'를 맡았으므로, 제안이 그 근거와 맞으면 스스로 동의한다
    if ((await settingsOf(dispute.by)).rules.onDispute === 'evidence' && matchesEvidence(exp, dispute, out.alloc)) {
      return agree(roomId, disputeId, dispute.by, { auto: true });
    }
    return proposed;
  }

  // 양쪽(지출을 낸 사람과 이의를 낸 사람)이 모두 동의하면 지출을 중재안대로 바꾸고 청구서를 다시 보낸다
  async function agree(roomId, disputeId, actorUid, { auto = false } = {}) {
    const { dispute, room, exp, parties } = await disputeOf(roomId, disputeId);
    if (!parties.includes(actorUid)) throw new HttpError(403, '이의 당사자만 동의할 수 있어요');
    if (dispute.status !== 'proposed') throw new HttpError(409, dispute.status === 'open' ? '아직 중재안이 없어요' : '이미 끝난 이의예요');
    const saved = { ...dispute, agreedBy: [...new Set([...dispute.agreedBy, actorUid])] };
    await store.put('disputes', saved);
    await say(roomId, { from: actorUid, to: 'all', kind: 'dispute_agreed', text: auto ? '근거와 맞는 중재안이라 동의했어요' : '중재안에 동의했어요', ...(auto ? { meta: '규칙 · 근거가 있으면 이의' } : {}) });
    if (!parties.every((p) => saved.agreedBy.includes(p))) return saved;

    // 두 사람이 동의한 배분이므로 줄마다 확인된 것으로 둔다
    const alloc = Object.fromEntries(Object.entries(dispute.proposal.alloc).map(([id, a]) => [id, { ...a, confirmed: true }]));
    await store.put('expenses', { ...exp, split: 'items', alloc });
    await store.put('rooms', { ...room, version: room.version + 1 });
    const resolved = { ...saved, status: 'resolved' };
    await store.put('disputes', resolved);
    await say(roomId, { from: 'mediator', to: 'all', kind: 'dispute_resolved', text: `양쪽이 동의해서 ${obj(`‘${exp.title}’`)} 중재안대로 다시 나눴어요` });
    await sendInvoices(roomId, actorUid);
    return resolved;
  }

  // 지금 version의 청구서에 묻는 중인 것도, 열린 이의도 없으면 송금으로 넘어간다
  async function settleIfReady(roomId) {
    const room = await store.get('rooms', roomId);
    const invoices = (await store.list('invoices', { roomId })).filter((i) => i.version === room.version);
    const disputes = await store.list('disputes', { roomId });
    if (!invoices.length || invoices.some((i) => i.status === 'asked') || disputes.some((d) => OPEN.includes(d.status))) return [];
    return createTransfers(roomId);
  }

  // ---------------------------------------------------------------- 송금
  // 받는 계좌가 있으면 토스 링크를 지금 만들어 둔다. 브라우저는 사용자 제스처 안에서만 앱을 열어 주므로, 승인 순간에는 서버를 기다리지 않는다
  const paymentOf = (payout, amount) => {
    if (!payout) return { link: null, fallback: null, qrToken: null };
    const link = tossSendLink({ ...payout, amount });
    return { link, fallback: payoutFallback(payout, amount), qrToken: signQrToken(link, { now: () => clock().getTime() }) };
  };
  const whenText = (iso) => {
    const kst = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
    return `${dayLabel(kst.slice(0, 10))} 09:00`;
  };

  // 지금 version의 송금을 한 번만 만든다. 이전 version의 아직 보내지 않은 송금은 대체한다
  async function createTransfers(roomId) {
    const { room, expenses, name } = await load(roomId);
    const all = await store.list('transfers', { roomId });
    const current = all.filter((t) => t.version === room.version);
    if (current.length) return current;
    for (const t of all.filter((x) => x.version < room.version && ['scheduled', 'due', 'opened'].includes(x.status))) {
      await store.put('transfers', { ...t, status: 'superseded' });
    }
    const now = clock();
    const out = [];
    for (const [i, edge] of settle(ledger(room, expenses, room.policy)).entries()) {
      const sender = await settingsOf(edge.from);
      const receiver = await settingsOf(edge.to);
      const transfer = {
        id: `${roomId}:v${room.version}:t${i + 1}`, roomId, version: room.version, from: edge.from, to: edge.to, amount: edge.amount,
        status: 'scheduled', remindAt: nextSendAt(now, sender.rules.sendWhen), ...paymentOf(receiver.payout, edge.amount),
      };
      await store.put('transfers', transfer);
      out.push(transfer);
      const later = new Date(transfer.remindAt) > now;
      await say(roomId, {
        from: edge.from, to: edge.from, kind: 'transfer_scheduled',
        text: `${name(edge.to)}에게 ${won(edge.amount)}을 보내요. ${later ? `${whenText(transfer.remindAt)}에 알려 드릴게요` : '곧 알려 드릴게요'}`,
        meta: later ? '규칙 · 월급날에 보내기' : '규칙 · 바로 보내기',
      });
      if (!transfer.link) {
        await say(roomId, {
          from: edge.to, to: edge.to, kind: 'payout_needed', text: '받을 계좌를 알려 주면 바로 보낼 수 있어요',
          action: { type: 'set_payout', ref: transfer.id, for: edge.to },
        });
      }
    }
    return out;
  }

  // 받을 계좌를 정하면 나에게 오는 아직 끝나지 않은 송금에 링크를 채운다
  async function setPayout(roomId, actorUid, { bank, accountNo, holder } = {}) {
    if (!String(bank ?? '').trim() || !/\d{6,}/.test(String(accountNo ?? '').replace(/\D/g, ''))) throw new HttpError(400, '은행과 계좌번호를 확인해 주세요');
    const agent = await settingsOf(actorUid);
    // 은행은 목록의 이름으로 통일해 저장한다('국민은행' → 'KB국민은행'). 목록에 없으면 쓴 그대로
    const payout = { bank: (findBank(bank)?.label ?? String(bank).trim()).slice(0, 30), accountNo: String(accountNo).replace(/[^\d-]/g, '').slice(0, 30), holder: String(holder ?? '').trim().slice(0, 30) };
    await store.put('agents', { ...agent, id: actorUid, uid: actorUid, payout });
    for (const t of (await store.list('transfers', { roomId })).filter((x) => x.to === actorUid && ['scheduled', 'due', 'opened'].includes(x.status))) {
      await store.put('transfers', { ...t, ...paymentOf(payout, t.amount) });
    }
    await say(roomId, { from: actorUid, to: 'all', kind: 'payout_set', text: '받을 계좌를 알려 줬어요. 이제 바로 보낼 수 있어요' });
    return { ok: true };
  }

  async function transferOf(roomId, tid, actorUid, who) {
    const t = await store.get('transfers', tid);
    if (!t || t.roomId !== roomId) throw new HttpError(404, '송금을 찾을 수 없어요');
    if (t[who] !== actorUid) throw new HttpError(403, who === 'from' ? '보내는 사람만 할 수 있어요' : '받는 사람만 확인할 수 있어요');
    const { room, name } = await load(roomId);
    // 보내기 전 단계에서 지출이 바뀌었으면 옛 금액으로 보내지 않게 막는다(받았어요 확인은 그대로 받는다)
    if (who === 'from' && t.version !== room.version) throw new HttpError(409, STALE);
    return { t, name };
  }

  // 보내는 사람이 밀어서 보내기를 했다. 링크는 이미 화면에 있으므로 상태만 바꾼다(월급날 전에 미리 보내도 된다)
  async function approveTransfer(roomId, tid, actorUid) {
    const { t, name } = await transferOf(roomId, tid, actorUid, 'from');
    if (!['scheduled', 'due', 'opened'].includes(t.status)) throw new HttpError(409, '이미 보냈거나 바뀐 송금이에요');
    const saved = { ...t, status: 'opened', openedAt: clock().toISOString() };
    await store.put('transfers', saved);
    await say(roomId, { from: t.from, to: t.to, kind: 'transfer_opened', text: `${name(t.to)}에게 보낼 ${won(t.amount)} 송금 화면을 열었어요` });
    return saved;
  }

  async function markSent(roomId, tid, actorUid) {
    const { t, name } = await transferOf(roomId, tid, actorUid, 'from');
    if (!['scheduled', 'due', 'opened'].includes(t.status)) throw new HttpError(409, '이미 보냈거나 바뀐 송금이에요');
    const saved = { ...t, status: 'sent', sentAt: clock().toISOString() };
    await store.put('transfers', saved);
    await say(roomId, { from: t.from, to: t.to, kind: 'transfer_sent', text: `${name(t.to)}에게 ${won(t.amount)}을 보냈어요` });
    return saved;
  }

  async function confirmReceipt(roomId, tid, actorUid) {
    const { t, name } = await transferOf(roomId, tid, actorUid, 'to');
    if (t.status === 'confirmed') return t;
    if (t.status === 'superseded') throw new HttpError(409, '지출이 바뀌어 대체된 송금이에요');
    const saved = { ...t, status: 'confirmed', confirmedAt: clock().toISOString() };
    await store.put('transfers', saved);
    await say(roomId, { from: t.to, to: t.from, kind: 'transfer_confirmed', text: `${name(t.from)}에게서 ${won(t.amount)}을 받았어요` });
    return saved;
  }

  // 주기적으로 부른다(로컬 30초, 배포는 Cloud Scheduler). 때가 된 송금을 알리고, 보냈는데 하루가 지나도 확인이 없으면 한 번 더 묻는다
  async function tick() {
    const now = clock();
    let due = 0;
    let reminded = 0;
    for (const t of await store.list('transfers')) {
      const { room, name } = await load(t.roomId);
      if (['scheduled', 'due', 'opened'].includes(t.status) && t.version !== room.version) {
        await store.put('transfers', { ...t, status: 'superseded' });
      } else if (t.status === 'scheduled' && new Date(t.remindAt) <= now) {
        await store.put('transfers', { ...t, status: 'due', dueAt: now.toISOString() });
        await say(t.roomId, {
          from: t.from, to: t.from, kind: 'transfer_due', text: `${name(t.to)}에게 ${won(t.amount)}을 보낼 때예요`,
          action: { type: 'approve_transfer', ref: t.id, for: t.from },
        });
        due++;
      } else if (t.status === 'sent' && !t.remindedAt && now - new Date(t.sentAt) >= 24 * 3600_000) {
        await store.put('transfers', { ...t, remindedAt: now.toISOString() });
        await say(t.roomId, {
          from: t.to, to: t.to, kind: 'receipt_reminder', text: `${subj(name(t.from))} 보낸 ${won(t.amount)}을 받았나요?`,
          action: { type: 'confirm_receipt', ref: t.id, for: t.to },
        });
        reminded++;
      }
    }
    return { due, reminded };
  }

  return { sendInvoices, answerInvoice, raiseDispute, mediate, agree, createTransfers, setPayout, approveTransfer, markSent, confirmReceipt, tick };
}
