// 비서끼리 처리(#9): 청구서 보내기, 각자의 규칙대로 답하기, 이의, 송금 안내.
// 상태는 Store(invoices·disputes·transfers)에 두고, 사람에게 보이는 일은 비서 기록과 pendingActions(현재 상태에서 계산)로 알린다.
// LLM은 중재안만 낸다. 금액은 public/core.js가 계산한다.
import { randomUUID } from 'node:crypto';
import { ledger, settle, won, dayLabel } from '../../public/core.js';
import { topic, subj, obj, disputeRejected } from '../../public/ui.js';
import { HttpError } from '../http.mjs';
import { isFlagged, awaitsSender } from '../actions.mjs';
import { evaluateInvoice, nextSendAt } from './rules.mjs';
import { tossSendLink, payoutFallback } from '../payments/toss.mjs';
import { signQrToken, QR_TTL_MS } from '../payments/qr.mjs';
import { mediateWithGemini } from './mediate.mjs';
import { OPEN } from './disputes.mjs';
import { findBank } from '../../public/banks.js';
import { ON_DISPUTE, sendWhenLabel } from '../../public/agent-rules.js';
import { normalizeSettings, rulesIn } from './settings.mjs';
import { roomMemory } from './memory.mjs';

const STALE = '지출이 바뀌었어요. 청구서를 다시 보낸 뒤 새 금액으로 보내 주세요';
// 보냈어요 뒤 받는 사람이 답이 없으면 다시 묻는 때(sentAt 기준). 1일 뒤, 3일 뒤 두 번. 그 뒤로는 할 일 카드만 남는다
const DAY_MS = 24 * 3600_000;
const RECEIPT_REMINDERS = [1 * DAY_MS, 3 * DAY_MS];
// tick이 할 일이 있는 송금 상태. 아직 안 보냈으면 때가 됐는지·지출이 바뀌었는지, 보냈으면 받았나요 다시 알림
const TICK_STATUSES = ['scheduled', 'due', 'opened', 'sent'];

