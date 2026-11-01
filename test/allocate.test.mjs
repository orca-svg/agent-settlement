// 실제 지출의 메뉴 배분: 비서들이 공유한 기억으로 나누고, 근거 없는 줄은 사람에게 묻는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

const store = new MemoryStore();
let server;
let url;
before(async () => {
  server = createApp({ store, gemini: null, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = (path, uid, body) => fetch(url + path, {
  method: body ? 'POST' : 'GET',
  headers: { 'content-type': 'application/json', 'x-demo-user': uid },
  body: body ? JSON.stringify(body) : undefined,
});
const seed = async () => (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;

test('Gemini 없음 → source 규칙, 배분이 지출에 저장되고 version이 오른다', async () => {
  const roomId = await seed();
  const eid = `${roomId}-izakaya`;
  const res = await call(`/api/rooms/${roomId}/expenses/${eid}/allocate`, 'me', {});
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.source, 'rules');
  assert.deepEqual(out.expense.alloc.oolong.consumers, ['yh']);
  assert.deepEqual(out.expense.alloc.sashimi.consumers, ['me', 'cs', 'yh']);
  assert.equal((await store.get('rooms', roomId)).version, 2);
});

test('배분 후 확인 필요 줄마다 confirm_line 액션 이벤트', async () => {
  const roomId = await seed();
  const eid = `${roomId}-izakaya`;
  await call(`/api/rooms/${roomId}/expenses/${eid}/allocate`, 'me', {});
  const asks = (await store.listEvents(roomId)).filter((e) => e.action?.type === 'confirm_line');
  assert.deepEqual(asks.map((e) => e.action), [{ type: 'confirm_line', ref: `${eid}:ochazuke`, for: 'cs' }]);
  const forCs = (await (await call(`/api/rooms/${roomId}`, 'cs')).json()).actions;
  assert.deepEqual(forCs.map((a) => a.ref), [`${eid}:ochazuke`]);
  assert.deepEqual((await (await call(`/api/rooms/${roomId}`, 'me')).json()).actions, []);
});

test('consumers가 비면 400', async () => {
  const roomId = await seed();
  const eid = `${roomId}-izakaya`;
  await call(`/api/rooms/${roomId}/expenses/${eid}/allocate`, 'me', {});
  const res = await call(`/api/rooms/${roomId}/expenses/${eid}/lines/ochazuke`, 'cs', { consumers: [], confirm: true });
  assert.equal(res.status, 400);
  const outsider = await call(`/api/rooms/${roomId}/expenses/${eid}/lines/ochazuke`, 'cs', { consumers: ['nobody'], confirm: true });
  assert.equal(outsider.status, 400);
});

test('확정하면 그 줄의 confidence와 관계없이 flagged 아님', async () => {
  const roomId = await seed();
  const eid = `${roomId}-izakaya`;
  await call(`/api/rooms/${roomId}/expenses/${eid}/allocate`, 'me', {});
  const res = await call(`/api/rooms/${roomId}/expenses/${eid}/lines/ochazuke`, 'cs', { consumers: ['yh'], confirm: true });
  assert.equal(res.status, 200);
  const { expense } = await res.json();
  assert.deepEqual(expense.alloc.ochazuke.consumers, ['yh']);
  assert.equal(expense.alloc.ochazuke.confirmed, true);
  assert.equal(expense.alloc.ochazuke.reason, '직접 고쳤어요');
  assert.deepEqual((await (await call(`/api/rooms/${roomId}`, 'cs')).json()).actions, []);
  const last = (await store.listEvents(roomId)).at(-1);
  assert.equal(last.kind, 'line_confirmed');
  assert.equal(last.text, '‘오차즈케’는 영희가 먹은 걸로 확인했어요');
});

test('영수증 줄이 없는 지출은 나눌 수 없어 400', async () => {
  const roomId = await seed();
  const res = await call(`/api/rooms/${roomId}/expenses/${roomId}-hotel/allocate`, 'me', {});
  assert.equal(res.status, 400);
});
