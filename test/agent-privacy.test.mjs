// 개인 비서 설정(#5)의 공개 범위. 자동 수락 한도 금액과 비서 기억은 본인만 본다.
// 기억은 방마다 고른 것만 그 방 정산(배분·중재)에 쓰고, 다른 사람에게 기억 내용이 보일 수 있는 곳은 이의 중재뿐이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createApp } from '../src/app.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { createAgentSettings } from '../src/agents/settings.mjs';
import { sharedMemory, roomMemory } from '../src/agents/memory.mjs';
import { memoryRowsHtml } from '../public/agent-panel.js';

async function serve({ gemini = null } = {}) {
  const store = new MemoryStore();
  const server = createApp({ store, gemini, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const req = async (path, uid, body) => {
    const res = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'x-demo-user': uid, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  return { store, server, req };
}
// 방 화면이 받는 모든 것(방 응답과 비서 기록)을 글자 하나로 모은다
const seenBy = async (req, roomId, uid) => JSON.stringify([(await req(`/api/rooms/${roomId}`, uid)).json, (await req(`/api/rooms/${roomId}/events`, uid)).json]);

// 줄마다 첫 사람에게 몰고, 이유에 기억을 그대로 인용하는 모델(실제 모델도 그럴 수 있다)
function quotingGemini(secret) {
  const prompts = [];
  return {
    prompts,
    model: 'gemini-test',
    async generate(p) {
      prompts.push(JSON.stringify(p));
      const props = p.schema.properties.lines.items.properties;
      return { lines: props.id.enum.map((id) => ({ id, consumers: [props.consumers.items.enum[0]], confidence: 0.9, reason: `영희의 비서 기억 “${secret}”에 따라 영희는 뺐어요` })) };
    },
  };
}

// ---------------------------------------------------------------- 자동 수락 한도
test('자동 수락 한도 금액은 본인만 본다: 다른 사람의 방 화면·비서 기록·청구서에는 금액이 없다', async () => {
  const { store, server, req } = await serve();
  try {
    await seedDemoRoom(store, { id: 'r' });
    assert.equal((await req('/api/me/agent/rules', 'cs', { autoAccept: 187_654 })).status, 200); // 한도 안이라 받는 쪽
    assert.equal((await req('/api/me/agent/rules', 'ms', { autoAccept: 3_333 })).status, 200); // 넘어서 묻는 쪽
    await createOrchestrator({ store }).sendInvoices('r', 'me');
    const events = (await store.listEvents('r')).map((e) => e.kind);
    assert.ok(events.includes('invoice_accepted') && events.includes('invoice_asked'), '받는 경우와 묻는 경우가 모두 생긴다');

    for (const uid of ['me', 'yh', 'ms']) {
      const seen = await seenBy(req, 'r', uid);
      assert.ok(!seen.includes('₩187,654') && !seen.includes('187654'), `${uid}에게 철수의 한도 금액이 보이지 않는다`);
    }
    for (const uid of ['me', 'yh', 'cs']) assert.ok(!(await seenBy(req, 'r', uid)).includes('₩3,333'), `${uid}에게 민수의 한도 금액이 보이지 않는다`);
    // 한도 안에서 받았다는 사실과 넘어서 물었다는 사실은 남는다
    const all = (await store.listEvents('r')).map((e) => `${e.text} ${e.meta ?? ''}`).join('\n');
    assert.match(all, /자동 수락 한도 안이에요/);
    assert.match(all, /자동 수락 한도를 넘어서/);

    // 본인은 내 비서 설정과 방의 내 요약에서 본다
    assert.equal((await req('/api/me/agent', 'cs')).json.rules.autoAccept, 187_654);
    assert.equal((await req('/api/rooms/r', 'cs')).json.myAgent.autoAccept, 187_654);
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------- 기억: 방마다 고른 것만 정산에
test('기억은 방마다 고른 것만 정산에 쓴다: 새 기억은 어느 방에도 쓰이지 않는다', async () => {
  const store = new MemoryStore();
  const settings = createAgentSettings({ store });
  const secret = '임신 중이라 술 안 마셔요';
  await settings.addMemory('yh', secret);
  const room = (id) => ({ id, members: [{ uid: 'yh', name: '영희' }] });
  assert.deepEqual((await roomMemory(store, room('r1'))).yh, [], '고르기 전에는 어느 방에도 쓰지 않는다');

  const v = await settings.shareMemory('yh', 'r1', secret, true);
  assert.deepEqual(v.memoryShared, { r1: [secret] });
  assert.deepEqual((await roomMemory(store, room('r1'))).yh, [secret]);
  assert.deepEqual((await roomMemory(store, room('r2'))).yh, [], '고르지 않은 방에는 쓰지 않는다');

  await settings.editMemory('yh', secret, '술 안 마셔요');
  assert.deepEqual((await roomMemory(store, room('r1'))).yh, ['술 안 마셔요'], '고쳐도 고른 방은 그대로');
  await settings.shareMemory('yh', 'r1', '술 안 마셔요', false);
  assert.deepEqual((await store.get('agents', 'yh')).memoryShared, {}, '끄면 흔적이 없다');
  await settings.shareMemory('yh', 'r1', '술 안 마셔요', true);
  await settings.deleteMemory('yh', '술 안 마셔요');
  assert.deepEqual((await store.get('agents', 'yh')).memoryShared, { r1: [] }, '지우면 고른 방 목록에서도 빠진다');
  assert.deepEqual(sharedMemory({ memory: ['a'] }, 'r1'), [], '고른 방이 없는 옛 문서도 쓰지 않는다');
});

test('배분 이유에는 기억 내용이 없다: 모델이 기억을 인용해도 방 사람 누구에게도 보이지 않는다', async () => {
  const secret = '임신 중이라 술 안 마셔요';
  const gemini = quotingGemini(secret);
  const { store, server, req } = await serve({ gemini });
  try {
    await seedDemoRoom(store, { id: 'r' });
    assert.equal((await req('/api/me/agent/memory', 'yh', { text: secret })).status, 200);
    assert.equal((await req('/api/rooms/r/agent/shared', 'yh', { text: secret, shared: true })).status, 200);
    const out = await req('/api/rooms/r/expenses/r-izakaya/allocate', 'me', {});
    assert.equal(out.status, 200);
    assert.ok(gemini.prompts.at(-1).includes(secret), '고른 기억은 이 방 배분에 쓰인다');

    const memories = [secret, ...Object.values(await roomMemory(store, await store.get('rooms', 'r'))).flat()];
    for (const uid of ['me', 'cs', 'yh', 'ms']) {
      const seen = await seenBy(req, 'r', uid);
      for (const m of memories) assert.ok(!seen.includes(m), `${uid}의 방 화면에 기억 ‘${m}’이 보이지 않는다`);
    }
    assert.ok(!JSON.stringify(out.json).includes(secret), '나누기 응답에도 기억이 없다');
  } finally {
    server.close();
  }
});

test('규칙으로 나눠도(키 없음) 배분 이유에 기억 내용이 없다', async () => {
  const { store, server, req } = await serve();
  try {
    await seedDemoRoom(store, { id: 'r' });
    assert.equal((await req('/api/rooms/r/expenses/r-izakaya/allocate', 'me', {})).status, 200);
    const memories = Object.values(await roomMemory(store, await store.get('rooms', 'r'))).flat();
    assert.ok(memories.length, '시드 방은 기억을 이 방 정산에 쓰기로 골라 둔다');
    const seen = await seenBy(req, 'r', 'cs');
    for (const m of memories) assert.ok(!seen.includes(m), `기억 ‘${m}’이 보이지 않는다`);
    const exp = (await req('/api/rooms/r', 'cs')).json.expenses.find((e) => e.id === 'r-izakaya');
    assert.ok(Object.values(exp.alloc).every((a) => a.reason), '줄마다 이유는 남는다');
  } finally {
    server.close();
  }
});

test('설정 화면: 기억은 기본으로 이 방에 쓰지 않고, 고른 기억만 이 방에 쓰는 중으로 보인다', () => {
  const html = memoryRowsHtml({ memory: ['고르지 않은 기억', '고른 기억'], memoryShared: { r1: ['고른 기억'] } }, 'r1');
  assert.match(html, /aria-pressed="false"[^>]*aria-label="이 방 정산에 ‘고르지 않은 기억’ 쓰기"[^>]*>안 씀/);
  assert.match(html, /aria-pressed="true"[^>]*aria-label="이 방 정산에 ‘고른 기억’ 쓰기"[^>]*>이 방에 씀/);
  assert.match(memoryRowsHtml({ memory: ['고른 기억'], memoryShared: { r1: ['고른 기억'] } }, 'r2'), /aria-pressed="false"/, '다른 방에서는 쓰지 않는다');
});

test('방 사람에게는 누가 비서 설정을 마쳤는지만 보인다(규칙·기억은 없다)', async () => {
  const { store, server, req } = await serve();
  try {
    await seedDemoRoom(store, { id: 'r' });
    const cs = await store.get('agents', 'cs');
    await store.put('agents', { ...cs, onboardedAt: null }); // 철수는 아직 설정 전
    const seen = (await req('/api/rooms/r', 'me')).json;
    assert.deepEqual(seen.agentReady, ['me', 'yh', 'ms']);
    assert.equal(seen.myAgent.onboarded, true);
    assert.equal((await req('/api/rooms/r', 'cs')).json.myAgent.onboarded, false, '철수 화면에서는 내 칩에 설정 전이 붙는다');
  } finally {
    server.close();
  }
});
