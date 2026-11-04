// 로그인 토큰 확인(src/identity.mjs). 토큰 서명은 매번 서버 안에서 확인하고, Firebase Auth에 묻는 폐기 확인은
// 같은 사람에게 5분에 한 번만 한다(요청마다 약 0.25초가 들던 확인). 탈퇴하면 그 사람은 다음 요청에서 다시 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as identity from '../src/identity.mjs';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

// 진짜 ID 토큰처럼 가운데 조각에 sub(uid)가 든 토큰. sig가 'ok'가 아니면 서명이 틀린 토큰이다
const token = (sub, sig = 'ok') => `h.${Buffer.from(JSON.stringify({ sub, sig })).toString('base64url')}.s`;

// Firebase Admin auth의 verifyIdToken과 같은 모양: 서명은 늘 보고, 폐기·삭제는 checkRevoked일 때만 Auth 서버에 묻는다
function fakeAuth() {
  const revoked = new Set();
  const asked = []; // 확인할 때마다 checkRevoked 값을 남긴다(true = Auth 서버에 묻는 요청)
  return {
    revoked,
    asked,
    async verifyIdToken(raw, checkRevoked) {
      asked.push(checkRevoked);
      const claims = JSON.parse(Buffer.from(raw.split('.')[1], 'base64url'));
      if (claims.sig !== 'ok') throw Object.assign(new Error('bad signature'), { code: 'auth/argument-error' });
      if (checkRevoked && revoked.has(claims.sub)) throw Object.assign(new Error('revoked'), { code: 'auth/id-token-revoked' });
      return { uid: claims.sub, name: '테스트 사용자', auth_time: 0 };
    },
    async deleteUser(uid) { revoked.add(uid); },
  };
}

const bearer = (raw) => ({ headers: { authorization: `Bearer ${raw}` } });

test('같은 사람의 요청은 5분에 한 번만 Auth 서버에 폐기 여부를 묻고, 5분이 지나면 폐기된 토큰을 거부한다', async () => {
  const auth = fakeAuth();
  let now = 0;
  const identify = identity.createIdentity({ auth, now: () => now });
  assert.equal((await identify(bearer(token('me')))).uid, 'me');
  now = 5 * 60_000 - 1;
  assert.equal((await identify(bearer(token('me')))).uid, 'me');
  assert.deepEqual(auth.asked, [true, false]);
  auth.revoked.add('me');
  now = 5 * 60_000;
  assert.equal(await identify(bearer(token('me'))), null);
  assert.deepEqual(auth.asked, [true, false, true]);
});

test('처음 보는 사람은 다른 사람이 확인돼 있어도 바로 폐기 여부를 묻고, 거부된 확인은 기억하지 않는다', async () => {
  const auth = fakeAuth();
  const identify = identity.createIdentity({ auth, now: () => 0 });
  assert.equal((await identify(bearer(token('cs')))).uid, 'cs');
  auth.revoked.add('ms');
  assert.equal(await identify(bearer(token('ms'))), null);
  assert.equal(await identify(bearer(token('ms'))), null);
  assert.deepEqual(auth.asked, [true, true, true]);
});

test('확인해 둔 사람이라도 서명이 틀린 토큰은 거부한다', async () => {
  const auth = fakeAuth();
  const identify = identity.createIdentity({ auth, now: () => 0 });
  assert.equal((await identify(bearer(token('me')))).uid, 'me');
  assert.equal(await identify(bearer(token('me', 'forged'))), null);
  assert.equal(await identify(bearer('not-a-jwt')), null);
});

test('forgetVerified로 지운 사람은 5분 안이라도 다음 요청에서 다시 폐기 여부를 묻는다', async () => {
  const auth = fakeAuth();
  const identify = identity.createIdentity({ auth, now: () => 0 });
  assert.equal((await identify(bearer(token('me')))).uid, 'me');
  auth.revoked.add('me');
  identity.forgetVerified(auth, 'me');
  assert.equal(await identify(bearer(token('me'))), null);
});

test('탈퇴하면 그 계정의 토큰은 바로 다음 요청부터 거부된다(탈퇴 상태 화면 포함)', async (t) => {
  const auth = fakeAuth();
  const server = createApp({ store: new MemoryStore(), auth });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const req = (path, method = 'GET') => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: `Bearer ${token('me')}` } });
  assert.equal((await req('/api/me')).status, 200);
  assert.equal((await req('/api/me/delete', 'POST')).status, 200);
  assert.equal((await req('/api/me/deletion')).status, 401);
});
