// public/room-api.js의 실시간(onSnapshot) 판단을 브라우저 없이 확인한다(auth-browser-init.test.mjs와 같은 방식).
// Firebase SDK를 부르기 전 갈림길만 본다: 서버가 Firestore가 아니면 한 번만 묻고, 로그인 전이거나 설정을 못 받았으면 다음 구독 때 다시 묻는다(#3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadRoomApi() {
  const source = (await readFile(new URL('../public/room-api.js', import.meta.url), 'utf8'))
    .replace("import { API_BASE } from './api.js';", "const API_BASE = 'http://test.invalid';")
    .replace("import { initAuth, currentUser, authOptions, token } from './auth.js';", 'const { initAuth, currentUser, authOptions, token } = globalThis.roomApiAuth;');
  globalThis.roomApiAuth = { initAuth: async () => ({}), currentUser: () => null, authOptions: () => ({ dev: false }), token: async () => null };
  // 테스트마다 모듈 상태(캐시)를 새로 시작한다
  return import(`data:text/javascript;base64,${Buffer.from(`${source}\n// ${Math.random()}`).toString('base64')}`);
}

const settle = () => new Promise((r) => setTimeout(r, 20));

function mockConfig(t, config) {
  const calls = { config: 0 };
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).endsWith('/api/config')) {
      calls.config++;
      return config(calls.config);
    }
    return { ok: true, json: async () => ({ events: [] }) };
  });
  return calls;
}

test('서버가 Firestore가 아니면 실시간 여부를 한 번만 묻는다', async (t) => {
  const calls = mockConfig(t, () => ({ ok: true, json: async () => ({}) }));
  const { subscribeRoom } = await loadRoomApi();
  for (let i = 0; i < 2; i++) {
    subscribeRoom('r1', () => {})();
    await settle();
  }
  assert.equal(calls.config, 1);
});

test('로그인 전에 연 구독은 폴링으로 가지만, 다음 구독 때 실시간을 다시 확인한다', async (t) => {
  const calls = mockConfig(t, () => ({ ok: true, json: async () => ({ realtime: { firestore: true } }) }));
  const { subscribeRoom } = await loadRoomApi();
  for (let i = 0; i < 2; i++) {
    subscribeRoom('r1', () => {})();
    await settle();
  }
  assert.equal(calls.config, 2);
});

test('설정을 잠깐 못 받아도 다음 구독 때 다시 시도한다', async (t) => {
  const calls = mockConfig(t, (n) => {
    if (n === 1) throw new Error('temporary network failure');
    return { ok: true, json: async () => ({}) };
  });
  const { subscribeRoom } = await loadRoomApi();
  for (let i = 0; i < 2; i++) {
    subscribeRoom('r1', () => {})();
    await settle();
  }
  assert.equal(calls.config, 2);
});
