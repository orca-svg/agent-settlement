// 사람이 처리해야 할 일. 이벤트 기록이 아니라 현재 상태에서 계산하므로, 처리한 일은 자연히 빠진다.

import { topic } from '../public/ui.js';
import { won } from '../public/core.js';

export const isFlagged = (line) => Boolean(line) && line.confidence < 0.7 && !line.confirmed;

export function pendingActions({ room, expenses = [], invoices = [], disputes = [], transfers = [] }) {
  const name = (uid) => room?.members.find((m) => m.uid === uid)?.name ?? uid;
  const out = [];
  for (const exp of expenses) {
    for (const it of exp.items ?? []) {
      if (isFlagged(exp.alloc?.[it.id])) {
        out.push({ type: 'confirm_line', ref: `${exp.id}:${it.id}`, for: exp.createdBy, text: `${topic(`‘${it.name}’`)} 어떻게 나눌까요?`, expenseId: exp.id, itemId: it.id });
      }
    }
  }
  // 자동 수락 한도를 넘어 비서가 주인에게 물은 청구서
  for (const inv of invoices.filter((i) => i.status === 'asked')) {
    out.push({ type: 'answer_invoice', ref: inv.id, for: inv.to, text: `${won(-inv.net)} 청구서를 받을까요?`, invoiceId: inv.id });
  }
  // 이의: 중재 전에는 지출을 낸 사람에게 중재를 맡길지, 중재안이 나오면 아직 동의하지 않은 당사자에게 묻는다
  for (const d of disputes) {
    const exp = expenses.find((e) => e.id === d.expenseId);
    if (!exp) continue;
    const base = { type: 'agree_dispute', ref: d.id, disputeId: d.id, expenseId: exp.id };
    if (d.status === 'open') out.push({ ...base, for: exp.payer, text: `‘${exp.title}’에 이의가 왔어요. 중재를 맡길까요?` });
    if (d.status === 'proposed') {
      for (const uid of [...new Set([exp.payer, d.by])].filter((u) => !d.agreedBy.includes(u))) out.push({ ...base, for: uid, text: `‘${exp.title}’ 중재안에 동의할까요?` });
    }
  }
  // 송금: 때가 된 것은 보내는 사람에게, 받는 계좌가 없으면 받는 사람에게(한 번만), 보낸 뒤에는 받는 사람에게 확인을
  const live = transfers.filter((t) => ['scheduled', 'due', 'opened'].includes(t.status));
  for (const t of live.filter((x) => x.status !== 'scheduled')) {
    out.push({ type: 'approve_transfer', ref: t.id, for: t.from, transferId: t.id, text: t.status === 'opened' ? `${name(t.to)}에게 ${won(t.amount)}을 보냈나요?` : `${name(t.to)}에게 ${won(t.amount)}을 보낼까요?` });
  }
  for (const to of new Set(live.filter((t) => !t.link && !t.fallback).map((t) => t.to))) {
    out.push({ type: 'set_payout', ref: `payout:${to}`, for: to, text: '받을 계좌를 알려 주면 바로 보낼 수 있어요' });
  }
  for (const t of transfers.filter((x) => x.status === 'sent')) {
    out.push({ type: 'confirm_receipt', ref: t.id, for: t.to, transferId: t.id, text: `${name(t.from)}가 보낸 ${won(t.amount)}을 받았나요?` });
  }
  return out;
}
