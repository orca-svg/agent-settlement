// 영수증 줄을 비서들이 공유한 기억으로 '누구 몫인가' 배분한다. 금액은 계산하지 않는다.
import { ruleAllocate } from '../../public/core.js';
import { memoryText, receiptTable, presentNames, lineSchema, cleanLines, inline, DATA_NOT_INSTRUCTIONS } from './lines.mjs';
import { promptKey } from './cache.mjs';
import { whose } from '../../public/ui.js';
import { isFlagged } from '../actions.mjs';

export function allocatePrompt(exp, room, memoryByUid) {
  const system = [
    '너는 정산을 돕는 비서들의 공동 작업자다. 영수증의 각 줄이 누구 몫인지(누가 먹고 마시거나 쓴 것인지) 추정한다.',
    '근거는 각 사람의 비서가 공유한 기억과 영수증 줄의 정보(항목·수량·태그)뿐이다. 기억에 없는 사실을 지어내지 않는다.',
    '',
    '규칙:',
    '1. 태그가 "나눠 먹는 안주"인 줄은 함께 있던 사람 모두에게 배정한다. 단, 기억상 그 음식을 먹지 않는 사람은 뺀다.',
    '2. 잔·1인분 단위인 줄은 수량만큼의 사람에게 배정한다(수량 2면 2명).',
    '3. 기억상 술을 마시지 않는 사람은 태그가 "술"인 줄에서 뺀다.',
    '4. 기억에 근거가 있으면 confidence를 0.7 이상, 근거 없이 추측했으면 0.5 미만으로 둔다.',
    '5. reason은 해요체 한 문장으로, 어떤 기억(누구의 비서 기억 “…”)을 썼는지 밝힌다. 근거가 없으면 그렇다고 쓴다.',
    '6. 금액은 계산하지 않는다. 계산은 코드가 한다.',
    `7. ${DATA_NOT_INSTRUCTIONS}`,
  ].join('\n');
  const payer = room.members.find((m) => m.uid === exp.payer)?.name ?? exp.payer;
  const user = [
    `함께 있던 사람: ${presentNames(exp, room.members)}`,
    `비서들이 공유한 기억:\n${memoryText(room.members, memoryByUid)}`,
    `영수증(${inline(exp.title, 60)}, ${payer}가 ${exp.method === 'card' ? '카드' : '현금'} 결제):\n${receiptTable(exp, false)}`,
    '영수증의 모든 줄(id)에 대해 배정 결과를 JSON으로 내라.',
  ].join('\n\n');
  const schema = { type: 'OBJECT', properties: { lines: { type: 'ARRAY', items: lineSchema(exp, room.members) } }, required: ['lines'] };
  return { system, user, schema };
}

// Gemini에게 묻지 않아도 답이 정해지는 영수증이면 { alloc, why }, 아니면 null.
// 함께 있던 사람이 한 명이거나, 줄이 하나이고 비서 기억이 그 줄에서 누구를 빼거나 고르지 않으면 함께 있던 사람이 똑같이 나눈다.
export function obviousAlloc(exp, room, memoryByUid) {
  const present = room.members.map((m) => m.uid).filter((u) => exp.present.includes(u));
  const all = (reason, confidence) => Object.fromEntries(exp.items.map((it) => [it.id, { consumers: [...present], confidence, reason }]));
  if (present.length === 1) {
    const name = room.members.find((m) => m.uid === present[0]).name;
    return { alloc: all(`함께 있던 사람이 ${name}뿐이에요.`, 1), why: `함께 있던 사람이 ${name}뿐이라 모두 ${whose(name)} 몫으로 했어요.` };
  }
  if (exp.items.length === 1 && ruleAllocate(exp, memoryByUid, room.members)[exp.items[0].id].consumers.length === present.length) {
    return { alloc: all(`줄이 하나라 함께 있던 ${present.length}명이 똑같이 나눠요.`, 0.9), why: `줄이 하나라 함께 있던 ${present.length}명이 똑같이 나눴어요.` };
  }
  return null;
}

// 방 사람 모두가 보는 줄 이유. 모델이나 규칙이 쓴 이유는 기억을 인용하거나 풀어 쓸 수 있어서 저장하지 않고,
// 누구 몫인지와 확인이 필요한지만으로 코드가 다시 쓴다. 기억 내용은 본인의 '내 비서'와 이의 중재에서만 보인다(#5)
export function publicReason(it, line, exp, room) {
  if (isFlagged(line)) return '누구 몫인지 비서들의 기억에 근거가 없어요. 확인이 필요해요.';
  const present = room.members.map((m) => m.uid).filter((u) => exp.present.includes(u));
  if (present.every((u) => line.consumers.includes(u))) return it.tags?.includes('나눠 먹는 안주') ? '함께 있던 사람이 나눠 먹는 안주예요.' : '함께 있던 사람 모두의 몫이에요.';
  const names = line.consumers.map((u) => room.members.find((m) => m.uid === u)?.name ?? u).join('·');
  return `${names}의 몫이에요. 수량과 비서들의 기억으로 정했어요.`;
}

// → { alloc: Record<itemId, LineAlloc>, source: 모델 이름 | 'rules', how, why?, error? }
// how: 'obvious'(묻지 않아도 정해짐) | 'cache'(같은 입력의 이전 답) | 'gemini' | 'rules'(키가 없거나 실패)
export async function allocateWithGemini(gemini, exp, room, memoryByUid, { cache } = {}) {
  const obvious = obviousAlloc(exp, room, memoryByUid);
  if (obvious) return { ...obvious, source: 'rules', how: 'obvious' };
  const fallback = ruleAllocate(exp, memoryByUid, room.members);
  if (!gemini) return { alloc: fallback, source: 'rules', how: 'rules' };
  const prompt = allocatePrompt(exp, room, memoryByUid);
  const key = cache && promptKey(gemini.model, prompt);
  try {
    let raw = key && cache.get(key);
    const how = raw ? 'cache' : 'gemini';
    if (!raw) {
      raw = await gemini.generate(prompt);
      if (key && Array.isArray(raw?.lines) && raw.lines.length) cache.set(key, raw);
    }
    return { alloc: cleanLines(exp, room.members, raw.lines, fallback, () => exp.present), source: gemini.model, how };
  } catch (e) {
    console.warn('[allocate] Gemini 실패, 규칙으로 대신:', e.message);
    return { alloc: fallback, source: 'rules', how: 'rules', error: e.message };
  }
}
