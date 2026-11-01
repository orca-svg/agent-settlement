// 실제 방 API 뼈대: 개발용 시드, 방 조회(멤버만), 비서 기록 조회.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

const store = new MemoryStore();
let server;
let base;
before(async () => {
  server = createApp({ store, gemini: null, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const get = (path, uid) => fetch(base + path, { headers: uid ? { 'x-demo-user': uid } : {} });
const seed = async () => (await (await fetch(base + '/api/dev/seed', { method: 'POST' })).json()).roomId;

test('dev seed 없이 404', async () => {
  const s = createApp({ store: new MemoryStore(), gemini: null, env: {} });
  await new Promise((r) => s.listen(0, r));
  const res = await fetch(`http://localhost:${s.address().port}/api/dev/seed`, { method: 'POST' });
  assert.equal(res.status, 404);
  s.close();
});

test('시드 방은 ASCII uid 4명, 지출 7건, 비서 설정과 함께 만들어진다', async () => {
  const roomId = await seed();
  const res = await get(`/api/rooms/${roomId}`, 'me');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.room.members.map((m) => m.uid), ['me', 'cs', 'yh', 'ms']);
  assert.deepEqual(data.room.members.map((m) => m.name), ['나', '철수', '영희', '민수']);
  assert.equal(data.expenses.length, 7);
  assert.ok(data.expenses.every((e) => e.roomId === roomId && ['me', 'cs', 'yh', 'ms'].includes(e.payer)));
  assert.deepEqual(data.me, { uid: 'me', name: '나' });
  assert.ok(data.ledger.me.net > 0 && data.ledger.ms.net < 0);
  const agent = await store.get('agents', 'cs');
  assert.deepEqual(agent.rules.sendWhen, { payday: 25 });
  assert.equal((await store.get('agents', 'ms')).rules.onDispute, 'evidence');
  assert.ok((await store.get('agents', 'me')).payout.accountNo);
});

test('멤버 아닌 신원은 GET room 403, 헤더 없으면 401, 없는 방 404', async () => {
  const roomId = await seed();
  assert.equal((await get(`/api/rooms/${roomId}`, 'stranger')).status, 403);
  assert.equal((await get(`/api/rooms/${roomId}`)).status, 401);
  assert.equal((await get('/api/rooms/nope', 'me')).status, 404);
});

test('당사자가 아니면 transfers[].fallback은 null', async () => {
  const roomId = await seed();
  await store.put('transfers', {
    id: 't1', roomId, version: 1, from: 'ms', to: 'me', amount: 1000, status: 'due', remindAt: null,
    link: 'supertoss://send', fallback: { bank: '토스뱅크', accountNo: '100000000001', amount: 1000 },
  });
  const asParty = await (await get(`/api/rooms/${roomId}`, 'ms')).json();
  const asOther = await (await get(`/api/rooms/${roomId}`, 'yh')).json();
  assert.equal(asParty.transfers[0].fallback.accountNo, '100000000001');
  assert.equal(asOther.transfers[0].fallback, null);
  assert.equal(asOther.transfers[0].link, null);
});

test('events after=2는 3번부터', async () => {
  const roomId = await seed();
  for (const text of ['b', 'c', 'd']) await store.appendEvent(roomId, { from: 'system', to: 'all', kind: 'x', text });
  const { events } = await (await get(`/api/rooms/${roomId}/events?after=2`, 'yh')).json();
  assert.deepEqual(events.map((e) => e.seq), [3, 4]);
  assert.equal((await get(`/api/rooms/${roomId}/events`, 'stranger')).status, 403);
});
