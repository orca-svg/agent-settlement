// 서버 조립: 데모 API의 응답 모양을 유지하면서, Gemini 출력은 서버가 다시 검증한다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

let lastPrompt = null;
let reply = {};
const fakeGemini = { model: 'fake', generate: async (prompt) => { lastPrompt = prompt; return reply; } };

let server;
let base;
before(async () => {
  server = createApp({ store: new MemoryStore(), gemini: fakeGemini, env: {} });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const post = (path, body, headers = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const memory = { 나: ['맥주를 좋아해요'], 철수: ['술자리에서 하이볼을 자주 시켜요'], 영희: ['술을 마시지 않아요'], 민수: ['날생선을 먹지 않아요'] };

test('GET /api/config → { mode: gemini, model: fake }', async () => {
  const res = await fetch(base + '/api/config');
  assert.deepEqual(await res.json(), { mode: 'gemini', model: 'fake' });
});

test('POST /api/allocate (가짜 Gemini가 오차즈케를 빼먹음) → 그 줄은 규칙 배분으로 채우고 filled: true', async () => {
  reply = { lines: [
    { id: 'beer', consumers: ['나', '철수', '민수'], confidence: 0.9, reason: '술' },
    { id: 'oolong', consumers: ['영희'], confidence: 0.8, reason: '무알코올' },
  ] };
  const res = await post('/api/allocate', { memory });
  const out = await res.json();
  assert.equal(res.status, 200);
  assert.equal(out.source, 'fake');
  assert.deepEqual(out.lines.beer.consumers, ['나', '철수', '민수']);
  assert.equal(out.lines.ochazuke.filled, true);
  assert.ok(out.lines.ochazuke.confidence < 0.7);
  assert.match(lastPrompt.user, /영희의 비서: “술을 마시지 않아요”/);
});

test('POST /api/mediate (가짜가 22:55 뒤 위스키에 민수를 넣음) → 서버가 민수를 뺀다', async () => {
  reply = { summary: '중재했어요.', lines: [
    { id: 'b-whisky', consumers: ['나', '민수'], confidence: 0.6, reason: '?' },
    { id: 'b-nuts', consumers: ['나', '철수', '영희', '민수'], confidence: 0.9, reason: '안주' },
  ] };
  const out = await (await post('/api/mediate', { memory })).json();
  assert.equal(out.summary, '중재했어요.');
  assert.deepEqual(out.lines['b-whisky'].consumers, ['나']);
  assert.deepEqual(out.lines['b-nuts'].consumers, ['나', '철수', '영희', '민수']);
  assert.equal(out.lines['b-cheese'].filled, true);
  assert.ok(!out.lines['b-cheese'].consumers.includes('민수'));
});

test('본문 20 KB 초과 → 413', async () => {
  const res = await post('/api/allocate', { memory, pad: 'x'.repeat(21_000) });
  assert.equal(res.status, 413);
});

test('허용 출처 OPTIONS → 204 + Access-Control-Allow-Origin', async () => {
  const res = await fetch(base + '/api/allocate', { method: 'OPTIONS', headers: { origin: 'https://orca-svg.github.io' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://orca-svg.github.io');
  const other = await fetch(base + '/api/allocate', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('Gemini가 없으면 config는 rules, 배분은 규칙으로', async () => {
  const s = createApp({ store: new MemoryStore(), gemini: null, env: {} });
  await new Promise((r) => s.listen(0, r));
  const b = `http://localhost:${s.address().port}`;
  assert.deepEqual(await (await fetch(b + '/api/config')).json(), { mode: 'rules', model: null });
  const out = await (await fetch(b + '/api/allocate', { method: 'POST', body: JSON.stringify({ memory }) })).json();
  assert.equal(out.source, 'rules');
  assert.deepEqual(out.lines.oolong.consumers, ['영희']);
  s.close();
});

test('GET /api/qr/:token → 302로 원래 링크를 풀어준다. 틀린 토큰은 404', async () => {
  const { signQrToken } = await import('../src/payments/qr.mjs');
  const token = signQrToken('supertoss://send?x=1');
  const res = await fetch(base + `/api/qr/${token}`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'supertoss://send?x=1');
  assert.equal((await fetch(base + '/api/qr/not-a-token', { redirect: 'manual' })).status, 404);
});

test('정적 파일: / 는 데모 화면, 경로 탈출은 404', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /정산은 비서끼리/);
  assert.equal((await fetch(base + '/%2e%2e/server.mjs')).status, 404);
});
