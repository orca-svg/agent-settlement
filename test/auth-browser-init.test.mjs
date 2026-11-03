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
