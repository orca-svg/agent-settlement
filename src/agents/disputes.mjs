// 이의의 열린 상태와, 지출이 바뀔 때 이의를 닫는 규칙. 지출 API와 비서(orchestrator)가 함께 쓴다.
// 이의는 지출 하나의 배분에 대한 것이라, 그 배분이 바뀌면 중재안도 근거도 낡는다. 청구서가 version마다 대체되는 것과 같다.

export const OPEN = ['open', 'proposed'];

// 몫이 정해지는 방식만 담은 열쇠(core.js의 shares()와 같은 규칙). 제목·종류·결제 시각·줄 이름·배분의 확인 표시는 몫을 바꾸지 않아서 뺀다.
// split 값 자체는 보지 않는다: 줄이 있는 지출은 수정 API가 'equal'을 'items'로 바꿔 저장하지만, 배분이 없으면 줄마다 함께 있던 사람 모두로 나눠 몫이 같다
const consumersOf = (e, item) => [...(e.split === 'items' && e.alloc?.[item.id]?.consumers?.length ? e.alloc[item.id].consumers : e.present ?? [])].sort();
const splitKey = (e) => JSON.stringify({
  payer: e.payer, method: e.method, currency: e.currency, date: e.date,
  amount: e.items?.length ? null : e.amount, // 줄이 있으면 금액은 줄 합이다
  present: [...(e.present ?? [])].sort(),
  lines: (e.items ?? []).map((it) => [it.id, it.qty, it.unit, it.time ?? null, it.tags ?? [], consumersOf(e, it)]),
});

/** after가 없으면 지운 지출이다 */
export const splitChanged = (before, after) => !after || splitKey(before) !== splitKey(after);

/**
 * 지출의 배분이 바뀌면 그 지출의 열린 이의를 'superseded'로 닫는다. 지출을 지웠으면(after 없음) 항상 닫는다.
 * 닫힌 이의는 청구서를 다시 보낼 때 비서가 같은 근거로 되살리지 않는다. 사람이 지출을 직접 고쳤으니 매듭지은 것으로 본다.
 * 닫은 이의를 돌려주고, 닫을 게 없으면 기록도 남기지 않는다(두 번 불러도 안전).
 */
export async function supersedeDisputes(store, roomId, before, after = null) {
  if (!splitChanged(before, after)) return [];
  const live = (await store.list('disputes', { roomId })).filter((d) => d.expenseId === before.id && OPEN.includes(d.status));
  if (!live.length) return [];
  for (const d of live) await store.put('disputes', { ...d, status: 'superseded' });
  await store.appendEvent(roomId, { from: 'system', to: 'all', kind: 'dispute_superseded', text: `${after ? '지출이 바뀌어' : '지출이 지워져'} ‘${before.title}’ 이의를 닫았어요` });
  return live;
}
