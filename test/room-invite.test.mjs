// #4 초대·참가·환율 정책 동의, 그리고 '정산 시작' 잠금.
// 완료 기준: 링크로 들어온 친구가 멤버 목록에 보인다 / 전원이 정책에 동의해야 정산 시작이 열린다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { INVITE_TTL_MS } from '../src/rooms/routes.mjs';

const store = new MemoryStore();
let now = new Date('2026-11-03T10:00:00Z');
let server;
let base;
before(async () => {
  server = createApp({ store, gemini: null, clock: () => now, env: {} });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, uid, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(uid ? { 'x-demo-user': uid } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const post = (path, uid, body = {}) => call('POST', path, uid, body);
const get = (path, uid) => call('GET', path, uid);

// 방장 me가 방을 만들고 초대 토큰을 받는다
async function roomWithInvite(policy = 'actual') {
  const { json } = await post('/api/rooms', 'me', { name: '오사카', myName: '재윤', policy });
  const roomId = json.room.id;
  const { json: inv } = await post(`/api/rooms/${roomId}/invite`, 'me');
  return { roomId, token: inv.token };
}

test('초대 토큰은 추측하기 어렵고(24자 base64url) 7일 뒤 만료된다', async () => {
  const { roomId, token } = await roomWithInvite();
  assert.match(token, /^[A-Za-z0-9_-]{24}$/);
  const { json } = await get(`/api/rooms/${roomId}/invite`, 'me');
  assert.equal(json.invite.token, token);
  assert.equal(new Date(json.invite.expiresAt).getTime(), now.getTime() + INVITE_TTL_MS);
});

test('멤버가 아니면 초대 링크를 만들 수 없다', async () => {
  const { roomId } = await roomWithInvite();
  assert.equal((await post(`/api/rooms/${roomId}/invite`, 'stranger')).status, 403);
});

test('링크만 있으면 참가 화면을 볼 수 있고, 기억·계좌 같은 건 보이지 않는다', async () => {
  const { token } = await roomWithInvite();
  const { status, json } = await get(`/api/invites/${token}`);
  assert.equal(status, 200);
  assert.equal(json.room.name, '오사카');
  assert.deepEqual(json.room.members, [{ name: '재윤' }]); // uid도 내보내지 않는다
  assert.equal(json.alreadyMember, false);
});

test('완료 기준 1: 링크로 들어온 친구가 방 멤버 목록에 보인다', async () => {
  const { roomId, token } = await roomWithInvite();
  const join = await post(`/api/invites/${token}/join`, 'cs', { agree: true, name: '철수' });
  assert.deepEqual(join.json, { roomId });
  const { status, json } = await get(`/api/rooms/${roomId}`, 'cs');
  assert.equal(status, 200);
  assert.deepEqual(json.room.members.map((m) => m.name), ['재윤', '철수']);
  const { json: ev } = await get(`/api/rooms/${roomId}/events`, 'me');
  assert.ok(ev.events.some((e) => e.kind === 'member_joined'));
});

test('참가 동의 없이는 참가할 수 없고, 신원이 없으면 401', async () => {
  const { token } = await roomWithInvite();
  assert.equal((await post(`/api/invites/${token}/join`, 'cs', {})).status, 400);
  assert.equal((await post(`/api/invites/${token}/join`, null, { agree: true })).status, 401);
});

test('두 번 참가해도 멤버는 한 번만 들어간다', async () => {
  const { roomId, token } = await roomWithInvite();
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });
  assert.equal((await store.get('rooms', roomId)).members.length, 2);
  assert.equal((await get(`/api/invites/${token}`, 'cs')).json.alreadyMember, true);
});

test('잘못된 토큰·만료된 토큰·다시 만들기 전의 토큰은 404', async () => {
  const { roomId, token } = await roomWithInvite();
  assert.equal((await get('/api/invites/nope')).status, 404);
  assert.equal((await get(`/api/invites/${'A'.repeat(24)}`)).status, 404);

  const { json: again } = await post(`/api/rooms/${roomId}/invite`, 'me'); // 다시 만들기
  assert.notEqual(again.token, token);
  assert.equal((await get(`/api/invites/${token}`)).status, 404);
  assert.equal((await post(`/api/invites/${token}/join`, 'cs', { agree: true })).status, 404);

  const saved = now;
  now = new Date(now.getTime() + INVITE_TTL_MS + 1);
  assert.equal((await get(`/api/invites/${again.token}`)).status, 404);
  assert.equal((await get(`/api/rooms/${roomId}/invite`, 'me')).json.invite, null);
  now = saved;
});

test('새 멤버는 정책에 아직 동의하지 않은 상태이고, 동의하면 들어간다(두 번 눌러도 한 번)', async () => {
  const { roomId, token } = await roomWithInvite();
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });
  assert.deepEqual((await store.get('rooms', roomId)).policyAgreedBy, ['me']);
  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  assert.deepEqual((await store.get('rooms', roomId)).policyAgreedBy, ['me', 'cs']);
});

test('정책이 바뀌면 바꾼 사람만 동의한 상태로 돌아간다', async () => {
  const { roomId, token } = await roomWithInvite();
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });
  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  const { json } = await post(`/api/rooms/${roomId}/policy`, 'cs', { policy: 'settle' });
  assert.equal(json.room.policy, 'settle');
  assert.deepEqual(json.room.policyAgreedBy, ['cs']);
  assert.equal((await post(`/api/rooms/${roomId}/policy`, 'cs', { policy: 'cheapest' })).status, 400);
});

test('완료 기준 2: 전원이 정책에 동의해야 정산 시작(청구서 보내기)이 열린다', async () => {
  const { roomId, token } = await roomWithInvite();
  await post(`/api/invites/${token}/join`, 'cs', { agree: true, name: '철수' });

  const blocked = await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /철수/);

  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  assert.equal((await post(`/api/rooms/${roomId}/invoices/send`, 'me')).status, 200);
  assert.equal((await store.get('rooms', roomId)).status, 'settling');
});

test('정산을 시작하면 초대·참가·정책 변경을 막는다', async () => {
  const { roomId, token } = await roomWithInvite();
  await post(`/api/rooms/${roomId}/invoices/send`, 'me'); // 혼자인 방이라 바로 열린다
  assert.equal((await post(`/api/rooms/${roomId}/invite`, 'me')).status, 409);
  assert.equal((await post(`/api/invites/${token}/join`, 'cs', { agree: true })).status, 409);
  assert.equal((await post(`/api/rooms/${roomId}/policy`, 'me', { policy: 'settle' })).status, 409);
});

test('방을 만들 때 적은 내 이름이 멤버 이름이 된다', async () => {
  const { json } = await post('/api/rooms', 'me', { name: '회식', myName: '  재윤  ' });
  assert.deepEqual(json.room.members, [{ uid: 'me', name: '재윤' }]);
});
