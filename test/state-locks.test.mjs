// 방 단위 줄 세우기: 같은 방의 일은 차례로, 다른 방의 일은 함께, 여러 방에 걸친 일은 혼자 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateLocks } from '../src/state-locks.mjs';

// 끝낼 때를 테스트가 정하는 작업. 시작 순서와 끝 순서를 log에 남긴다
function job(log, name) {
  let finish;
  const done = new Promise((r) => { finish = r; });
  return { finish, run: async () => { log.push(`${name}:start`); await done; log.push(`${name}:end`); return name; } };
}
const tick = () => new Promise((r) => setImmediate(r));

test('같은 방의 일은 앞의 일이 끝난 뒤에 시작한다', async () => {
  const locks = createStateLocks();
  const log = [];
  const a = job(log, 'a');
  const b = job(log, 'b');
  const pa = locks.room('r1', a.run);
  const pb = locks.room('r1', b.run);
  await tick();
  assert.deepEqual(log, ['a:start']);
  a.finish();
  assert.equal(await pa, 'a');
  await tick();
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start']);
  b.finish();
  assert.equal(await pb, 'b');
});

test('다른 방의 일은 기다리지 않는다', async () => {
  const locks = createStateLocks();
  const log = [];
  const a = job(log, 'a');
  const b = job(log, 'b');
  const pa = locks.room('r1', a.run);
  const pb = locks.room('r2', b.run);
  await tick();
  assert.deepEqual(log, ['a:start', 'b:start']);
  b.finish();
  a.finish();
  await Promise.all([pa, pb]);
});

test('여러 방에 걸친 일은 진행 중인 방의 일이 끝나기를 기다리고, 그 뒤에 온 방의 일은 그것을 기다린다', async () => {
  const locks = createStateLocks();
  const log = [];
  const a = job(log, 'a');
  const all = job(log, 'all');
  const b = job(log, 'b');
  const pa = locks.room('r1', a.run);
  const pall = locks.global(all.run);
  const pb = locks.room('r2', b.run);
  await tick();
  assert.deepEqual(log, ['a:start']);
  a.finish();
  await pa;
  await tick();
  assert.deepEqual(log, ['a:start', 'a:end', 'all:start']);
  all.finish();
  await pall;
  await tick();
  assert.deepEqual(log, ['a:start', 'a:end', 'all:start', 'all:end', 'b:start']);
  b.finish();
  await pb;
});

test('앞의 일이 실패해도 다음 일은 돈다', async () => {
  const locks = createStateLocks();
  await assert.rejects(locks.room('r1', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await locks.room('r1', async () => 'next'), 'next');
  await assert.rejects(locks.global(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await locks.room('r1', async () => 'after-global'), 'after-global');
});
