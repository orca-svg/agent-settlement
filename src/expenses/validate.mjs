// 지출 입력 검증. 화면이 보낸 값을 믿지 않고, 방 멤버·통화·환율이 맞는지 확인한 뒤 정리된 지출을 돌려준다.
import { TAGS } from '../domain/types.mjs';
import { active } from '../../public/core.js';
import { decimalsOf } from '../../public/currencies.js';

const KINDS = ['stay', 'food', 'ticket', 'drink', 'shop', 'bus'];
const isInt = (n) => Number.isInteger(n);
// 외화 방(#55)의 달러·유로 같은 통화는 0.01 단위까지 받는다. 원·엔은 정수
const fits = (n, places) => Number.isFinite(n) && Math.abs(Math.round(n * 10 ** places) - n * 10 ** places) < 1e-6;
const unitText = (places) => (places ? `0.${'0'.repeat(places - 1)}1 단위까지 적어 주세요` : '정수여야 해요');
// 영수증 줄 id는 AI 프롬프트의 표와 배분 결과의 키로 쓰인다. 줄바꿈 등으로 프롬프트 모양을 바꾸지 못하게 형식을 좁힌다(#10)
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export function validateExpense(input, room) {
  const errors = [];
  const uids = room.members.filter(active).map((m) => m.uid);
  // 금액의 소수 자리는 그 방에서 쓰는 통화를 따른다. 방에 없는 통화는 아래에서 걸러진다
  const places = input?.currency !== 'KRW' && input?.currency === room.fx?.currency ? decimalsOf(input.currency) : 0;
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || '지출';

  let items;
  let amount;
  if (Array.isArray(input?.items) && input.items.length) {
    if (input.items.length > 50) errors.push('영수증 줄은 50개까지예요');
    items = input.items.slice(0, 50).map((it, i) => ({
      id: String(it.id || `line-${i + 1}`),
      name: String(it.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || `항목 ${i + 1}`,
      qty: Number(it.qty),
      unit: Number(it.unit),
      ...(/^\d{2}:\d{2}$/.test(it.time ?? '') ? { time: it.time } : {}),
      tags: (Array.isArray(it.tags) ? it.tags : []).map((t) => (TAGS.includes(t) ? t : '기타')).filter((t, j, a) => a.indexOf(t) === j),
    }));
    if (items.some((it) => !SAFE_ID.test(it.id))) errors.push('영수증 줄 id 형식이 맞지 않아요');
    if (items.some((it) => !isInt(it.qty) || it.qty < 1 || it.qty > 99)) errors.push('수량은 1~99 사이 정수여야 해요');
    if (items.some((it) => !fits(it.unit, places))) errors.push(`단가는 ${unitText(places)}`);
    const sum = items.reduce((s, it) => s + it.qty * it.unit, 0);
    if (!(sum >= (places ? 0.01 : 1))) errors.push(`금액(줄의 합)은 ${places ? '0보다 커야' : '1 이상이어야'} 해요`);
  } else {
    amount = Number(input?.amount);
    if (!fits(amount, places) || amount < (places ? 0.01 : 1)) errors.push(places ? `금액은 0보다 크고 ${unitText(places)}` : '금액은 1 이상 정수여야 해요');
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
  } else if (currency !== 'KRW' && !room.fx.base[date]) {
    // 실제 방은 저장 전에 결제일 환율을 받아 넣는다(src/rooms/fx.mjs의 withDayRate). 여기 오면 받지 못한 것이다
    errors.push('이 날짜의 환율이 없어요');
  }
  // 현금으로 낸 외화에 낸 사람의 환전 환율이 없으면 결제일 기준율로 셈한다(public/core.js의 toKrw)

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
