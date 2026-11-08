// 돈 계산은 모두 여기서 한다. 화면·서버·테스트가 함께 쓴다.
// AI는 '줄마다 누구 몫인가'만 추정하고, 환율 적용·나누기·송금 경로는 코드가 정한다.
// 모든 함수는 방(room)과 지출(expense)을 인자로 받는다. 사람 키는 member.uid다.

export const won = (n) => `₩${Math.round(n).toLocaleString('ko-KR')}`;
export const yen = (n) => `¥${Math.round(n).toLocaleString('ko-KR')}`;
// 원·엔이 아닌 외화는 센트 같은 소수 둘째 자리까지 보인다(#55 외화 방)
export const money = (n, currency) => (currency === 'KRW' ? won(n) : currency === 'JPY' ? yen(n) : `${(Math.round(n * 100) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })} ${currency}`);
// 'YYYY-MM-DD' → 'M/D'
export const dayLabel = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

export const amountOf = (exp) => (exp.items ? exp.items.reduce((s, it) => s + it.qty * it.unit, 0) : exp.amount);

const nameOf = (members, uid) => members.find((m) => m.uid === uid)?.name ?? uid;

// 방에서 지금 함께하는 멤버. 탈퇴한 사람(deleted)과 방에서 나간 사람(left, #55)은 지출·송금 기록에만 남는다
export const active = (m) => !m.deleted && !m.left;
// 외화 지출을 정산하는 방(#55). 환율 정책은 이 방에만 있고, 원화 방(fx 없음)은 정책을 묻지도 보이지도 않는다.
// 예전 원화 방에 남은 policy·policyAgreedBy 값은 이 판단으로 읽을 때 무시한다
export const isForeign = (room) => Boolean(room?.fx?.currency);

// 환율 정책에 따라 이 지출을 원화로 바꾸고, 그 근거를 한 줄로 남긴다.
export function toKrw(exp, room, policy) {
  const amount = amountOf(exp);
  if (exp.currency === 'KRW') return { krw: amount, how: '원화 결제' };
  const fx = room.fx;
  const cur = money(amount, exp.currency);
  const day = fx.base[exp.date];
  if (policy === 'settle' && fx.settle) {
    return { krw: Math.round((amount * fx.settle.rate) / 100), how: `${cur} × 정산일(${dayLabel(fx.settle.date)}) 기준율 ${fx.settle.rate.toFixed(2)}원/100` };
  }
  // 정산일 환율은 청구서를 처음 보낼 때 정해진다(#55). 그 전에는 결제일 기준율로 미리 보여 준다
  if (policy === 'payday' || policy === 'settle') {
    const later = policy === 'settle' ? ' · 정산일 환율은 청구서를 보낼 때 정해져요' : '';
    return { krw: Math.round((amount * day) / 100), how: `${cur} × 결제일(${dayLabel(exp.date)}) 기준율 ${day.toFixed(2)}원/100${later}` };
  }
  if (exp.method === 'card') {
    return {
      krw: Math.round(((amount * day) / 100) * (1 + fx.cardFee)),
      how: `카드 청구액: ${cur} × ${day.toFixed(2)}원/100 × 해외 이용 수수료 ${(fx.cardFee * 100).toFixed(1)}%`,
    };
  }
  const rate = fx.cash?.[exp.payer];
  // 환전한 환율을 적지 않았으면(#55 실제 방) 결제일 기준율로 셈하고 그렇다고 밝힌다
  if (!rate) return { krw: Math.round((amount * day) / 100), how: `현금: ${cur} × 결제일(${dayLabel(exp.date)}) 기준율 ${day.toFixed(2)}원/100 · ${nameOf(room.members, exp.payer)}의 환전 환율이 없어서` };
  return { krw: Math.round((amount * rate) / 100), how: `현금: ${cur} × ${nameOf(room.members, exp.payer)}가 환전한 평균 ${rate.toFixed(2)}원/100` };
}

// 사람별 몫. split이 'items'면 줄마다 그 줄의 몫인 사람끼리 나누고, 아니면 함께 있던 사람이 똑같이 나눈다.
// 원 단위로 나누고 남은 돈(rest)은 낸 사람 몫에 더한다.
export function shares(exp, room, policy, alloc = exp.alloc) {
  const { krw } = toKrw(exp, room, policy);
  const amount = amountOf(exp);
  const share = {};
  if (exp.split === 'items' && exp.items) {
    for (const it of exp.items) {
      const who = alloc?.[it.id]?.consumers?.length ? alloc[it.id].consumers : exp.present;
      for (const p of who) share[p] = (share[p] || 0) + (it.qty * it.unit) / who.length;
    }
  } else {
    for (const p of exp.present) share[p] = amount / exp.present.length;
  }
  const krwShare = {};
  let sum = 0;
  for (const p of Object.keys(share)) {
    krwShare[p] = Math.floor((krw * share[p]) / amount);
    sum += krwShare[p];
  }
  const rest = krw - sum;
  krwShare[exp.payer] = (krwShare[exp.payer] || 0) + rest;
  return { krw, share, krwShare, rest };
}

