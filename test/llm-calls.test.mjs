// Gemini 호출 줄이기: 답이 정해진 영수증은 묻지 않고, 같은 입력은 이전 답을 다시 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocateWithGemini } from '../src/agents/allocate.mjs';
import { createCache } from '../src/agents/cache.mjs';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

const room = { members: [{ uid: 'a', name: '가은' }, { uid: 'b', name: '나래' }, { uid: 'c', name: '다솜' }] };
const line = (id, name, tags = ['기타'], qty = 1) => ({ id, name, qty, unit: 1000, time: '', tags });
const exp = (items, present = ['a', 'b', 'c']) => ({ id: 'e1', title: '기차역', payer: 'a', method: 'card', present, items });

// 스키마의 줄 id마다 첫 번째 사람을 배정하는 가짜 Gemini. 호출 횟수를 센다.
function fakeGemini() {
  return {
    model: 'gemini-test-flash',
    calls: 0,
    async generate({ schema }) {
      this.calls++;
      const props = schema.properties.lines.items.properties;
      return { lines: props.id.enum.map((id) => ({ id, consumers: [props.consumers.items.enum[0]], confidence: 0.9, reason: '테스트' })) };
    },
  };
}

test('줄이 하나면 Gemini 없이 함께 있던 사람이 똑같이 나누고 묻지 않는다', async () => {
  const g = fakeGemini();
  const out = await allocateWithGemini(g, exp([line('t', '승차권')]), room, {});
  assert.equal(g.calls, 0);
  assert.equal(out.how, 'obvious');
  assert.deepEqual(out.alloc.t.consumers, ['a', 'b', 'c']);
  assert.ok(out.alloc.t.confidence >= 0.7);
  assert.equal(out.why, '줄이 하나라 함께 있던 3명이 똑같이 나눴어요.');
});

test('함께 있던 사람이 한 명이면 모든 줄이 그 사람 몫이고 묻지 않는다', async () => {
  const g = fakeGemini();
  const out = await allocateWithGemini(g, exp([line('x', '커피'), line('y', '빵')], ['b']), room, {});
  assert.equal(g.calls, 0);
  assert.equal(out.how, 'obvious');
  assert.deepEqual([out.alloc.x.consumers, out.alloc.y.consumers], [['b'], ['b']]);
});

test('줄이 하나여도 비서 기억이 그 줄에서 누군가를 빼면 Gemini에게 묻는다', async () => {
  const g = fakeGemini();
  const out = await allocateWithGemini(g, exp([line('beer', '생맥주', ['술'], 2)]), room, { c: ['술을 마시지 않아요'] });
  assert.equal(g.calls, 1);
  assert.equal(out.how, 'gemini');
});

test('같은 입력이면 이전 답을 다시 쓰고, 기억이 바뀌면 새로 묻는다', async () => {
  const g = fakeGemini();
  const cache = createCache();
  const e = exp([line('x', '커피'), line('y', '빵')]);
  const first = await allocateWithGemini(g, e, room, {}, { cache });
  const second = await allocateWithGemini(g, e, room, {}, { cache });
  assert.equal(g.calls, 1);
  assert.deepEqual([first.how, second.how], ['gemini', 'cache']);
  assert.deepEqual(second.alloc, first.alloc);
  await allocateWithGemini(g, e, room, { b: ['빵을 좋아해요'] }, { cache });
  assert.equal(g.calls, 2);
});

test('Gemini가 실패하면 캐시에 남기지 않는다', async () => {
  const cache = createCache();
  const broken = { model: 'gemini-test-flash', async generate() { throw new Error('boom'); } };
  const e = exp([line('x', '커피'), line('y', '빵')]);
  assert.equal((await allocateWithGemini(broken, e, room, {}, { cache })).how, 'rules');
  assert.equal(cache.size, 0);
});

test('createCache: 오래된 답은 버리고, 가득 차면 가장 오래 안 쓴 것부터 버린다', () => {
  let t = 0;
  const cache = createCache({ max: 2, ttlMs: 1000, now: () => t });
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.get('a'), 1); // a를 썼으니 b가 가장 오래 안 쓴 것
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  t = 1001;
  assert.equal(cache.get('a'), undefined);
});

test('방의 메뉴 배분: 같은 내용이면 Gemini를 한 번만 부르고 how로 알린다. 같은 방에서 바뀐 게 없으면 아예 다시 나누지 않는다', async () => {
  const g = fakeGemini();
  const store = new MemoryStore();
  const server = createApp({ store, gemini: g, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  try {
    const seed = async () => (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;
    const allocate = (roomId) => fetch(`${url}/api/rooms/${roomId}/expenses/${roomId}-izakaya/allocate`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': 'me' }, body: '{}',
    });
    const first = await seed();
    assert.equal((await (await allocate(first)).json()).how, 'gemini');
    assert.equal((await allocate(first)).status, 409); // 바뀐 게 없어 Gemini도 부르지 않는다
    const second = await seed(); // 시연에서 데모 방을 다시 만든 경우: 같은 영수증·같은 기억
    assert.equal((await (await allocate(second)).json()).how, 'cache');
    assert.equal(g.calls, 1);
    const metas = (await store.listEvents(second)).filter((e) => e.kind === 'allocated').map((e) => e.meta);
    assert.match(metas.at(-1), /이전 답 재사용/);
  } finally {
    server.close();
  }
});
