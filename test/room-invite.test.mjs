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
  server = createApp({ store, gemini: null, clock: () => now, env: { DEV_SEED: '1' }, fxRates: { rateOn: async () => 900 } });
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

// 방에 보이는 이름·색은 각자의 프로필(로그인 계정, #2)을 따른다
const profile = (uid, name, color = '#3478f6') => post('/api/me', uid, { name, color });

// 방장 me(프로필 '재윤')가 방을 만들고 초대 토큰을 받는다. 철수(cs)도 프로필이 있다.
// 환율 정책은 외화 방에만 있어서(#55) 정책을 다루는 테스트는 currency: 'JPY'로 만든다
async function roomWithInvite(policy = 'actual', currency = 'KRW') {
  await profile('me', '재윤');
  await profile('cs', '철수', '#ff9500');
  const { json } = await post('/api/rooms', 'me', { name: '오사카', policy, currency });
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
  const join = await post(`/api/invites/${token}/join`, 'cs', { agree: true });
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

test('여럿이 같은 링크로 동시에 참가해도 아무도 빠지지 않는다(참가도 방 상태 줄에 선다)', async () => {
  // Firestore처럼 읽기에 왕복 시간이 있는 저장소. 줄에 서지 않으면 서로의 '읽고-고쳐-쓰기'가 겹쳐 멤버가 빠진다
  class SlowStore extends MemoryStore {
    async get(col, id) { await new Promise((r) => setTimeout(r, 5)); return super.get(col, id); }
  }
  const slow = new SlowStore();
  const app = createApp({ store: slow, gemini: null, clock: () => now, env: { DEV_SEED: '1' } });
  await new Promise((r) => app.listen(0, r));
  const at = `http://localhost:${app.address().port}`;
  const send = (path, uid, body) => fetch(at + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const friends = ['yh', 'ms', 'jh', 'sb', 'dk'];
    for (const uid of ['me', ...friends]) await send('/api/me', uid, { name: uid, color: '#3478f6' });
    const { room } = await send('/api/rooms', 'me', { name: '오사카' });
    const { token } = await send(`/api/rooms/${room.id}/invite`, 'me', {});
    await Promise.all(friends.map((uid) => send(`/api/invites/${token}/join`, uid, { agree: true })));
    const members = (await slow.get('rooms', room.id)).members.map((m) => m.uid);
    assert.deepEqual(members.sort(), ['me', ...friends].sort());
  } finally {
    app.close();
  }
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
  const { roomId, token } = await roomWithInvite('actual', 'JPY');
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });
  assert.deepEqual((await store.get('rooms', roomId)).policyAgreedBy, ['me']);
  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  assert.deepEqual((await store.get('rooms', roomId)).policyAgreedBy, ['me', 'cs']);
});

test('정책이 바뀌면 바꾼 사람만 동의한 상태로 돌아간다', async () => {
  const { roomId, token } = await roomWithInvite('actual', 'JPY');
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });
  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  const { json } = await post(`/api/rooms/${roomId}/policy`, 'cs', { policy: 'settle' });
  assert.equal(json.room.policy, 'settle');
  assert.deepEqual(json.room.policyAgreedBy, ['cs']);
  assert.equal((await post(`/api/rooms/${roomId}/policy`, 'cs', { policy: 'cheapest' })).status, 400);
});

test('완료 기준 2: 외화 방은 전원이 정책에 동의해야 정산 시작(청구서 보내기)이 열린다', async () => {
  const { roomId, token } = await roomWithInvite('actual', 'JPY');
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });

  const blocked = await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /철수/);

  await post(`/api/rooms/${roomId}/policy/agree`, 'cs');
  assert.equal((await post(`/api/rooms/${roomId}/invoices/send`, 'me')).status, 200);
  assert.equal((await store.get('rooms', roomId)).status, 'settling');
});

test('정산을 시작하면 초대·참가·정책 변경을 막는다', async () => {
  const { roomId, token } = await roomWithInvite('actual', 'JPY');
  await post(`/api/rooms/${roomId}/invoices/send`, 'me'); // 혼자인 방이라 바로 열린다
  assert.equal((await post(`/api/rooms/${roomId}/invite`, 'me')).status, 409);
  assert.equal((await post(`/api/invites/${token}/join`, 'cs', { agree: true })).status, 409);
  assert.equal((await post(`/api/rooms/${roomId}/policy`, 'me', { policy: 'settle' })).status, 409);
});

test('방에 보이는 이름·색은 내 프로필을 따르고, 따로 적은 이름은 쓰지 않는다', async () => {
  await profile('me', '재윤', '#34c759');
  const { json } = await post('/api/rooms', 'me', { name: '회식', myName: '다른 이름' });
  assert.deepEqual(json.room.members, [{ uid: 'me', name: '재윤', color: '#34c759' }]);
  const { token } = (await post(`/api/rooms/${json.room.id}/invite`, 'me')).json;
  await profile('yh', '영희', '#ff2d55');
  await post(`/api/invites/${token}/join`, 'yh', { agree: true, name: '가짜 이름' });
  assert.deepEqual((await store.get('rooms', json.room.id)).members.at(-1), { uid: 'yh', name: '영희', color: '#ff2d55' });
});

test('프로필이 아직 없는 계정은 로그인 이름으로 프로필을 만들어 들어간다', async () => {
  const { json } = await post('/api/rooms', 'newbie', { name: '첫 방' });
  const [m] = json.room.members;
  assert.equal(m.name, 'newbie'); // 개발용 신원의 이름은 uid다(배포에서는 Google 이름)
  assert.match(m.color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(await store.get('users', 'newbie'), { id: 'newbie', name: m.name, color: m.color });
});

test('탈퇴한 계정은 방을 만들거나 참가할 수 없다', async () => {
  const { token } = await roomWithInvite();
  await store.put('deletedUsers', { id: 'gone' });
  assert.equal((await post('/api/rooms', 'gone', { name: '탈퇴 뒤 방' })).status, 401);
  assert.equal((await post(`/api/invites/${token}/join`, 'gone', { agree: true })).status, 401);
});

test('초대 링크를 만든 사람이 탈퇴하면 초대 문서에서도 계정 연결이 끊기고, 링크는 그대로 쓸 수 있다', async () => {
  const { roomId, token } = await roomWithInvite();
  await post(`/api/invites/${token}/join`, 'cs', { agree: true });
  const { token: fresh } = (await post(`/api/rooms/${roomId}/invite`, 'cs')).json; // 철수가 만든 링크
  await store.eraseUser('cs');
  const inv = await store.get('invites', roomId);
  assert.notEqual(inv.createdBy, 'cs');
  assert.match(inv.createdBy, /^deleted-/);
  assert.equal((await post(`/api/invites/${fresh}/join`, 'yh', { agree: true })).status, 200, '남은 멤버를 위해 링크는 산다');
});
