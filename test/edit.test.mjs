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
  const items = allocated.items.map((it) => (it.id === 'beer' ? { ...it, qty: 2 } : it));
  const changed = await (await call(`/api/rooms/${roomId}/expenses/${eid}`, 'me', { expense: { ...allocated, items } })).json();
  assert.equal(changed.expense.alloc, undefined);
});

// ---------------------------------------------------------------- 지출이 바뀌면 그 지출의 열린 이의는 닫는다(청구서가 version마다 대체되는 것과 같다)
// 시드의 '2차 바'는 민수의 비서가 이의를 내 중재안(proposed)까지 나온 상태가 된다
const withBarDispute = async () => {
  const roomId = await seed();
  await call(`/api/rooms/${roomId}/invoices/send`, 'me', {});
  const [dispute] = await store.list('disputes', { roomId });
  return { roomId, eid: `${roomId}-bar`, dispute };
};
const room = async (roomId, uid = 'me') => (await fetch(`${url}/api/rooms/${roomId}`, { headers: { 'x-demo-user': uid } })).json();

test('배분에 닿는 값(줄)을 고치면 그 지출의 이의가 닫히고, 기록이 남고, 할 일에서 빠진다', async () => {
  const { roomId, eid, dispute } = await withBarDispute();
  assert.equal(dispute.status, 'proposed');
  const bar = await store.get('expenses', eid);
  const items = bar.items.map((it) => (it.id === 'b-whisky' ? { ...it, qty: 3 } : it));
  assert.equal((await call(`/api/rooms/${roomId}/expenses/${eid}`, 'me', { expense: { ...bar, items } })).status, 200);
  assert.equal((await store.get('disputes', dispute.id)).status, 'superseded');
  const ev = (await store.listEvents(roomId)).filter((e) => e.kind === 'dispute_superseded');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].text, '지출이 바뀌어 ‘2차 바’ 이의를 닫았어요');
  assert.ok(!(await room(roomId)).actions.some((a) => a.type === 'agree_dispute'));
  // 다시 보내도 같은 근거로 이의를 되살리지 않는다(사람이 지출을 직접 고쳤으니 매듭지은 것으로 본다)
  await call(`/api/rooms/${roomId}/invoices/send`, 'me', {});
  assert.equal((await store.list('disputes', { roomId })).length, 1);
});

test('제목만 고치면 배분은 그대로라 이의도 그대로', async () => {
  const { roomId, eid, dispute } = await withBarDispute();
  const bar = await store.get('expenses', eid);
  await call(`/api/rooms/${roomId}/expenses/${eid}`, 'me', { expense: { ...bar, title: '2차 바(수정)' } });
  assert.equal((await store.get('disputes', dispute.id)).status, 'proposed');
  assert.equal((await store.listEvents(roomId)).filter((e) => e.kind === 'dispute_superseded').length, 0);
});

test('지출을 지우면 이의도 닫히고, 닫힌 이의에 동의해도 500이 아니라 409', async () => {
  const { roomId, eid, dispute } = await withBarDispute();
  assert.equal((await call(`/api/rooms/${roomId}/expenses/${eid}/delete`, 'me', {})).status, 200);
  assert.equal((await store.get('disputes', dispute.id)).status, 'superseded');
  const [ev] = (await store.listEvents(roomId)).filter((e) => e.kind === 'dispute_superseded');
  assert.equal(ev.text, '지출이 지워져 ‘2차 바’ 이의를 닫았어요');
  const path = `/api/rooms/${roomId}/disputes/${encodeURIComponent(dispute.id)}`;
  assert.equal((await call(`${path}/agree`, 'me', {})).status, 409);
  assert.equal((await call(`${path}/reject`, 'me', {})).status, 409);
});

test('메뉴 배분을 다시 하거나 줄을 확정해 배분이 바뀌면 이의가 닫힌다', async () => {
  const a = await withBarDispute();
  await call(`/api/rooms/${a.roomId}/expenses/${a.eid}/allocate`, 'me', {});
  assert.equal((await store.get('disputes', a.dispute.id)).status, 'superseded');
  const b = await withBarDispute();
  await call(`/api/rooms/${b.roomId}/expenses/${b.eid}/lines/b-whisky`, 'me', { consumers: ['me'] });
  assert.equal((await store.get('disputes', b.dispute.id)).status, 'superseded');
});

test('다른 지출을 고쳐도 이 지출의 이의는 그대로', async () => {
  const { roomId, dispute } = await withBarDispute();
  const hotel = await store.get('expenses', `${roomId}-hotel`);
  await call(`/api/rooms/${roomId}/expenses/${hotel.id}`, 'me', { expense: { ...hotel, amount: 60000 } });
  assert.equal((await store.get('disputes', dispute.id)).status, 'proposed');
});