// 사람별 낸 돈, 내 몫, 차액(+면 받을 돈, −면 보낼 돈)
export function ledger(room, expenses, policy) {
  const rows = Object.fromEntries(room.members.map((m) => [m.uid, { paid: 0, owed: 0, net: 0 }]));
  for (const exp of expenses) {
    const s = shares(exp, room, policy);
    rows[exp.payer].paid += s.krw;
    for (const [p, v] of Object.entries(s.krwShare)) rows[p].owed += v;
  }
  for (const uid of Object.keys(rows)) rows[uid].net = rows[uid].paid - rows[uid].owed;
  return rows;
}

// 가장 많이 보낼 사람이 가장 많이 받을 사람에게 보내는 식으로 송금 횟수를 줄인다(사람 수 − 1번 이하).
export function settle(rows) {
  const uids = Object.keys(rows);
  const cred = uids.filter((p) => rows[p].net > 0).map((p) => ({ p, v: rows[p].net })).sort((a, b) => b.v - a.v);
  const debt = uids.filter((p) => rows[p].net < 0).map((p) => ({ p, v: -rows[p].net })).sort((a, b) => b.v - a.v);
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

// 이미 오간 돈: 지금 묶음(version) 전에 보냈다고 했거나 받았다고 한 송금. 지출이 바뀌어도 이 돈은 다시 보내게 하지 않는다
export const movedBefore = (transfers, version) => transfers.filter((t) => t.version < version && ['sent', 'confirmed'].includes(t.status));

// 차액(net)에서 이미 오간 돈을 뺀다. 보낸 사람은 보낼 돈이, 받은 사람은 받을 돈이 그만큼 준다. settle()에 넘기면 남은 차액만 송금이 된다
export function afterMoved(rows, moved) {
  const out = Object.fromEntries(Object.entries(rows).map(([uid, r]) => [uid, { ...r }]));
  for (const t of moved) {
    if (out[t.from]) out[t.from].net += t.amount;
    if (out[t.to]) out[t.to].net -= t.amount;
  }
  return out;
}

// --- Gemini가 없을 때 쓰는 규칙 배분. 서버의 대체 응답과 화면의 오프라인 모드가 함께 쓴다. ---
const mentions = (memory, p, re) => (memory[p] || []).find((m) => re.test(m));
const NO_ALCOHOL = /술을\s*(마시지|안\s*마시|못\s*마시)/;
const NO_RAW = /날생선|회를?\s*(먹지|안\s*먹|못\s*먹)/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function ruleAllocate(exp, memoryByUid, members, presentAt = () => exp.present) {
  const name = (uid) => nameOf(members, uid);
  const out = {};
  for (const it of exp.items) {
    const present = presentAt(it);
    const notes = [];
    const eligible = present.filter((p) => {
      const m = (it.tags.includes('술') && mentions(memoryByUid, p, NO_ALCOHOL)) || (it.tags.includes('날생선') && mentions(memoryByUid, p, NO_RAW));
      if (m) notes.push(`${name(p)}의 비서 기억 “${m}”`);
      return !m;
    });
    const itemRe = new RegExp(escapeRe(it.name));
    const named = eligible.filter((p) => mentions(memoryByUid, p, itemRe));
    const sober = present.filter((p) => mentions(memoryByUid, p, NO_ALCOHOL));
    const except = notes.length ? ` (${notes.join(', ')} → 제외)` : '';
    if (it.tags.includes('나눠 먹는 안주')) {
      out[it.id] = { consumers: eligible, confidence: 0.9, reason: `함께 있던 사람이 나눠 먹는 안주예요${except}.` };
    } else if (it.qty === eligible.length) {
      out[it.id] = { consumers: eligible, confidence: 0.85, reason: `${it.qty}개를 ${eligible.map(name).join('·')}가 하나씩${except}.` };
    } else if (it.qty === 1 && named.length === 1) {
      out[it.id] = { consumers: named, confidence: 0.75, reason: `${name(named[0])}의 비서 기억 “${mentions(memoryByUid, named[0], itemRe)}”.` };
    } else if (it.tags.includes('무알코올 음료') && sober.length === it.qty) {
      out[it.id] = { consumers: sober, confidence: 0.75, reason: `술을 마시지 않는 ${sober.map(name).join('·')}의 음료로 봤어요.` };
    } else {
      out[it.id] = { consumers: eligible, confidence: 0.35, reason: '누구 몫인지 비서들의 기억에 근거가 없어요. 확인이 필요해요.' };
    }
  }
  return out;
}

// uid가 time에 자리를 떠났다면, 그 뒤의 주문에서는 그 사람을 뺀다.
export const presentAfter = (exp, uid, time) => (it) =>
  it.time > time ? exp.present.filter((p) => p !== uid) : exp.present;
