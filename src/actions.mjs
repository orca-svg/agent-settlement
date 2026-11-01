// 사람이 처리해야 할 일. 이벤트 기록이 아니라 현재 상태에서 계산하므로, 처리한 일은 자연히 빠진다.
// #9에서 청구서 답하기·이의 동의·송금 승인·받았어요 확인을 여기에 더한다.

import { topic } from '../public/ui.js';

export const isFlagged = (line) => Boolean(line) && line.confidence < 0.7 && !line.confirmed;

export function pendingActions({ expenses }) {
  const out = [];
  for (const exp of expenses) {
    for (const it of exp.items ?? []) {
      if (isFlagged(exp.alloc?.[it.id])) {
        out.push({ type: 'confirm_line', ref: `${exp.id}:${it.id}`, for: exp.createdBy, text: `${topic(`‘${it.name}’`)} 어떻게 나눌까요?`, expenseId: exp.id, itemId: it.id });
      }
    }
  }
  return out;
}
