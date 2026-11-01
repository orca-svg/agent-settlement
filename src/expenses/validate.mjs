// 지출 입력 검증. 화면이 보낸 값을 믿지 않고, 방 멤버·통화·환율이 맞는지 확인한 뒤 정리된 지출을 돌려준다.
import { TAGS } from '../domain/types.mjs';

const KINDS = ['stay', 'food', 'ticket', 'drink', 'shop', 'bus'];
const isInt = (n) => Number.isInteger(n);

export function validateExpense(input, room) {
  const errors = [];
  const uids = room.members.map((m) => m.uid);
  const nameOf = (uid) => room.members.find((m) => m.uid === uid)?.name ?? uid;
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || '지출';

  let items;
  let amount;
  if (Array.isArray(input?.items) && input.items.length) {
    if (input.items.length > 50) errors.push('영수증 줄은 50개까지예요');
    items = input.items.slice(0, 50).map((it, i) => ({
      id: String(it.id || `line-${i + 1}`).slice(0, 40),
      name: String(it.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || `항목 ${i + 1}`,
      qty: Number(it.qty),
      unit: Number(it.unit),
      ...(/^\d{2}:\d{2}$/.test(it.time ?? '') ? { time: it.time } : {}),
      tags: (Array.isArray(it.tags) ? it.tags : []).map((t) => (TAGS.includes(t) ? t : '기타')).filter((t, j, a) => a.indexOf(t) === j),
    }));
    if (items.some((it) => !isInt(it.qty) || it.qty < 1 || it.qty > 99)) errors.push('수량은 1~99 사이 정수여야 해요');
    if (items.some((it) => !isInt(it.unit))) errors.push('단가는 정수여야 해요');
    const sum = items.reduce((s, it) => s + it.qty * it.unit, 0);
    if (!(sum >= 1)) errors.push('금액(줄의 합)은 1 이상이어야 해요');
  } else {
    amount = Number(input?.amount);
    if (!isInt(amount) || amount < 1) errors.push('금액은 1 이상 정수여야 해요');
  }

  const payer = String(input?.payer ?? '');
  if (!uids.includes(payer)) errors.push('낸 사람이 이 방 멤버가 아니에요');
  const presentIn = Array.isArray(input?.present) ? input.present.map(String) : [];
  if (!presentIn.length) errors.push('함께한 사람을 한 명 이상 골라 주세요');
  if (presentIn.some((u) => !uids.includes(u))) errors.push('함께한 사람 중에 이 방 멤버가 아닌 사람이 있어요');
  const present = uids.filter((u) => presentIn.includes(u));

  const method = input?.method;
  if (method !== 'card' && method !== 'cash') errors.push('결제 수단은 카드나 현금이어야 해요');
  const currency = String(input?.currency ?? '');
  const date = String(input?.date ?? '');
  const time = String(input?.time ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('날짜 형식이 맞지 않아요');
  if (!/^\d{2}:\d{2}$/.test(time)) errors.push('시각 형식이 맞지 않아요');
  if (currency !== 'KRW' && currency !== room.fx?.currency) {
    errors.push('이 방에서 쓰지 않는 통화예요');
  } else if (currency !== 'KRW') {
    if (!room.fx.base[date]) errors.push('이 날짜의 환율이 없어요');
    if (method === 'cash' && uids.includes(payer) && !room.fx.cash?.[payer]) errors.push(`${nameOf(payer)}의 환전 환율이 없어요. 현금으로 낸 외화는 낸 사람이 환전한 환율로 계산해요`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    expense: {
      title,
      kind: KINDS.includes(input?.kind) ? input.kind : 'shop',
      date,
      time,
      payer,
      method,
      currency,
      ...(items ? { items } : { amount }),
      split: items ? 'items' : 'equal',
      present,
      source: input?.source === 'receipt' ? 'receipt' : 'manual',
    },
  };
}
