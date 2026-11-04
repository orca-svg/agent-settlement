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

test('줄도 합계도 없으면 ok=false', async () => {
  const d = await extractReceipt(fake({ ...ok, items: [], total: 0 }), { image, room: DEMO_ROOM });
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

test('합계만 읽히고 줄이 없으면 합계 한 줄로 초안을 만들고 확인을 요청한다', async () => {
  const d = await extractReceipt(fake({ ...ok, merchant: '편의점', total: 1500, items: [] }), { image, room: DEMO_ROOM });
  assert.equal(d.ok, true);
  assert.deepEqual(d.items.map((i) => [i.name, i.qty, i.unit]), [['편의점', 1, 1500]]);
  assert.ok(d.warnings.some((w) => w.includes('메뉴 줄을 읽지 못해')));
});

test('영수증에 합계가 없으면 줄의 합을 합계로 쓰고 경고한다', async () => {
  const d = await extractReceipt(fake({ ...ok, total: 0 }), { image, room: DEMO_ROOM });
  assert.equal(d.ok, true);
  assert.equal(d.total, 7860);
  assert.ok(d.warnings.some((w) => w.includes('합계가 적혀 있지 않아')));
});

test('모델이 알린 애매한 점(notes)은 경고로 보여 준다', async () => {
  const d = await extractReceipt(fake({ ...ok, notes: ['맨 아래 줄은 줄로 지워져 있어요', '  '] }), { image, room: DEMO_ROOM });
  assert.deepEqual(d.warnings, ['맨 아래 줄은 줄로 지워져 있어요']);
});

test('처음에 못 읽으면 한 번 더 읽는다', async () => {
  let calls = 0;
  const flaky = { model: 'fake', generate: async () => (++calls === 1 ? { ...ok, items: [], total: 0 } : ok) };
  const d = await extractReceipt(flaky, { image, room: DEMO_ROOM });
  assert.equal(calls, 2);
  assert.equal(d.ok, true);
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

test('달러 방(#55): 센트까지 읽고, 엔·원은 정수로 맞춘다', async () => {
  const usdRoom = { ...DEMO_ROOM, fx: { currency: 'USD', base: {}, settle: null, cardFee: 0.014, cash: {} } };
  const usd = await extractReceipt(fake({ merchant: 'Diner', currency: 'USD', date: '2026-11-07', time: '12:10', total: 24.37,
    items: [{ name: 'Burger', qty: 2, unit: 9.99, tags: ['1인 식사'] }, { name: 'Soda', qty: 1, unit: 2.5, tags: ['무알코올 음료'] }] }), { image, room: usdRoom });
  assert.equal(usd.total, 24.37);
  assert.deepEqual(usd.items.map((it) => it.unit), [9.99, 2.5, 1.89], '차액 조정도 센트 단위(부동소수 찌꺼기 없이)');
  const jpy = await extractReceipt(fake({ ...ok, total: 7860.4, items: ok.items.map((it) => ({ ...it, unit: it.unit + 0.4 })) }), { image, room: DEMO_ROOM });
  assert.equal(jpy.total, 7860);
  assert.ok(jpy.items.every((it) => Number.isInteger(it.unit)));
});

test('손글씨 전표의 正자 획 수량(一·丅·下·正)을 숫자로 세라고 모델에 알린다', async () => {
  let system = '';
  await extractReceipt({ model: 'fake', generate: async (p) => { system = p.system; return ok; } }, { image, room: DEMO_ROOM });
  assert.match(system, /正자 획으로 적혀 있으면 획 수를 qty로/);
  assert.match(system, /一=1, 丅\(T 모양\)=2, 下=3/);
  assert.match(system, /취소선으로 지운 줄도 넣지 않는다/);
});
