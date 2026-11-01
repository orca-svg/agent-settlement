// Gemini 월 예산 상한(#10). 한도를 넘으면 generate()가 실패하고, 호출하는 쪽(allocate/mediate)이 규칙으로 대신한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMonthlyBudget } from '../src/gemini.mjs';

function fakeGemini() {
  let calls = 0;
  return { model: 'fake', calls: () => calls, async generate() { calls++; return { ok: true }; } };
}

test('한도 안에서는 그대로 통과한다', async () => {
  const base = fakeGemini();
  const g = withMonthlyBudget(base, { maxCalls: 2 });
  await g.generate();
  await g.generate();
  assert.equal(base.calls(), 2);
});

test('한도를 넘으면 실패하고, 실제 Gemini는 더 불리지 않는다', async () => {
  const base = fakeGemini();
  const g = withMonthlyBudget(base, { maxCalls: 1 });
  await g.generate();
  await assert.rejects(() => g.generate());
  assert.equal(base.calls(), 1);
});

test('달이 바뀌면 다시 센다', async () => {
  const base = fakeGemini();
  let month = '2026-11';
  const g = withMonthlyBudget(base, { maxCalls: 1, now: () => new Date(`${month}-01T00:00:00Z`) });
  await g.generate();
  await assert.rejects(() => g.generate());
  month = '2026-12';
  await g.generate();
  assert.equal(base.calls(), 2);
});

test('maxCalls이 없으면(0 또는 생략) 상한을 두지 않는다', async () => {
  const base = fakeGemini();
  const g = withMonthlyBudget(base, {});
  for (let i = 0; i < 5; i++) await g.generate();
  assert.equal(base.calls(), 5);
});

test('gemini가 없으면(null) 그대로 null', () => {
  assert.equal(withMonthlyBudget(null, { maxCalls: 10 }), null);
});
