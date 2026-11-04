// 지출 직접 입력: 서버가 검증하고 저장하면 방 version이 오르고 비서 기록이 남는다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { validateExpense } from '../src/expenses/validate.mjs';
import { DEMO_ROOM } from '../public/data.js';
import { toKrw } from '../public/core.js';

const room = { ...DEMO_ROOM, members: [{ uid: 'me', name: '나' }, { uid: 'cs', name: '철수' }], fx: { ...DEMO_ROOM.fx, cash: { cs: 927.6 } } };
const base = { title: '편의점', amount: 12000, currency: 'KRW', payer: 'me', method: 'card', present: ['me', 'cs'], date: '2026-11-01', time: '12:30' };

test('validateExpense: 음수 금액 → errors에 금액', () => {
  const r = validateExpense({ ...base, amount: -1 }, room);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('금액')));
});

test('validateExpense: 정상 입력은 정리된 지출을 돌려준다', () => {
  const r = validateExpense({ ...base, present: ['cs', 'me', 'cs'], title: '  편의점  ' }, room);
  assert.equal(r.ok, true);
  assert.deepEqual(r.expense.present, ['me', 'cs']);
  assert.equal(r.expense.title, '편의점');
  assert.equal(r.expense.split, 'equal');
});

test('validateExpense: 외화 현금은 환전 환율이 없어도 받고, 그때는 결제일 기준율로 셈한다(#55)', () => {
  const r = validateExpense({ ...base, currency: 'JPY', amount: 1000, method: 'cash', date: '2026-11-07' }, room);
  assert.equal(r.ok, true);
  const { krw, how } = toKrw(r.expense, room, 'actual');
  assert.equal(krw, Math.round((1000 * room.fx.base['2026-11-07']) / 100));
  assert.match(how, /결제일.*환전 환율이 없어서/);
  const cs = validateExpense({ ...base, currency: 'JPY', amount: 1000, method: 'cash', payer: 'cs', date: '2026-11-07' }, room);
  assert.equal(toKrw(cs.expense, room, 'actual').krw, Math.round((1000 * 927.6) / 100), '환전 환율이 있으면 그 환율');
});

test('validateExpense: 달러·유로 방은 0.01 단위까지, 엔·원은 정수만 받는다(#55)', () => {
  const usd = { ...room, fx: { currency: 'USD', base: { '2026-11-07': 134459 }, settle: null, cardFee: 0.014, cash: {} } };
  const at = { ...base, currency: 'USD', date: '2026-11-07' };
  assert.equal(validateExpense({ ...at, amount: 12.5 }, usd).ok, true);
  assert.equal(validateExpense({ ...at, amount: 0.01 }, usd).ok, true);
  assert.equal(validateExpense({ ...at, amount: 12.345 }, usd).ok, false);
  assert.equal(validateExpense({ ...at, amount: undefined, items: [{ id: 'a', name: '버거', qty: 2, unit: 7.99, tags: [] }] }, usd).ok, true);
  assert.equal(validateExpense({ ...base, amount: 12.5 }, usd).ok, false, '같은 방의 원화 지출은 정수');
  assert.equal(validateExpense({ ...base, currency: 'JPY', amount: 980.5, date: '2026-11-07' }, room).ok, false, '엔은 정수');
});

test('validateExpense: 줄이 있으면 split은 items, 줄 합이 1 이상이어야 한다', () => {
  const items = [{ id: 'a', name: '라멘', qty: 2, unit: 900, tags: ['1인 식사'] }, { id: 'adj', name: '차액 조정', qty: 1, unit: -300, tags: ['모르는 태그'] }];
  const r = validateExpense({ ...base, amount: undefined, currency: 'JPY', date: '2026-11-07', items }, room);
  assert.equal(r.ok, true);
  assert.equal(r.expense.split, 'items');
  assert.deepEqual(r.expense.items[1].tags, ['기타']);
  const bad = validateExpense({ ...base, amount: undefined, items: [{ id: 'a', name: '할인', qty: 1, unit: -100, tags: [] }] }, room);
  assert.ok(bad.errors.some((e) => e.includes('금액')));
});

const store = new MemoryStore();
let server;
let url;
before(async () => {
  // 환율은 바깥(Frankfurter)에 묻지 않고 정해 둔 값으로 답한다. 12/31은 받지 못하는 날
  const fxRates = { rateOn: async (currency, date) => { if (date === '2026-12-31') throw new Error('down'); return 850.25; } };
  server = createApp({ store, gemini: null, env: { DEV_SEED: '1' }, fxRates });
  await new Promise((r) => server.listen(0, r));
  url = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const seed = async () => (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;
const postExpense = (roomId, expense, uid = 'me') =>
  fetch(`${url}/api/rooms/${roomId}/expenses`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify({ expense }) });

test('멤버 아닌 payer → 400', async () => {
  const roomId = await seed();
  const res = await postExpense(roomId, { ...base, payer: 'stranger', present: ['me'] });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /낸 사람/);
});

test('환율 표에 없는 날짜의 외화는 그날 환율을 받아 방 표에 넣고 남긴다(#55)', async () => {
  const roomId = await seed();
  const res = await postExpense(roomId, { ...base, currency: 'JPY', amount: 1000, date: '2026-12-25', present: ['me', 'cs'] });
  assert.equal(res.status, 201);
  const room = await store.get('rooms', roomId);
  assert.equal(room.fx.base['2026-12-25'], 850.25);
  assert.equal(room.fx.base['2026-11-07'], 912.4, '이미 있던 날짜는 그대로');
});

test('환율을 받지 못하면 503이고 지출도 방도 그대로다', async () => {
  const roomId = await seed();
  const before = await store.get('rooms', roomId);
  const res = await postExpense(roomId, { ...base, currency: 'JPY', amount: 1000, date: '2026-12-31', present: ['me', 'cs'] });
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /환율/);
  assert.deepEqual(await store.get('rooms', roomId), before);
});

test('정상 → 201이고 room.version 1 증가, 이벤트 1개', async () => {
  const roomId = await seed();
  const before = await store.get('rooms', roomId);
  const eventsBefore = (await store.listEvents(roomId)).length;
  const res = await postExpense(roomId, { ...base, present: ['me', 'cs', 'yh'] }, 'cs');
  assert.equal(res.status, 201);
  const { expense } = await res.json();
  assert.equal(expense.roomId, roomId);
  assert.equal(expense.createdBy, 'cs');
  assert.equal(expense.source, 'manual');
  assert.equal((await store.get('rooms', roomId)).version, before.version + 1);
  const events = await store.listEvents(roomId, eventsBefore);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'expense_added');
  assert.equal(events[0].text, '철수가 편의점 ₩12,000을 남겼어요');
  assert.equal((await store.list('expenses', { roomId })).length, 8);
});
