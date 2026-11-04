// 비서들이 공유한 기억(#5의 agents 문서). 메뉴 배분과 중재의 입력이다.
import { createHash } from 'node:crypto';

// 이 방에 공유한 기억. 기본은 모두 공유이고, 주인이 이 방에서 끈 기억(memoryHidden)만 뺀다(팀원 원본 #48의 설계).
// 모델에게 가는 기억은 모두 여기를 거친다. 끈 기억은 배분에도 중재에도 쓰이지 않는다.
// 공유는 정산에 쓴다는 뜻이고 방 사람에게 보인다는 뜻은 아니다: 배분 이유에는 기억 내용을 싣지 않는다(allocate.mjs의 publicReason)
export function sharedMemory(agent, roomId) {
  const hidden = new Set(agent?.memoryHidden?.[roomId] ?? []);
  return (agent?.memory ?? []).filter((m) => !hidden.has(m));
}

// 방 멤버의 비서 문서 { uid: AgentSettings | null }. 방 응답처럼 기억과 설정 여부를 함께 볼 때 한 번만 읽는다
export const agentsOf = async (store, room) => Object.fromEntries(await Promise.all(room.members.map(async (m) => [m.uid, await store.get('agents', m.uid)])));
// 방에서 나간 사람(#55)의 기억은 더 이상 이 방의 배분·중재에 쓰지 않는다
export const memoryOf = (room, agents) => Object.fromEntries(room.members.map((m) => [m.uid, m.left ? [] : sharedMemory(agents[m.uid], room.id)]));

// 방 멤버별 기억 { uid: string[] }
export async function roomMemory(store, room) {
  return memoryOf(room, await agentsOf(store, room));
}

// 배분에 쓴 기억의 지문. 지출에 남겨 두고, 같으면 다시 나눠도 같은 답이라 다시 나누지 않는다.
// 영수증 줄·함께 있던 사람이 바뀌면 지출 고치기에서 배분이 이미 지워지므로, 여기서는 기억만 본다.
export const memoryKey = (memory) =>
  createHash('sha256').update(JSON.stringify(Object.entries(memory).sort(([a], [b]) => a.localeCompare(b)))).digest('hex').slice(0, 16);
