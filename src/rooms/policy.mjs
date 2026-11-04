// 방 상태와 환율 정책 동의(#4), 나가기 조건(#55). 서버와 테스트가 함께 쓴다.
// 방 상태: 'ready'(준비) → 'settling'(정산 중, 청구서를 처음 보낸 뒤) → 'done'(완료, 지금 묶음의 송금이 모두 '받았어요'로 끝난 뒤).
// 완료된 방은 닫힌다. 지출·이의·초대를 더 받지 않는다(다시 나누면 이미 오간 돈을 또 보내게 된다).
// status가 없는 방(개발용 시드 등 이전 방)은 청구서가 있는지로 판단하지 않고 준비 중으로 본다.
import { active, isForeign } from '../../public/core.js';

export const isSettling = (room) => room.status === 'settling';
export const isDone = (room) => room.status === 'done';
// 청구서를 한 번이라도 보낸 방. 초대·참가·정책 변경을 막는다
export const hasStarted = (room) => isSettling(room) || isDone(room);

// 아직 지금 환율 정책에 동의하지 않은 멤버. 원화 방에는 환율 정책이 없으니 늘 비어 있다(#55)
export const notAgreed = (room) => (isForeign(room) ? room.members.filter((m) => active(m) && !(room.policyAgreedBy ?? []).includes(m.uid)) : []);

// 방에서 빠지는 조건은 화면도 누르기 전에 이유를 보이려고 함께 쓴다(public/leave.js)
export { leaveBlock } from '../../public/leave.js';
