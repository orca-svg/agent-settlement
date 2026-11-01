// 돈 계산은 모두 여기서 한다. 화면·서버·테스트가 함께 쓴다.
// AI는 '누가 먹었나'만 추정하고, 환율 적용·나누기·송금 경로는 코드가 정한다.
import { PEOPLE, FX, EXPENSES } from './data.js';

export const won = (n) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
export const yen = (n) => `¥${Math.round(n).toLocaleString('ko-KR')}`;
export const dayLabel = (d) => `${Number(d.slice(0, 2))}/${Number(d.slice(3))}`;

export const jpyOf = (exp) => (exp.items ? exp.items.reduce((s, it) => s + it.qty * it.unit, 0) : exp.jpy);

// 환율 정책에 따라 이 지출을 원화로 바꾸고, 그 근거를 한 줄로 남긴다.
export function toKrw(exp, policy) {
  const jpy = jpyOf(exp);
  const day = FX.base[exp.date];
  if (policy === 'settle') {
    return { krw: Math.round((jpy * FX.settle.rate) / 100), how: `${yen(jpy)} × 정산일(${dayLabel(FX.settle.date)}) 기준율 ${FX.settle.rate.toFixed(2)}원/100엔` };
  }
  if (policy === 'payday') {
    return { krw: Math.round((jpy * day) / 100), how: `${yen(jpy)} × 결제일(${dayLabel(exp.date)}) 기준율 ${day.toFixed(2)}원/100엔` };
  }
  if (exp.method === 'card') {
    return {
      krw: Math.round(((jpy * day) / 100) * (1 + FX.cardFee)),
      how: `카드 청구액: ${yen(jpy)} × ${day.toFixed(2)}원/100엔 × 해외 이용 수수료 ${(FX.cardFee * 100).toFixed(1)}%`,
    };
  }
  const rate = FX.cash[exp.payer];
  return { krw: Math.round((jpy * rate) / 100), how: `현금: ${yen(jpy)} × ${exp.payer}가 환전한 평균 ${rate.toFixed(2)}원/100엔` };
}

// 사람별 몫. mode가 'items'면 줄마다 먹은 사람끼리 나누고, 아니면 함께 있던 사람이 똑같이 나눈다.
// 원 단위 끝전은 낸 사람이 안는다.
export function shares(exp, policy, mode, alloc) {
  const { krw } = toKrw(exp, policy);
  const jpy = jpyOf(exp);
  const w = {};
  if (mode === 'items' && exp.items) {
    for (const it of exp.items) {
      const who = alloc?.[it.id]?.consumers?.length ? alloc[it.id].consumers : exp.present;
      for (const p of who) w[p] = (w[p] || 0) + (it.qty * it.unit) / who.length;
    }
  } else {
    for (const p of exp.present) w[p] = jpy / exp.present.length;
  }
  const krwShare = {};
  let sum = 0;
  for (const p of Object.keys(w)) {
    krwShare[p] = Math.floor((krw * w[p]) / jpy);
    sum += krwShare[p];
  }
  krwShare[exp.payer] = (krwShare[exp.payer] || 0) + (krw - sum);
  return { krw, jpyShare: w, krwShare };
}

// 사람별 낸 돈, 내 몫, 차액(+면 받을 돈, −면 보낼 돈)
export function ledger({ policy, modes, allocs }) {
  const rows = Object.fromEntries(PEOPLE.map((p) => [p, { paid: 0, owed: 0, net: 0 }]));
  for (const exp of EXPENSES) {
    const s = shares(exp, policy, modes[exp.id] ?? exp.split ?? 'equal', allocs[exp.id]);
    rows[exp.payer].paid += s.krw;
    for (const [p, v] of Object.entries(s.krwShare)) rows[p].owed += v;
  }
  for (const p of PEOPLE) rows[p].net = rows[p].paid - rows[p].owed;
  return rows;
}

// 가장 많이 보낼 사람이 가장 많이 받을 사람에게 보내는 식으로 송금 횟수를 줄인다(사람 수 − 1번 이하).
export function settle(rows) {
  const cred = PEOPLE.filter((p) => rows[p].net > 0).map((p) => ({ p, v: rows[p].net })).sort((a, b) => b.v - a.v);
  const debt = PEOPLE.filter((p) => rows[p].net < 0).map((p) => ({ p, v: -rows[p].net })).sort((a, b) => b.v - a.v);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const amount = Math.min(debt[i].v, cred[j].v);
    if (amount > 0) out.push({ from: debt[i].p, to: cred[j].p, amount });
    debt[i].v -= amount;
    cred[j].v -= amount;
    if (debt[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return out;
}

// --- Gemini가 없을 때 쓰는 규칙 배분. 서버의 대체 응답과 화면의 오프라인 모드가 함께 쓴다. ---
const mentions = (memory, p, re) => (memory[p] || []).find((m) => re.test(m));
const NO_ALCOHOL = /술을\s*(마시지|안\s*마시|못\s*마시)/;
const NO_RAW = /날생선|회를?\s*(먹지|안\s*먹|못\s*먹)/;

export function ruleAllocate(exp, memory, presentAt = () => exp.present) {
  const out = {};
  for (const it of exp.items) {
    const present = presentAt(it);
    const notes = [];
    const eligible = present.filter((p) => {
      const m = (it.tags.includes('술') && mentions(memory, p, NO_ALCOHOL)) || (it.tags.includes('날생선') && mentions(memory, p, NO_RAW));
      if (m) notes.push(`${p}의 비서 기억 “${m}”`);
      return !m;
    });
    const named = eligible.filter((p) => mentions(memory, p, new RegExp(it.name)));
    const sober = present.filter((p) => mentions(memory, p, NO_ALCOHOL));
    const except = notes.length ? ` (${notes.join(', ')} → 제외)` : '';
    if (it.tags.includes('나눠 먹는 안주')) {
      out[it.id] = { consumers: eligible, confidence: 0.9, reason: `함께 있던 사람이 나눠 먹는 안주예요${except}.` };
    } else if (it.qty === eligible.length) {
      out[it.id] = { consumers: eligible, confidence: 0.85, reason: `${it.qty}개를 ${eligible.join('·')}가 하나씩${except}.` };
    } else if (it.qty === 1 && named.length === 1) {
      out[it.id] = { consumers: named, confidence: 0.75, reason: `${named[0]}의 비서 기억 “${mentions(memory, named[0], new RegExp(it.name))}”.` };
    } else if (it.tags.includes('무알코올 음료') && sober.length === it.qty) {
      out[it.id] = { consumers: sober, confidence: 0.75, reason: `술을 마시지 않는 ${sober.join('·')}의 음료로 봤어요.` };
    } else {
      out[it.id] = { consumers: eligible, confidence: 0.35, reason: '누가 먹었는지 비서들의 기억에 없어요. 확인이 필요해요.' };
    }
  }
  return out;
}

// 이의 제기 쪽이 떠난 시각 뒤의 주문에서는 그 사람을 뺀다.
export const presentAfterLeaving = (exp, dispute) => (it) =>
  it.time > dispute.leftAt ? exp.present.filter((p) => p !== dispute.by) : exp.present;
