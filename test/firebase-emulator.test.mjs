// Opt in after starting the official local Auth Emulator. No real project,
// Google credentials or network service is needed for this integration test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { firebaseAuth } from '../src/firebase.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

test('Firebase Admin SDK + Auth Emulator: verify, profile, rooms, delete, stale token', { skip: process.env.RUN_FIREBASE_EMULATOR_TESTS !== '1' }, async t => {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  assert.match(host || '', /^127\.0\.0\.1:\d+$/);
  const env = { FIREBASE_PROJECT_ID: 'demo-agent-settlement', FIREBASE_API_KEY: 'demo-api-key', FIREBASE_AUTH_DOMAIN: 'demo-agent-settlement.firebaseapp.com', FIREBASE_APP_ID: 'demo-app-id', FIREBASE_AUTH_EMULATOR_HOST: host };
  const auth = await firebaseAuth(env);
  const signup = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
  assert.equal(signup.status, 200);
  const { idToken, localId } = await signup.json();
  t.after(async () => {
    await auth.deleteUser(localId).catch(() => {});
    const { deleteApp } = await import('firebase-admin/app');
    await deleteApp(auth.app);
  });
  const store = new MemoryStore();
  await store.put('rooms', { id: 'emulator-room', name: '에뮬레이터 방', members: [{ uid: localId, name: '테스트 사용자' }] });
  const server = createApp({ store, auth, env });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const req = (path, body, token = idToken) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await req('/api/me', null, 'not-a-token')).status, 401);
  assert.equal((await req('/api/me', { name: '테스트 프로필', color: '#123456' })).status, 200);
  assert.equal((await (await req('/api/me')).json()).profile.name, '테스트 프로필');
  assert.deepEqual((await (await req('/api/rooms')).json()).rooms.map(r => r.id), ['emulator-room']);
  assert.equal((await req('/api/me/delete', {})).status, 200);
  await assert.rejects(auth.getUser(localId), { code: 'auth/user-not-found' });
  assert.equal((await req('/api/me')).status, 401);
  assert.equal(await store.get('users', localId), null);
  assert.equal((await store.get('rooms', 'emulator-room')).members[0].deleted, true);
});
