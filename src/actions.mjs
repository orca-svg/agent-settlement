// 사람이 처리해야 할 일. 이벤트 기록이 아니라 현재 상태에서 계산하므로, 처리한 일은 자연히 빠진다.

import { topic } from '../public/ui.js';
import { won } from '../public/core.js';

export const isFlagged = (line) => Boolean(line) && line.confidence < 0.7 && !line.confirmed;

export function pendingActions({ expenses = [], invoices = [] }) {
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
  return out;
}
