import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('browser auth retries a failed config request and shares concurrent initialization', async t => {
  // Execute the browser module with only its API origin replaced; no Firebase
  // credentials or external SDK are needed for the failed-config path.
  const source = (await readFile(new URL('../public/auth.js', import.meta.url), 'utf8'))
    .replace("import { API_BASE } from './api.js';", "const API_BASE = 'http://test.invalid';");
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) throw new Error('temporary network failure');
    return { ok: true, json: async () => ({ auth: { dev: true, firebase: null } }) };
  });
  const auth = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const first = auth.initAuth();
  assert.equal(auth.initAuth(), first);
  await assert.rejects(first, /temporary network failure/);
  const results = await Promise.all([auth.initAuth(), auth.initAuth(), auth.token()]);
  assert.equal(calls, 2);
  assert.equal(results[0].dev, true);
  assert.equal(results[2], null);
});

test('로그아웃하면 첫 화면(데모)이 아니라 로그인 화면(account.html)으로 가고, 이 기기의 내 흔적을 지운다', async t => {
  const source = (await readFile(new URL('../public/auth.js', import.meta.url), 'utf8'))
    .replace("import { API_BASE } from './api.js';", "const API_BASE = 'http://test.invalid';");
  const auth = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const store = { 'agent-settlement.uid': 'u-1', 'agent-settlement.timeline.r-1': '[]', other: 'keep' };
  Object.defineProperty(store, 'removeItem', { value: (key) => { delete store[key]; } });
  const saved = { location: globalThis.location, localStorage: globalThis.localStorage };
  t.after(() => Object.assign(globalThis, saved));
  Object.assign(globalThis, { location: { href: 'account.html#profile' }, localStorage: store });
  await auth.logout();
  assert.equal(location.href, 'account.html');
  assert.deepEqual(Object.keys(store), ['other']);
  await auth.logout('account.html?deleted=1');
  assert.equal(location.href, 'account.html?deleted=1', '탈퇴는 결과를 알리는 주소로 간다');
});
