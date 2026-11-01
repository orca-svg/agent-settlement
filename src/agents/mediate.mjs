// 이의 제기를 중립 비서가 중재한다. 'left_at' 증거가 있으면 그 시각 뒤 주문에서 그 사람을 코드가 다시 뺀다.
import { ruleAllocate, presentAfter } from '../../public/core.js';
import { memoryText, receiptTable, presentNames, lineSchema, cleanLines } from './lines.mjs';

const COUNT = { 2: '둘', 3: '셋', 4: '넷', 5: '다섯', 6: '여섯' };

export function presentAtFor(exp, dispute) {
  const left = (dispute.evidence || []).find((e) => e.kind === 'left_at' && e.time);
  return left ? presentAfter(exp, dispute.by, left.time) : () => exp.present;
}

export function mediatePrompt({ exp, room, dispute, counter = [], memoryByUid }) {
  const name = (uid) => room.members.find((m) => m.uid === uid)?.name ?? uid;
  const system = [
    '너는 정산 분쟁을 맡은 중립적인 중재 비서다. 어느 한쪽 편을 들지 않는다.',
    '양쪽 비서가 낸 주장과 근거, 주문 시각이 적힌 영수증, 각자의 비서가 공유한 기억을 보고 영수증 각 줄을 누가 부담할지 제안한다.',
    '',
    '규칙:',
    '1. 근거로 확인되는 사실만 쓴다. 근거끼리 맞지 않으면 confidence를 낮춘다.',
    '2. 결제 시각과 주문 시각을 구분한다. 자리를 떠난 사람은 떠난 뒤의 주문을 부담하지 않는다.',
    '3. "나눠 먹는 안주"는 그 주문 시각에 있던 사람 모두, 잔 단위 항목은 수량만큼의 사람에게 배정한다. 기억상 술을 마시지 않는 사람은 "술" 줄에서 뺀다.',
    '4. summary와 reason은 해요체로 쓴다. summary는 양쪽이 바로 이해할 수 있게 두 문장 이내로 쓴다. 금액은 계산하지 않는다.',
  ].join('\n');
  const user = [
    `지출: ${exp.title} (${name(exp.payer)} ${exp.method === 'card' ? '카드' : '현금'} 결제 ${exp.time}), 함께 있던 사람: ${presentNames(exp, room.members)}`,
    `현재 청구 방식: ${exp.split === 'items' ? '줄마다 나눔' : '함께 있던 사람이 똑같이 나눔'}`,
    `이의 제기(${name(dispute.by)}의 비서): ${dispute.claim}\n근거: ${(dispute.evidence || []).map((e) => e.summary).join(' / ') || '(없음)'}`,
    `${name(exp.payer)}의 비서 기록: ${counter.join(' / ') || '(없음)'}`,
    `영수증:\n${receiptTable(exp, true)}`,
    `비서들이 공유한 기억:\n${memoryText(room.members, memoryByUid)}`,
    '중재안을 JSON으로 내라.',
  ].join('\n\n');
  const schema = {
    type: 'OBJECT',
    properties: { summary: { type: 'STRING' }, lines: { type: 'ARRAY', items: lineSchema(exp, room.members) } },
    required: ['summary', 'lines'],
    propertyOrdering: ['summary', 'lines'],
  };
  return { system, user, schema };
}

function ruleSummary(exp, room, dispute) {
  const left = (dispute.evidence || []).find((e) => e.kind === 'left_at' && e.time);
  const by = room.members.find((m) => m.uid === dispute.by)?.name ?? dispute.by;
  const n = exp.present.length;
  const before = COUNT[n] ? `${COUNT[n]}이` : '모두가';
  const after = COUNT[n - 1] ? `${COUNT[n - 1]}이` : '나머지가';
  const head = left ? `${left.time} 이전 주문은 ${before}, 이후 주문은 ${by}를 뺀 ${after} 나눠요.` : '주문마다 그 몫인 사람끼리 나눠요.';
  return `${head} 술을 마시지 않는 사람은 술값에서 빠져요.`;
}

// → { summary, alloc, source: 모델 이름 | 'rules', error? }
export async function mediateWithGemini(gemini, { exp, room, dispute, counter = [], memoryByUid }) {
  const presentAt = presentAtFor(exp, dispute);
  const fallback = ruleAllocate(exp, memoryByUid, room.members, presentAt);
  const summary = ruleSummary(exp, room, dispute);
  if (!gemini) return { summary, alloc: fallback, source: 'rules' };
  try {
    const raw = await gemini.generate(mediatePrompt({ exp, room, dispute, counter, memoryByUid }));
    return {
      summary: String(raw.summary || summary).slice(0, 300),
      alloc: cleanLines(exp, room.members, raw.lines, fallback, presentAt),
      source: gemini.model,
    };
  } catch (e) {
    console.warn('[mediate] Gemini 실패, 규칙으로 대신:', e.message);
    return { summary, alloc: fallback, source: 'rules', error: e.message };
  }
}
