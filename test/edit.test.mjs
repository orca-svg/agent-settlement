// 지출 고치기: 같은 검증을 거쳐 덮어쓰고, 줄이나 함께한 사람이 바뀌면 메뉴 배분은 다시 하게 한다.
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
const call = (path, uid, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body) });
const seed = async () => (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;

test('금액을 고치면 덮어쓰고 version이 오르며 기록이 남는다', async () => {
  const roomId = await seed();
  const eid = `${roomId}-hotel`;
  const before = await store.get('expenses', eid);
  const res = await call(`/api/rooms/${roomId}/expenses/${eid}`, 'cs', { expense: { ...before, amount: 60000, title: '난바 호텔 2박(할인)' } });
  assert.equal(res.status, 200);
  const { expense } = await res.json();
  assert.equal(expense.amount, 60000);
  assert.equal(expense.id, eid);
  assert.equal(expense.createdBy, before.createdBy);
  assert.equal((await store.get('rooms', roomId)).version, 2);
  const last = (await store.listEvents(roomId)).at(-1);
  assert.equal(last.kind, 'expense_edited');
  assert.equal(last.text, '철수가 ‘난바 호텔 2박(할인)’을 고쳤어요');
});

test('잘못된 값이면 400이고 저장본은 그대로', async () => {
  const roomId = await seed();
  const eid = `${roomId}-hotel`;
  const before = await store.get('expenses', eid);
  const res = await call(`/api/rooms/${roomId}/expenses/${eid}`, 'me', { expense: { ...before, amount: 0 } });
  assert.equal(res.status, 400);
  assert.equal((await store.get('expenses', eid)).amount, 64000);
});

test('줄이 바뀌면 메뉴 배분을 지우고, 그대로면 남긴다', async () => {
  const roomId = await seed();
  const eid = `${roomId}-izakaya`;
  await call(`/api/rooms/${roomId}/expenses/${eid}/allocate`, 'me', {});
  const allocated = await store.get('expenses', eid);
  const same = await (await call(`/api/rooms/${roomId}/expenses/${eid}`, 'me', { expense: { ...allocated, title: '이자카야' } })).json();
  assert.ok(same.expense.alloc);
  assert.ok(allocated.allocMemory);
  assert.equal(same.expense.allocMemory, allocated.allocMemory); // 배분을 남기면 그때 쓴 기억의 지문도 남겨, 다시 나누기가 막힌 채로 둔다
  const items = allocated.items.map((it) => (it.id === 'beer' ? { ...it, qty: 2 } : it));
  const changed = await (await call(`/api/rooms/${roomId}/expenses/${eid}`, 'me', { expense: { ...allocated, items } })).json();
  assert.equal(changed.expense.alloc, undefined);
});
