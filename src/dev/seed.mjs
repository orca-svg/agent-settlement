// 개발용 시드: 데모 시나리오(오사카 2박 3일)를 실제 방 데이터 모양으로 넣는다.
// 데모 화면은 이름을 uid로 쓰지만, 실제 방의 uid는 ASCII여야 해서(HTTP 헤더·Firebase uid) 여기서 바꾼다.
// #4 방 만들기가 생기면 이 시드는 개발·데모 확인용으로만 남는다.
import { DEMO_ROOM, DEMO_EXPENSES, DEMO_MEMORY, DEMO_RULES } from '../../public/data.js';

export const DEMO_UIDS = { 나: 'me', 철수: 'cs', 영희: 'yh', 민수: 'ms' };
const uid = (name) => DEMO_UIDS[name] ?? name;
const SEND_WHEN = { 바로: 'now', '25일 월급날': { payday: 25 } };
const ON_DISPUTE = { '중재 비서에게 맡기기': 'mediator', '나에게 묻기': 'ask', '근거가 있으면 이의 제기': 'evidence' };
const mapKeys = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [uid(k), v]));

// freshUid: 비서 문서를 만들지 않는 멤버. 비서를 아직 설정하지 않은 새 사용자로 시작한다(#5 처음 설정 확인용)
export async function seedDemoRoom(store, { id, freshUid = null }) {
  const room = {
    ...structuredClone(DEMO_ROOM),
    id,
    members: DEMO_ROOM.members.map((m) => ({ uid: uid(m.uid), name: m.name })),
    policyAgreedBy: DEMO_ROOM.policyAgreedBy.map(uid),
    createdBy: uid(DEMO_ROOM.createdBy),
    fx: { ...structuredClone(DEMO_ROOM.fx), cash: mapKeys(DEMO_ROOM.fx.cash) },
  };
  await store.put('rooms', room);

  for (const e of DEMO_EXPENSES) {
    const { source, ...rest } = structuredClone(e);
    await store.put('expenses', {
      ...rest,
      id: `${id}-${e.id}`,
      roomId: id,
      payer: uid(e.payer),
      present: e.present.map(uid),
      source: source === '영수증 사진' ? 'receipt' : 'manual',
      createdBy: uid(e.payer),
    });
  }

  // 가상 계좌다. 실제 계좌가 아니다.
  for (const [i, m] of DEMO_ROOM.members.entries()) {
    if (uid(m.uid) === freshUid) continue;
    const r = DEMO_RULES[m.uid];
    await store.put('agents', {
      id: uid(m.uid),
      uid: uid(m.uid),
      memory: [...DEMO_MEMORY[m.uid]],
      rules: { autoAccept: r.autoAccept, sendWhen: SEND_WHEN[r.sendWhen] ?? 'now', onDispute: ON_DISPUTE[r.onDispute] ?? 'ask' },
      payout: { bank: '토스뱅크', accountNo: `10000000000${i + 1}`, holder: m.name },
      onboardedAt: new Date().toISOString(),
    });
  }

  await store.appendEvent(id, { from: 'system', to: 'all', kind: 'room_created', text: `개발용 데모 방을 만들었어요. 지출 ${DEMO_EXPENSES.length}건이 들어 있어요.` });
  return room;
}
