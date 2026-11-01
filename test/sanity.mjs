// 계산 sanity check: 몫의 합 = 원화 합계, 차액의 합 = 0, 송금 경로가 차액을 모두 갚는지.
import assert from 'node:assert/strict';
import { PEOPLE, EXPENSES, MEMORY, DISPUTE } from '../public/data.js';
import { toKrw, shares, ledger, settle, ruleAllocate, presentAfterLeaving, won } from '../public/core.js';

const izakaya = EXPENSES.find((e) => e.id === 'izakaya');
const bar = EXPENSES.find((e) => e.id === 'bar');
const allocs = { izakaya: ruleAllocate(izakaya, MEMORY), bar: ruleAllocate(bar, MEMORY, presentAfterLeaving(bar, DISPUTE)) };

for (const policy of ['actual', 'payday', 'settle']) {
  for (const exp of EXPENSES) {
    for (const mode of ['equal', 'items']) {
      if (mode === 'items' && !exp.items) continue;
      const s = shares(exp, policy, mode, allocs[exp.id]);
      const sum = Object.values(s.krwShare).reduce((a, b) => a + b, 0);
      assert.equal(sum, toKrw(exp, policy).krw, `${exp.id}/${policy}/${mode} 몫의 합`);
    }
  }
  const rows = ledger({ policy, modes: { bar: 'items' }, allocs });
  assert.equal(PEOPLE.reduce((s, p) => s + rows[p].net, 0), 0, `${policy} 차액의 합`);
  const left = Object.fromEntries(PEOPLE.map((p) => [p, rows[p].net]));
  const transfers = settle(rows);
  for (const t of transfers) { left[t.from] += t.amount; left[t.to] -= t.amount; }
  assert.ok(PEOPLE.every((p) => left[p] === 0), `${policy} 송금 뒤 잔액 0`);
  assert.ok(transfers.length <= PEOPLE.length - 1, `${policy} 송금 횟수`);
  console.log(policy, transfers.map((t) => `${t.from}→${t.to} ${won(t.amount)}`).join(', '));
}

// 규칙 배분이 시나리오 의도대로 나오는지
const consumers = (a, id) => a[id].consumers.join('');
assert.equal(consumers(allocs.izakaya, 'oolong'), '영희');
assert.equal(consumers(allocs.izakaya, 'highball'), '철수');
assert.equal(consumers(allocs.izakaya, 'sashimi'), '나철수영희');
assert.ok(allocs.izakaya.ochazuke.confidence < 0.7, '오차즈케는 확인 필요');
assert.equal(consumers(allocs.bar, 'b-whisky'), '나철수');
assert.equal(consumers(allocs.bar, 'b-cheese'), '나철수영희');
assert.equal(consumers(allocs.bar, 'b-nuts'), '나철수영희민수');
console.log('ok');
