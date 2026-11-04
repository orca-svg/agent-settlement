// 서버 조립: 설정·QR·정적 파일, 본문 크기 제한과 CORS. 옛 첫 화면 데모가 쓰던 API는 더 없다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

const fakeGemini = { model: 'fake', generate: async () => ({}) };

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

test('GET /api/config → { mode: gemini, model: fake }', async () => {
  const res = await fetch(base + '/api/config');
  assert.deepEqual(await res.json(), { mode: 'gemini', model: 'fake', auth: { firebase: null, dev: false, emulator: null } });
});

test('본문 20 KB 초과 → 413(로그인 확인보다 먼저 막는다)', async () => {
  const res = await post('/api/rooms', { name: '도쿄', pad: 'x'.repeat(21_000) });
  assert.equal(res.status, 413);
});

test('허용 출처 OPTIONS → 204 + Access-Control-Allow-Origin', async () => {
  const res = await fetch(base + '/api/rooms', { method: 'OPTIONS', headers: { origin: 'https://orca-svg.github.io' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://orca-svg.github.io');
  const other = await fetch(base + '/api/rooms', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('Gemini가 없으면 config는 rules', async () => {
  const s = createApp({ store: new MemoryStore(), gemini: null, env: {} });
  await new Promise((r) => s.listen(0, r));
  const b = `http://localhost:${s.address().port}`;
  assert.deepEqual(await (await fetch(b + '/api/config')).json(), { mode: 'rules', model: null, auth: { firebase: null, dev: false, emulator: null } });
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

test('정적 파일: / 는 첫 화면, 경로 탈출은 404', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /정산은 비서끼리/);
  assert.equal((await fetch(base + '/%2e%2e/server.mjs')).status, 404);
});

test('옛 첫 화면 데모가 쓰던 API(/api/allocate·/api/mediate)는 더 없다: 로그인 없이 Gemini를 부르는 길을 닫는다', async () => {
  for (const path of ['/api/allocate', '/api/mediate']) {
    const res = await post(path, { memory: {} });
    assert.equal(res.status, 404, path);
  }
});
