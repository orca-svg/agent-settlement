// 방 상태와 환율 정책 동의(#4). 서버와 테스트가 함께 쓴다.
// 방 상태: 'ready'(준비) → 'settling'(정산 중, 청구서를 처음 보낸 뒤). 진행 중·완료는 이후 단계에서 나눈다.
// status가 없는 방(개발용 시드 등 이전 방)은 청구서가 있는지로 판단하지 않고 준비 중으로 본다.

export const isSettling = (room) => room.status === 'settling';

// 아직 지금 환율 정책에 동의하지 않은 멤버
export const notAgreed = (room) => room.members.filter((m) => !m.deleted && !room.policyAgreedBy.includes(m.uid));
