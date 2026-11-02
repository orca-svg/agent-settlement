// 비서들이 공유한 기억(#5의 agents 문서). 메뉴 배분의 입력이다.
import { createHash } from 'node:crypto';

// 방 멤버별 기억 { uid: string[] }
export async function roomMemory(store, room) {
  return Object.fromEntries(await Promise.all(room.members.map(async (m) => [m.uid, (await store.get('agents', m.uid))?.memory ?? []])));
}

// 배분에 쓴 기억의 지문. 지출에 남겨 두고, 같으면 다시 나눠도 같은 답이라 다시 나누지 않는다.
// 영수증 줄·함께 있던 사람이 바뀌면 지출 고치기에서 배분이 이미 지워지므로, 여기서는 기억만 본다.
export const memoryKey = (memory) =>
  createHash('sha256').update(JSON.stringify(Object.entries(memory).sort(([a], [b]) => a.localeCompare(b)))).digest('hex').slice(0, 16);
