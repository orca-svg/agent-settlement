// 이의 제기에 쓰는 근거. #7(위치)이 이 함수를 위치 요약으로 바꾼다. 원본 위치는 넣지 않는다.
// 지금은 개발용 데모 방(시드 id가 'demo-')의 '2차 바'에서 민수만 근거가 있다.
// counterFor는 지출을 낸 사람의 비서 기록(중재에 함께 내는 반대쪽 근거)이다.
import { DEMO_DISPUTE } from '../../public/data.js';
import { DEMO_UIDS } from '../dev/seed.mjs';

// #7 extension point. Keep the three-argument provider contract used by #9.
// The caller explicitly opts into fixture evidence; real accounts never receive it.
export function createEvidenceProvider({ locationService, dev = false }) {
  return async (uid, expense, room) => [
    ...await locationService.evidenceFor(uid, expense, room),
    ...(dev ? await evidenceFor(uid, expense, room) : []),
  ];
}

const isDemoBar = (expense, room) => room.id.startsWith('demo-') && expense.id === `${room.id}-${DEMO_DISPUTE.expense}`;

/** @returns {Promise<import('../domain/types.mjs').Evidence[]>} */
export async function evidenceFor(uid, expense, room) {
  if (!isDemoBar(expense, room) || uid !== DEMO_UIDS[DEMO_DISPUTE.by]) return [];
  const [first, ...rest] = DEMO_DISPUTE.evidence;
  return [{ kind: 'left_at', time: DEMO_DISPUTE.leftAt, summary: first }, ...rest.map((summary) => ({ kind: 'text', summary }))];
}

/** @returns {Promise<string[]>} */
export async function counterFor(expense, room) {
  return isDemoBar(expense, room) ? [...DEMO_DISPUTE.counter] : [];
}
