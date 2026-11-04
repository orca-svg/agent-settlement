// #4 방 만들기: POST /api/rooms
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

const create = (body, uid = 'me') =>
  fetch(`${base}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(uid ? { 'x-demo-user': uid } : {}) },
    body: JSON.stringify(body),
  });
const get = (path, uid) => fetch(base + path, { headers: { 'x-demo-user': uid } });

test('방을 만들면 만든 사람만 멤버이고, 고른 정책에 동의한 상태로 준비 중이다', async () => {
  const res = await create({ name: '  오사카   여행 ', dates: '11월 7일 – 9일', policy: 'payday' });
  assert.equal(res.status, 201);
  const { room } = await res.json();
  assert.equal(room.name, '오사카 여행'); // 공백 정리
  assert.equal(room.dates, '11월 7일 – 9일');
  assert.deepEqual(room.members.map((m) => m.uid), ['me']);
  assert.match(room.members[0].color, /^#[0-9a-f]{6}$/i, '멤버에는 프로필 색이 들어간다');
  assert.equal(room.policy, 'payday');
  assert.deepEqual(room.policyAgreedBy, ['me']);
  assert.equal(room.status, 'ready');
  assert.equal(room.createdBy, 'me');
  assert.deepEqual(await store.get('rooms', room.id), room); // 저장소에 그대로 들어갔다
});

test('정책을 안 고르면 실제 낸 원화(actual)', async () => {
  const { room } = await (await create({ name: '회식' })).json();
  assert.equal(room.policy, 'actual');
});

test('만든 방은 만든 사람이 열 수 있고, 다른 사람은 403', async () => {
  const { room } = await (await create({ name: '제주' })).json();
  const mine = await get(`/api/rooms/${room.id}`, 'me');
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).room.name, '제주');
  assert.equal((await get(`/api/rooms/${room.id}`, 'stranger')).status, 403);
});

test('방을 만들면 비서 기록에 room_created가 남는다', async () => {
  const { room } = await (await create({ name: '부산' })).json();
  const { events } = await (await get(`/api/rooms/${room.id}/events`, 'me')).json();
  assert.deepEqual(events.map((e) => e.kind), ['room_created']);
});

test('누구인지 모르면 401', async () => {
  assert.equal((await create({ name: '익명 방' }, null)).status, 401);
});

test('이름이 비었거나 40자를 넘거나, 없는 정책이면 400', async () => {
  assert.equal((await create({ name: '   ' })).status, 400);
  assert.equal((await create({})).status, 400);
  assert.equal((await create({ name: '가'.repeat(41) })).status, 400);
  assert.equal((await create({ name: '방', policy: 'cheapest' })).status, 400);
});
