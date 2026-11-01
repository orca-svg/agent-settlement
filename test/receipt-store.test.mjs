// 지출 지우기와 영수증 사진 저장·확인.
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
const call = (path, uid, body) => fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: body ? JSON.stringify(body) : undefined });
const seed = async () => (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;
const receipt = { mimeType: 'image/jpeg', data: 'A'.repeat(50_000) };
const exp = { title: '라멘', currency: 'KRW', payer: 'me', method: 'card', present: ['me', 'cs'], date: '2026-11-01', time: '12:00', items: [{ id: 'a', name: '라멘', qty: 2, unit: 9000, tags: [] }], source: 'receipt' };

test('영수증 사진과 함께 남기면 저장되고 멤버만 볼 수 있다', async () => {
  const roomId = await seed();
  const res = await call(`/api/rooms/${roomId}/expenses`, 'me', { expense: exp, receipt });
  assert.equal(res.status, 201);
  const { expense } = await res.json();
  assert.equal(expense.hasReceipt, true);
  const got = await (await call(`/api/rooms/${roomId}/expenses/${expense.id}/receipt`, 'cs')).json();
  assert.equal(got.mimeType, 'image/jpeg');
  assert.equal(got.data.length, 50_000);
  assert.equal((await call(`/api/rooms/${roomId}/expenses/${expense.id}/receipt`, 'stranger')).status, 403);
  assert.equal((await call(`/api/rooms/${roomId}/expenses/${roomId}-hotel/receipt`, 'me')).status, 404);
});

test('지출을 지우면 영수증도 지워지고 version이 오르며 기록이 남는다', async () => {
  const roomId = await seed();
  const { expense } = await (await call(`/api/rooms/${roomId}/expenses`, 'me', { expense: exp, receipt })).json();
  const v = (await store.get('rooms', roomId)).version;
  const res = await call(`/api/rooms/${roomId}/expenses/${expense.id}/delete`, 'cs', {});
  assert.equal(res.status, 200);
  assert.equal(await store.get('expenses', expense.id), null);
  assert.equal((await call(`/api/rooms/${roomId}/expenses/${expense.id}/receipt`, 'me')).status, 404);
  assert.equal((await store.get('rooms', roomId)).version, v + 1);
  const last = (await store.listEvents(roomId)).at(-1);
  assert.equal(last.kind, 'expense_deleted');
  assert.equal(last.text, '철수가 ‘라멘’을 지웠어요');
});
