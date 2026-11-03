// 비서들이 방마다 정산에 쓰기로 고른 기억(#5의 agents 문서). 메뉴 배분과 중재의 입력이다.
import { createHash } from 'node:crypto';

// 이 방 정산에 쓰기로 고른 기억(memoryShared). 기본은 어느 방에도 쓰지 않고, 주인이 방마다 고른 것만 쓴다.
// 모델에게 가는 기억은 모두 여기를 거친다. 정산에 쓰는 것과 방 사람에게 보이는 것은 다르다: 배분 이유에는 기억 내용을 싣지 않는다(allocate.mjs의 publicReason)
export function sharedMemory(agent, roomId) {
  const chosen = new Set(agent?.memoryShared?.[roomId] ?? []);
  return (agent?.memory ?? []).filter((m) => chosen.has(m));
}

// 방 멤버별 기억 { uid: string[] }
export async function roomMemory(store, room) {
  return Object.fromEntries(await Promise.all(room.members.map(async (m) => [m.uid, sharedMemory(await store.get('agents', m.uid), room.id)])));
}

// 배분에 쓴 기억의 지문. 지출에 남겨 두고, 같으면 다시 나눠도 같은 답이라 다시 나누지 않는다.
// 영수증 줄·함께 있던 사람이 바뀌면 지출 고치기에서 배분이 이미 지워지므로, 여기서는 기억만 본다.
export const memoryKey = (memory) =>
  createHash('sha256').update(JSON.stringify(Object.entries(memory).sort(([a], [b]) => a.localeCompare(b)))).digest('hex').slice(0, 16);
