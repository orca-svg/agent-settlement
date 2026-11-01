// 영수증 사진 읽기: Gemini가 읽은 내용을 서버가 검증해 초안으로 돌려준다. 저장은 사람이 확인한 뒤에.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { extractReceipt } from '../src/expenses/receipt.mjs';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { DEMO_ROOM } from '../public/data.js';

const image = { mimeType: 'image/jpeg', data: 'AAAA' };
const fake = (reply) => ({ model: 'fake', generate: async () => reply });
const ok = {
  merchant: '이자카야 하나', currency: 'JPY', date: '2026-11-07', time: '20:45', total: 7860,
  items: [
    { name: '생맥주', qty: 3, unit: 600, time: '', tags: ['술'] },
    { name: '가라아게', qty: 1, unit: 780, time: '', tags: ['나눠 먹는 안주', '튀김'] },
    { name: '닭꼬치', qty: 1, unit: 5280, time: '', tags: ['나눠 먹는 안주'] },
  ],
};

test('줄이 없으면 ok=false', async () => {
  const d = await extractReceipt(fake({ ...ok, items: [] }), { image, room: DEMO_ROOM });
  assert.equal(d.ok, false);
  assert.equal(d.reason, '영수증을 읽지 못했어요');
});

test('차액이 있으면 adjustment 줄을 붙인다(합계 7860, 줄 합 7500 → unit 360)', async () => {
  const d = await extractReceipt(fake({ ...ok, items: [ok.items[0], ok.items[1], { ...ok.items[2], unit: 4920 }] }), { image, room: DEMO_ROOM });
  assert.equal(d.ok, true);
  const adj = d.items.at(-1);
  assert.deepEqual([adj.id, adj.name, adj.qty, adj.unit, adj.tags], ['adj', '차액 조정', 1, 360, ['기타']]);
  assert.ok(d.warnings.some((w) => w.includes('차액 조정')));
});

test("모르는 태그는 '기타'로", async () => {
  const d = await extractReceipt(fake(ok), { image, room: DEMO_ROOM });
  assert.deepEqual(d.items[1].tags, ['나눠 먹는 안주', '기타']);
  assert.equal(d.items.length, 3);
  assert.equal(d.warnings.length, 0);
  assert.equal(d.source, 'fake');
});

test('gemini가 null이면 ok=false', async () => {
  const d = await extractReceipt(null, { image, room: DEMO_ROOM });
  assert.equal(d.ok, false);
  assert.equal(d.reason, '사진 읽기는 AI 서버가 필요해요');
});

test('방에서 쓰지 않는 통화의 영수증이면 ok=false', async () => {
  const d = await extractReceipt(fake({ ...ok, currency: 'USD' }), { image, room: DEMO_ROOM });
  assert.equal(d.ok, false);
  assert.match(d.reason, /USD/);
});

const store = new MemoryStore();
let server;
let url;
before(async () => {
  server = createApp({ store, gemini: fake(ok), env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});
after(() => server.close());

test('extract 엔드포인트는 저장하지 않는다(list expenses 그대로)', async () => {
  const { roomId } = await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json();
  const before = (await store.list('expenses', { roomId })).length;
  const res = await fetch(`${url}/api/rooms/${roomId}/receipts/extract`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': 'me' }, body: JSON.stringify({ image }),
  });
  assert.equal(res.status, 200);
  const { draft } = await res.json();
  assert.equal(draft.ok, true);
  assert.equal(draft.merchant, '이자카야 하나');
  assert.equal((await store.list('expenses', { roomId })).length, before);
  const bad = await fetch(`${url}/api/rooms/${roomId}/receipts/extract`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': 'me' }, body: JSON.stringify({ image: { mimeType: 'text/html', data: 'x' } }),
  });
  assert.equal(bad.status, 400);
});
