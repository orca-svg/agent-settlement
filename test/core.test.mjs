// 정산 계산 코어: 방 데이터를 받아 환율·몫·차액·송금 경로를 계산한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ROOM, DEMO_EXPENSES, DEMO_MEMORY, DEMO_DISPUTE } from '../public/data.js';
import { toKrw, amountOf, shares, ledger, settle, ruleAllocate, presentAfter, money } from '../public/core.js';

const byId = (id) => DEMO_EXPENSES.find((e) => e.id === id);
const izakaya = byId('izakaya');
const bar = byId('bar');
const leftEarly = presentAfter(bar, DEMO_DISPUTE.by, DEMO_DISPUTE.leftAt);
const allocated = DEMO_EXPENSES.map((e) => {
  if (e.id === 'izakaya') return { ...e, alloc: ruleAllocate(e, DEMO_MEMORY, DEMO_ROOM.members) };
  if (e.id === 'bar') return { ...e, split: 'items', alloc: ruleAllocate(e, DEMO_MEMORY, DEMO_ROOM.members, leftEarly) };
  return e;
});

test('toKrw: KRW 지출은 환율 없이 그대로', () => {
  const r = toKrw({ currency: 'KRW', amount: 12000, method: 'card', date: '2026-11-07' }, DEMO_ROOM, 'actual');
  assert.equal(r.krw, 12000);
  assert.equal(r.how, '원화 결제');
});

test('toKrw: JPY 카드는 기준율×(1+수수료)', () => {
  assert.equal(toKrw(byId('hotel'), DEMO_ROOM, 'actual').krw, 592111);
});

test('amountOf: 줄이 있으면 줄 합, 없으면 amount', () => {
  assert.equal(amountOf(izakaya), 7860);
  assert.equal(amountOf(byId('hotel')), 64000);
});

test('shares: 세 정책 모두 몫의 합 = 원화 합계', () => {
  for (const policy of ['actual', 'payday', 'settle']) {
    for (const exp of [...DEMO_EXPENSES, ...allocated]) {
      const s = shares(exp, DEMO_ROOM, policy);
      const sum = Object.values(s.krwShare).reduce((a, b) => a + b, 0);
      assert.equal(sum, toKrw(exp, DEMO_ROOM, policy).krw, `${exp.id}/${policy}/${exp.split}`);
    }
  }
});

test('ledger+settle: 데모 방은 송금 3번, 송금 뒤 잔액 0', () => {
  const rows = ledger(DEMO_ROOM, allocated, 'actual');
  const uids = DEMO_ROOM.members.map((m) => m.uid);
  assert.equal(uids.reduce((s, u) => s + rows[u].net, 0), 0);
  const transfers = settle(rows);
  assert.deepEqual(transfers.map((t) => [t.from, t.to, t.amount]), [
    ['민수', '나', 245446],
    ['철수', '나', 98095],
    ['철수', '영희', 47995],
  ]);
  const left = Object.fromEntries(uids.map((u) => [u, rows[u].net]));
  for (const t of transfers) { left[t.from] += t.amount; left[t.to] -= t.amount; }
  assert.ok(uids.every((u) => left[u] === 0));
});

test('ruleAllocate: 오차즈케만 confidence < 0.7', () => {
  const a = ruleAllocate(izakaya, DEMO_MEMORY, DEMO_ROOM.members);
  const low = Object.entries(a).filter(([, v]) => v.confidence < 0.7).map(([k]) => k);
  assert.deepEqual(low, ['ochazuke']);
  assert.deepEqual(a.oolong.consumers, ['영희']);
  assert.deepEqual(a.highball.consumers, ['철수']);
});

test('presentAfter: 22:55 이후 줄에서 민수 제외', () => {
  const whisky = bar.items.find((it) => it.id === 'b-whisky');
  const nuts = bar.items.find((it) => it.id === 'b-nuts');
  assert.ok(!leftEarly(whisky).includes('민수'));
  assert.ok(leftEarly(nuts).includes('민수'));
});

test('shares: 나누고 남은 원은 rest로 알려 주고 낸 사람 몫에 더한다', () => {
  const room = { members: [{ uid: 'a', name: '가' }, { uid: 'b', name: '나' }, { uid: 'c', name: '다' }], fx: null };
  const exp = { currency: 'KRW', amount: 10000, method: 'card', payer: 'a', present: ['a', 'b', 'c'], split: 'equal' };
  const s = shares(exp, room, 'actual');
  assert.equal(s.rest, 1);
  assert.deepEqual(s.krwShare, { a: 3334, b: 3333, c: 3333 });
  assert.equal(shares({ ...exp, amount: 9000 }, room, 'actual').rest, 0);
});

// #55: 환율 정책은 외화 방에만 있다. 원화 방의 금액은 정책이 없어도(null), 예전 값이 남아 있어도 똑같이 나온다
test('원화 방: toKrw·shares·ledger는 환율 정책과 상관없이 같은 결과', () => {
  const krwRoom = { id: 'r-krw', members: [{ uid: 'a', name: '가' }, { uid: 'b', name: '나' }, { uid: 'c', name: '다' }], currency: 'KRW', fx: null };
  const exps = [
    { id: 'e1', payer: 'a', method: 'card', currency: 'KRW', date: '2026-11-03', amount: 30001, split: 'equal', present: ['a', 'b', 'c'] },
    { id: 'e2', payer: 'b', method: 'cash', currency: 'KRW', date: '2026-11-03', split: 'items', present: ['a', 'b'],
      items: [{ id: 'l1', qty: 2, unit: 4500, tags: [] }, { id: 'l2', qty: 1, unit: 12000, tags: [] }], alloc: { l2: { consumers: ['b'] } } },
  ];
  const results = [null, undefined, 'actual', 'payday', 'settle'].map((policy) => ({
    krw: exps.map((e) => toKrw(e, krwRoom, policy)),
    shares: exps.map((e) => shares(e, krwRoom, policy)),
    ledger: ledger(krwRoom, exps, policy),
  }));
  for (const r of results.slice(1)) assert.deepEqual(r, results[0]);
  assert.deepEqual(results[0].ledger, { a: { paid: 30001, owed: 14501, net: 15500 }, b: { paid: 21000, owed: 26500, net: -5500 }, c: { paid: 0, owed: 10000, net: -10000 } });
});

test('외화 방: 정산일 환율이 정해지기 전에는 결제일 기준율로 미리 셈하고 그렇다고 밝힌다(#55)', () => {
  const fxRoom = { members: [{ uid: 'a', name: '가' }], fx: { currency: 'JPY', base: { '2026-11-02': 905.5 }, settle: null, cardFee: 0.014, cash: {} } };
  const exp = { payer: 'a', method: 'card', currency: 'JPY', date: '2026-11-02', amount: 1000 };
  const before = toKrw(exp, fxRoom, 'settle');
  assert.equal(before.krw, 9055);
  assert.match(before.how, /정산일 환율은 청구서를 보낼 때/);
  assert.equal(toKrw(exp, { ...fxRoom, fx: { ...fxRoom.fx, settle: { date: '2026-11-03', rate: 900 } } }, 'settle').krw, 9000);
});

test('money: 달러·유로는 소수 둘째 자리까지, 원·엔은 정수로 보인다', () => {
  assert.equal(money(12.5, 'USD'), '12.5 USD');
  assert.equal(money(0.1 + 0.2, 'EUR'), '0.3 EUR');
  assert.equal(money(1234.4, 'JPY'), '¥1,234');
});