export function createOrchestrator({ store, gemini = null, clock = () => new Date(), evidenceFor = async () => [], counterFor = async () => [] }) {
  const say = (roomId, ev) => store.appendEvent(roomId, ev);
  const settingsOf = async (uid) => normalizeSettings(await store.get('agents', uid), uid);
  // 이 방에서 쓰는 비서 설정: 규칙은 내 비서 규칙에서 이 방에 적용하지 않기로 한 것만 기본값으로 바꾼다
  const settingsIn = async (uid, roomId) => {
    const s = await settingsOf(uid);
    return { ...s, rules: rulesIn(s, roomId) };
  };

  async function loadRoom(roomId) {
    const room = await store.get('rooms', roomId);
    if (!room) throw new HttpError(404, '방을 찾을 수 없어요');
    const name = (uid) => room.members.find((m) => m.uid === uid)?.name ?? uid;
    return { room, name };
  }

  async function load(roomId) {
    const { room, name } = await loadRoom(roomId);
    const expenses = await store.list('expenses', { roomId });
    return { room, expenses, name };
  }

  // 이 사람이 함께한 지출 중 근거가 있는 첫 지출. 이미 끝난 이의(동의로 해결했거나 거부로 끝난)는 다시 보지 않는다
  async function firstEvidence(uid, room, expenses, ended) {
    for (const exp of expenses.filter((e) => e.present.includes(uid) && !ended.has(`${uid}:${e.id}`))) {
      const evidence = await evidenceFor(uid, exp, room);
      if (evidence.length) return { exp, evidence };
    }
    return null;
  }

  const claimFrom = (name, { evidence }) => {
    if (evidence.some(e => e.locationId || e.source === 'timeline_export' || e.uncertain)) return `${name}의 위치 요약만으로 참석 여부를 확정할 수 없어 부담 항목 확인을 요청해요.`;
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
    // 처음 보낸 순간부터 정산 중. 이후 초대·참가·정책 변경을 막는다(#4)
    if (room.status !== 'settling') await store.put('rooms', { ...room, status: 'settling' });

    const stale = all.filter((i) => i.version < room.version && ['pending', 'accepted', 'asked'].includes(i.status));
    for (const i of stale) await store.put('invoices', { ...i, status: 'superseded' });
    if (stale.length) await say(roomId, { from: actorUid, to: 'all', kind: 'invoices_superseded', text: '지출이 바뀌어 다시 보내요' });

    const rows = ledger(room, expenses, room.policy);
    const ended = new Set((await store.list('disputes', { roomId })).filter((d) => !OPEN.includes(d.status)).map((d) => `${d.by}:${d.expenseId}`));
    await say(roomId, { from: actorUid, to: 'all', kind: 'invoices_sent', text: `지출 ${expenses.length}건으로 각자의 비서에게 청구서를 보냈어요`, meta: `지출이 바뀔 때마다 새로 보내는 청구서의 ${room.version}번째 묶음이에요` });
    const invoices = [];
    for (const m of room.members.filter((x) => !x.left)) { // 방에서 나간 사람(#55)은 낀 지출이 없을 때만 나갈 수 있어 0원이다
      const r = rows[m.uid];
      const base = { id: `${roomId}:v${room.version}:${m.uid}`, roomId, version: room.version, to: m.uid, owed: r.owed, paid: r.paid, net: r.net };
      const found = await firstEvidence(m.uid, room, expenses, ended);
      const { decision, reasons } = evaluateInvoice({ invoice: base, settings: await settingsIn(m.uid, roomId), evidence: found?.evidence ?? [] });
      // 청구서는 방 사람 모두가 읽고 위치 요약을 지워도 남으므로 요약 글은 빼고, 붙었다는 사실만 hasLocationSummary로 둔다
      const hidden = new Set((found?.evidence ?? []).filter(e => e.locationId).map(e => e.summary));
      const shown = reasons.filter(r => !hidden.has(r));
      const invoice = {
        ...base,
        status: { accept: 'accepted', ask: 'asked', dispute: 'disputed' }[decision],
        decidedBy: decision === 'ask' ? null : 'agent',
        reasons: shown.length ? shown : ['근거가 있는 지출에 이의를 냈어요'],
        ...(hidden.size ? { hasLocationSummary: true } : {}),
      };
      await store.put('invoices', invoice);
      invoices.push(invoice);
      if (decision === 'accept') {
        await say(roomId, { from: m.uid, to: actorUid, kind: 'invoice_accepted', text: acceptedText(r.net), meta: `정해 둔 규칙: ${reasons.join(' · ')}` });
      } else if (decision === 'ask') {
        await say(roomId, {
          from: m.uid, to: m.uid, kind: 'invoice_asked', text: `${won(-r.net)} 청구서가 왔어요. ${reasons[0]}`, meta: '정해 둔 규칙: 자동 수락 한도 초과',
          action: { type: 'answer_invoice', ref: invoice.id, for: m.uid },
        });
      } else {
        await say(roomId, { from: m.uid, to: m.uid, kind: 'rule_applied', text: '근거가 있어서 대신 이의를 낼게요', meta: `정해 둔 규칙: ${ON_DISPUTE.evidence}` });
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
    if (decision === 'accept') await say(roomId, { from: actorUid, to: 'all', kind: 'invoice_accepted', text: acceptedText(invoice.net), meta: '사람이 직접 확인했어요' });
    await settleIfReady(roomId);
    return { invoice: saved };
  }

  // 같은 사람이 같은 지출에 이미 낸 이의가 열려 있으면 그것을 쓴다(다시 보내도 중복 없음)
  async function raiseDispute(roomId, { by, expenseId, claim, evidence = [] }) {
    const { expenses, room } = await load(roomId);
    const exp = expenses.find((e) => e.id === expenseId);
    if (!exp) throw new HttpError(400, '이의를 제기할 지출을 골라 주세요');
    if (!evidence.length) evidence = await evidenceFor(by, exp, room);
    if (!String(claim ?? '').trim()) throw new HttpError(400, '무엇이 맞지 않는지 적어 주세요');
    const existing = (await store.list('disputes', { roomId })).find((d) => d.by === by && d.expenseId === expenseId && OPEN.includes(d.status));
    if (existing) return existing;
    const dispute = { id: `${roomId}:d-${randomUUID().slice(0, 8)}`, roomId, expenseId, by, claim: String(claim).trim().slice(0, 300), evidence, status: 'open', agreedBy: [] };
    await store.put('disputes', dispute);
    await say(roomId, {
      from: by, to: exp.payer, kind: 'dispute_raised', text: `${obj(`‘${exp.title}’`)} 다시 나누자고 이의를 제기했어요`,
      ...(evidence.length ? { meta: evidence.some(e => e.locationId) ? '위치 요약 첨부 · 이의 내용에서 확인' : `근거: ${evidence.map((e) => e.summary).join(' · ')}` } : {}),
    });
    // 지출을 낸 사람이 이의를 중재 비서에게 맡겨 두었으면 바로 중재한다. 아니면 낸 사람에게 묻는다(pendingActions)
    if ((await settingsIn(exp.payer, roomId)).rules.onDispute === 'mediator') {
      await say(roomId, { from: exp.payer, to: exp.payer, kind: 'rule_applied', text: '이의가 와서 중재 비서에게 맡겼어요', meta: `정해 둔 규칙: ${ON_DISPUTE.mediator}` });
      return mediate(roomId, dispute.id, exp.payer);
    }
    await say(roomId, {
      from: exp.payer, to: exp.payer, kind: 'dispute_asked', text: `${obj(`‘${exp.title}’`)} 어떻게 할지 주인에게 물어요`, meta: '정해 둔 규칙: 이의가 오면 주인에게 묻기',
      action: { type: 'agree_dispute', ref: dispute.id, for: exp.payer },
    });
    return dispute;
  }

  async function disputeOf(roomId, disputeId) {
    const dispute = await store.get('disputes', disputeId);
    if (!dispute || dispute.roomId !== roomId) throw new HttpError(404, '이의를 찾을 수 없어요');
    const { room, expenses } = await load(roomId);
    const exp = expenses.find((e) => e.id === dispute.expenseId);
    if (!exp) throw new HttpError(409, '지출이 지워져 이 이의는 닫혔어요'); // 지출을 지울 때 이의도 닫지만, 옛 데이터에는 이의만 남아 있을 수 있다
    return { dispute, room, exp, parties: [exp.payer, dispute.by] };
  }

  // 근거의 '떠난 시각' 뒤 주문에서 이의를 낸 사람이 빠졌는지
  const matchesEvidence = (exp, dispute, alloc) => {
    if (dispute.evidence.some(e => e.source === 'timeline_export' || e.locationId || e.requiresHumanApproval)
      || Object.values(alloc).some(a => a.evidenceConflict)) return false;
    const left = dispute.evidence.find((e) => e.kind === 'left_at' && e.time);
    return Boolean(left) && exp.items.filter((it) => it.time && it.time > left.time).every((it) => !alloc[it.id]?.consumers.includes(dispute.by));
  };

  // 중재 비서가 양쪽 주장·근거·영수증 주문 시각으로 나누는 법을 제안한다
  async function mediate(roomId, disputeId, actorUid) {
    const { dispute, room, exp, parties } = await disputeOf(roomId, disputeId);
    if (!parties.includes(actorUid)) throw new HttpError(403, '이의 당사자만 중재를 맡길 수 있어요');
    if (dispute.status !== 'open') throw new HttpError(409, '이미 중재안이 나왔어요');
    if (!exp.items?.length) throw new HttpError(409, '영수증 줄이 없어 중재할 수 없어요. 지출을 고쳐 줄을 넣어 주세요');
    const memoryByUid = await roomMemory(store, room); // 이 방에 공유한 기억만 중재 비서에게 보여 준다(이의 중재는 기억이 근거로 인용될 수 있는 유일한 곳)
    const started = Date.now();
    const out = await mediateWithGemini(gemini, { exp, room, dispute, counter: await counterFor(exp, room), memoryByUid });
    if (dispute.evidence.some(e => e.locationId)) {
      const live = new Set((await evidenceFor(dispute.by, exp, room)).map(e => e.locationId));
      if (dispute.evidence.some(e => e.locationId && !live.has(e.locationId))) throw new HttpError(409, '위치 공유가 철회되었어요. 근거를 다시 확인해 주세요');
    }
    const proposed = { ...dispute, status: 'proposed', proposal: { summary: out.summary, alloc: out.alloc, source: out.source } };
    await store.put('disputes', proposed);
    await say(roomId, {
      from: 'mediator', to: 'all', kind: 'dispute_proposed', text: dispute.evidence.some(e => e.locationId) ? '위치 요약을 참고한 중재안이에요. 당사자가 확인해 주세요.' : out.summary,
      meta: `중재한 방법: ${out.source === 'rules' ? '정해 둔 규칙' : out.source} · ${((Date.now() - started) / 1000).toFixed(1)}초 걸렸어요`,
    });
    // 이의를 낸 비서는 '근거가 있으면 이의'를 맡았으므로, 제안이 그 근거와 맞으면 스스로 동의한다
    if ((await settingsIn(dispute.by, roomId)).rules.onDispute === 'evidence' && matchesEvidence(exp, dispute, out.alloc)) {
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
    await say(roomId, { from: actorUid, to: 'all', kind: 'dispute_agreed', text: auto ? '근거와 맞는 중재안이라 동의했어요' : '중재안에 동의했어요', ...(auto ? { meta: '정해 둔 규칙: 근거와 맞는 중재안이면 동의' } : {}) });
    if (!parties.every((p) => saved.agreedBy.includes(p))) return saved;

    // 두 사람이 동의한 배분이므로 줄마다 확인된 것으로 둔다
    const alloc = Object.fromEntries(Object.entries(dispute.proposal.alloc).map(([id, a]) => [id, { ...a, ...(dispute.evidence.some(e => e.locationId) ? { reason: '당사자가 합의한 배분' } : {}), confirmed: true }]));
    await store.put('expenses', { ...exp, split: 'items', alloc });
    await store.put('rooms', { ...room, version: room.version + 1 });
    const resolved = { ...saved, status: 'resolved' };
    await store.put('disputes', resolved);
    await say(roomId, { from: 'mediator', to: 'all', kind: 'dispute_resolved', text: `양쪽이 동의해서 ${obj(`‘${exp.title}’`)} 중재안대로 다시 나눴어요` });
    await sendInvoices(roomId, actorUid);
    return resolved;
  }

  // 중재안을 거부하면 이의가 끝나고 지출은 지금 배분 그대로 둔 채 정산이 이어진다.
  // 이의를 낸 사람이 거부하면 철회(withdrawn), 지출을 낸 사람이 거부하면 기각(dismissed).
  // 비서가 근거 규칙으로 먼저 동의해 뒀어도 사람은 물러설 수 있어서, 이미 동의한 당사자도 거부할 수 있다.
  // 같은 사람이 같은 거부를 다시 보내면 처음 결과를 돌려준다(기록·송금이 늘지 않는다)
  async function reject(roomId, disputeId, actorUid, { reason } = {}) {
    const { dispute, exp, parties } = await disputeOf(roomId, disputeId);
    if (!parties.includes(actorUid)) throw new HttpError(403, '이의 당사자만 거부할 수 있어요');
    if (disputeRejected(dispute) && dispute.rejectedBy === actorUid) return dispute;
    if (dispute.status !== 'proposed') throw new HttpError(409, dispute.status === 'open' ? '아직 중재안이 없어요' : '이미 끝난 이의예요');
    const why = typeof reason === 'string' ? reason.replace(/\s+/g, ' ').trim().slice(0, 100).trim() : '';
    const status = actorUid === dispute.by ? 'withdrawn' : 'dismissed';
    const saved = { ...dispute, status, rejectedBy: actorUid, ...(why ? { rejectReason: why } : {}) };
    await store.put('disputes', saved);
    await say(roomId, {
      from: actorUid, to: 'all', kind: `dispute_${status}`,
      text: status === 'withdrawn' ? `중재안을 거부하고 ‘${exp.title}’ 이의를 거뒀어요` : `중재안을 거부해서 ‘${exp.title}’ 이의가 끝났어요`,
      ...(why ? { meta: `사유: ${why}` } : {}),
    });
    await settleIfReady(roomId);
    return saved;
  }

  // 지금 version의 청구서에 묻는 중인 것도, 열린 이의도 없으면 송금으로 넘어간다
  async function settleIfReady(roomId) {
    const room = await store.get('rooms', roomId);
    const invoices = (await store.list('invoices', { roomId })).filter((i) => i.version === room.version);
    const disputes = await store.list('disputes', { roomId });
    if (!invoices.length || invoices.some((i) => i.status === 'asked') || disputes.some((d) => OPEN.includes(d.status))) return [];
    const out = await createTransfers(roomId);
    await finishIfDone(roomId); // 보낼 돈이 없으면 여기서 바로 끝난다
    return out;
  }

  // 지금 묶음의 송금이 모두 '받았어요'로 끝나면(보낼 돈이 없으면 바로) 방을 완료로 바꾼다(#55).
  // 완료된 방은 내 방 목록의 '끝남'에 보이고, 지출·이의·초대를 더 받지 않는다(src/rooms/policy.mjs)
  async function finishIfDone(roomId) {
    const { room, expenses } = await load(roomId);
    if (room.status !== 'settling' || !expenses.length) return; // 지출 없이 보낸 방은 닫지 않는다(닫히면 지출을 남길 수 없다)
    const invoices = (await store.list('invoices', { roomId })).filter((i) => i.version === room.version);
    const disputes = await store.list('disputes', { roomId });
    if (!invoices.length || invoices.some((i) => i.status === 'asked') || disputes.some((d) => OPEN.includes(d.status))) return;
    const live = (await store.list('transfers', { roomId })).filter((t) => t.version === room.version);
    if (live.length ? !live.every((t) => t.status === 'confirmed') : settle(ledger(room, expenses, room.policy)).length) return;
    await store.put('rooms', { ...room, status: 'done', doneAt: clock().toISOString() });
    await say(roomId, { from: 'system', to: 'all', kind: 'room_done', text: live.length ? '모든 송금이 확인돼서 정산이 끝났어요' : '주고받을 돈이 없어서 정산이 끝났어요' });
  }

  // ---------------------------------------------------------------- 송금
  // 받는 계좌가 있으면 토스 링크를 지금 만들어 둔다. 브라우저는 사용자 제스처 안에서만 앱을 열어 주므로, 승인 순간에는 서버를 기다리지 않는다
  const paymentOf = (payout, amount) => {
    if (!payout) return { link: null, fallback: null };
    return { link: tossSendLink({ ...payout, amount }), fallback: payoutFallback(payout, amount) };
  };
  const whenText = (iso) => {
    const kst = new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString();
    return `${dayLabel(kst.slice(0, 10))} 09:00`;
  };

  const remindText = (t, now) => {
    if (t.manual) return `편할 때 보내 주세요. ${whenText(t.remindAt)}까지 받았다는 확인이 없으면 알려 드릴게요`;
    return new Date(t.remindAt) > now ? `${whenText(t.remindAt)}에 알려 드릴게요` : '곧 알려 드릴게요';
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
      const sender = await settingsIn(edge.from, roomId);
      const receiver = await settingsOf(edge.to);
      const transfer = {
        id: `${roomId}:v${room.version}:t${i + 1}`, roomId, version: room.version, from: edge.from, to: edge.to, amount: edge.amount,
        status: 'scheduled', remindAt: nextSendAt(now, sender.rules.sendWhen), ...paymentOf(receiver.payout, edge.amount),
        ...(sender.rules.sendWhen === 'manual' ? { manual: true } : {}),
      };
      await store.put('transfers', transfer);
      out.push(transfer);
      await say(roomId, {
        from: edge.from, to: edge.from, kind: 'transfer_scheduled',
        text: `${name(edge.to)}에게 ${won(edge.amount)}을 보내요. ${remindText(transfer, now)}`,
        meta: `정해 둔 규칙: ${sendWhenLabel(sender.rules.sendWhen)}`,
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

  // 받을 계좌는 사람마다 하나다. 정하거나 바꾸면 그 사람이 받을 모든 방의 아직 끝나지 않은 송금에 링크를 다시 채운다
  async function setPayout(roomId, actorUid, { bank, accountNo, holder } = {}) {
    if (!String(bank ?? '').trim() || !/\d{6,}/.test(String(accountNo ?? '').replace(/\D/g, ''))) throw new HttpError(400, '은행과 계좌번호를 확인해 주세요');
    const agent = await settingsOf(actorUid);
    // 은행은 목록의 이름으로 통일해 저장한다('국민은행' → 'KB국민은행'). 목록에 없으면 쓴 그대로
    const payout = { bank: (findBank(bank)?.label ?? String(bank).trim()).slice(0, 30), accountNo: String(accountNo).replace(/[^\d-]/g, '').slice(0, 30), holder: String(holder ?? '').trim().slice(0, 30) };
    await store.put('agents', { ...agent, id: actorUid, uid: actorUid, payout });
    const rooms = new Set(roomId ? [roomId] : []); // 내 계정에서 정하면(roomId 없음) 대기 중 송금이 있는 방에만 알린다
    for (const t of (await store.list('transfers', { to: actorUid })).filter((x) => ['scheduled', 'due', 'opened'].includes(x.status))) {
      await store.put('transfers', { ...t, ...paymentOf(payout, t.amount) });
      rooms.add(t.roomId);
    }
    const text = agent.payout ? '받을 계좌를 바꿨어요. 아직 보내지 않은 송금에는 새 계좌가 들어가요' : '받을 계좌를 알려 줬어요. 이제 바로 보낼 수 있어요';
    for (const id of rooms) if (await store.get('rooms', id)) await say(id, { from: actorUid, to: 'all', kind: 'payout_set', text });
    return { ok: true };
  }

  async function transferOf(roomId, tid, actorUid, who) {
    const t = await store.get('transfers', tid);
    if (!t || t.roomId !== roomId) throw new HttpError(404, '송금을 찾을 수 없어요');
    if (t[who] !== actorUid) throw new HttpError(403, who === 'from' ? '보내는 사람만 할 수 있어요' : '받는 사람만 확인할 수 있어요');
    const { room, name } = await load(roomId);
    // 보내기 전 단계에서 지출이 바뀌었으면 옛 금액으로 보내지 않게 막는다(받았어요 확인은 그대로 받는다).
    // 이미 보냈다고 한 송금(sent)은 돈이 오갔을 수 있으니, 지출이 바뀌어도 그 기록을 마무리할 수 있게 둔다(#8 송금 확인)
    if (who === 'from' && t.status !== 'sent' && t.version !== room.version) throw new HttpError(409, STALE);
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

  // 데스크톱 QR(#8). 토큰은 수명이 짧아서, 송금이 생길 때 미리 만들어 두면 월급날처럼 며칠 뒤 열었을 때 이미 죽어 있다.
  // 그래서 보내는 사람이 송금 화면을 열 때마다 새로 만든다. 화면은 expiresAt 전에 다시 부른다
  async function qrFor(roomId, tid, actorUid) {
    const { t } = await transferOf(roomId, tid, actorUid, 'from');
    if (!awaitsSender(t)) throw new HttpError(409, '이미 보냈거나 바뀐 송금이에요');
    if (!t.link) throw new HttpError(409, '받을 계좌가 아직 없어요');
    const now = clock().getTime();
    return { qrToken: signQrToken(t.link, { now: () => now, subjectUids: [t.from, t.to] }), expiresAt: new Date(now + QR_TTL_MS).toISOString() };
  }

  // 받는 사람이 "아직 안 들어왔어요"를 눌렀다(#8 송금 확인). 상태는 sent로 두고 표시(notReceivedAt)만 붙여 보내는 사람에게 다시 묻는다.
  // 은행 지연·계좌 착오처럼 보냈는데 안 들어온 돈도 있어서, 안 보낸 돈(opened)처럼 대체하거나 링크를 새 계좌로 바꾸지 않는다
  async function reportNotReceived(roomId, tid, actorUid) {
    const { t } = await transferOf(roomId, tid, actorUid, 'to');
    if (t.status !== 'sent') throw new HttpError(409, '보냈다고 한 송금에만 할 수 있어요');
    if (t.notReceivedAt) return t; // 두 번 눌러도 같은 결과(받았어요 확인과 같다)
    const saved = { ...t, notReceivedAt: clock().toISOString() };
    await store.put('transfers', saved);
    await say(roomId, {
      from: t.to, to: t.from, kind: 'transfer_not_received', text: `아직 ${won(t.amount)}을 못 받았어요. 송금 내역을 한 번 확인해 주세요`,
      action: { type: 'approve_transfer', ref: t.id, for: t.from },
    });
    return saved;
  }

  async function markSent(roomId, tid, actorUid) {
    const { t, name } = await transferOf(roomId, tid, actorUid, 'from');
    if (!awaitsSender(t)) throw new HttpError(409, '이미 보냈거나 바뀐 송금이에요');
    // 받는 사람이 안 들어왔다고 한 뒤 송금 내역을 보고(또는 다시 보내고) 보냈어요를 누를 수도 있다.
    // 그때는 표시를 내리고 확인한 시각을 남긴다(받는 사람 문구 "송금 내역을 확인했대요"). 다시 알림은 처음부터 센다
    const now = clock().toISOString();
    const { notReceivedAt, ...rest } = t;
    const saved = { ...rest, status: 'sent', sentAt: now, reminders: 0, ...(notReceivedAt ? { recheckedAt: now } : {}) };
    await store.put('transfers', saved);
    const text = `${name(t.to)}에게 ${won(t.amount)}을 보냈어요`;
    await say(roomId, { from: t.from, to: t.to, kind: 'transfer_sent', text: t.notReceivedAt ? `송금 내역을 확인했어요. ${text}` : text });
    return saved;
  }

  async function confirmReceipt(roomId, tid, actorUid) {
    const { t, name } = await transferOf(roomId, tid, actorUid, 'to');
    if (t.status === 'confirmed') return t;
    if (t.status === 'superseded') throw new HttpError(409, '지출이 바뀌어 대체된 송금이에요');
    const saved = { ...t, status: 'confirmed', confirmedAt: clock().toISOString() };
    await store.put('transfers', saved);
    await say(roomId, { from: t.to, to: t.from, kind: 'transfer_confirmed', text: `${name(t.from)}에게서 ${won(t.amount)}을 받았어요` });
    await finishIfDone(roomId);
    return saved;
  }

  // 주기적으로 부른다(로컬 30초, 배포는 Cloud Scheduler). 때가 된 송금을 알리고, 보냈는데 확인이 없으면 1일·3일 뒤에 다시 묻는다.
  // Firestore에서는 읽은 문서 수가 비용이라(#3) 끝난 송금(confirmed·superseded)은 읽지 않고, 방은 tick 한 번에 방마다 한 번만 읽는다.
  // 처리할 송금은 고치기 전에 한꺼번에 받아 둔다(이번 tick에 due가 된 송금을 다시 보지 않게)
  async function tick() {
    const now = clock();
    let due = 0;
    let reminded = 0;
    const rooms = new Map();
    const roomOf = (roomId) => {
      if (!rooms.has(roomId)) rooms.set(roomId, loadRoom(roomId));
      return rooms.get(roomId);
    };
    const active = (await Promise.all(TICK_STATUSES.map((status) => store.list('transfers', { status })))).flat();
    for (const t of active) {
      const { room, name } = await roomOf(t.roomId);
      if (['scheduled', 'due', 'opened'].includes(t.status) && t.version !== room.version) {
        await store.put('transfers', { ...t, status: 'superseded' });
      } else if (t.status === 'scheduled' && t.remindAt && new Date(t.remindAt) <= now) { // remindAt이 없는 예전 직접 보내기는 알리지 않는다
        // 받는 사람이 받았다고 했으면 confirmed라 여기 오지 않는다. 직접 보내기는 그래서 '확인이 없을 때만' 알리게 된다
        await store.put('transfers', { ...t, status: 'due', dueAt: now.toISOString() });
        await say(t.roomId, {
          from: t.from, to: t.from, kind: 'transfer_due',
          text: t.manual ? `${name(t.to)}에게 보낼 ${won(t.amount)}, 아직 받았다는 확인이 없어요. 보냈다면 보냈어요를 눌러 주세요` : `${name(t.to)}에게 ${won(t.amount)}을 보낼 때예요`,
          ...(t.manual ? { meta: `정해 둔 규칙: ${sendWhenLabel('manual')}` } : {}),
          action: { type: 'approve_transfer', ref: t.id, for: t.from },
        });
        due++;
      } else if (t.status === 'sent') {
        // 지나간 단계 수(stage)가 물은 횟수보다 많을 때만, 마지막 단계 문구 하나만 보낸다(주기 작업이 며칠 멈췄다 돌아도 연달아 묻지 않게)
        const asked = t.reminders ?? (t.remindedAt ? 1 : 0); // reminders가 없는 예전 송금은 remindedAt으로 센다
        const stage = RECEIPT_REMINDERS.filter((ms) => now - new Date(t.sentAt) >= ms).length;
        if (stage > asked) {
          await store.put('transfers', { ...t, reminders: stage, remindedAt: now.toISOString() });
          // 일수는 일정(RECEIPT_REMINDERS)에서 계산해, 일정을 바꾸면 문구도 함께 바뀌게 한다
          const text = stage === 1 ? `${subj(name(t.from))} 보낸 ${won(t.amount)}을 받았나요?` : `${subj(name(t.from))} 보낸 지 ${RECEIPT_REMINDERS[stage - 1] / DAY_MS}일이 넘었어요. ${won(t.amount)}을 받았나요?`;
          await say(t.roomId, { from: t.to, to: t.to, kind: 'receipt_reminder', text, action: { type: 'confirm_receipt', ref: t.id, for: t.to } });
          reminded++;
        }
      }
    }
    return { due, reminded };
  }

  return { sendInvoices, answerInvoice, raiseDispute, mediate, agree, reject, createTransfers, setPayout, approveTransfer, qrFor, markSent, reportNotReceived, confirmReceipt, tick };
}
