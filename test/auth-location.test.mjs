import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { classifyPosition } from '../public/location-core.js';
import { mediateWithGemini } from '../src/agents/mediate.mjs';

async function setup(t, options = {}) {
  let now = new Date('2026-11-01T12:00:00Z');
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: 'room-one' });
  const exp = (await store.list('expenses', { roomId: 'room-one' })).find(e => e.items?.length);
  await store.put('expenses', { ...exp, date: '2026-11-01' });
  const verified = [];
  const deleted = [];
  const auth = {
    async verifyIdToken(token, checkRevoked) {
      verified.push([token, checkRevoked]);
      if (!['me', 'cs', 'yh', 'ms', 'outsider'].includes(token)) throw new Error('invalid/revoked/expired');
      return { uid: token, name: '테스트 사용자', auth_time: now.getTime() / 1000 };
    },
    async deleteUser(uid) { deleted.push(uid); },
  };
  const server = createApp({ store, auth, clock: () => now, ...options });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { uid = 'me', body, headers = {}, method = body ? 'POST' : 'GET' } = {}) => fetch(base + path, { method, headers: { ...(uid ? { authorization: `Bearer ${uid}` } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { store, request, verified, deleted, exp, auth, advance: ms => { now = new Date(+now + ms); }, now: () => now };
}

test('real APIs reject missing, forged and revoked credentials; demo remains public', async t => {
  const { request, verified } = await setup(t);
  assert.equal((await request('/api/rooms', { uid: null, headers: { 'x-demo-user': 'me' } })).status, 401);
  assert.equal((await request('/api/rooms', { uid: 'expired' })).status, 401);
  assert.equal((await request('/api/rooms/room-one', { uid: 'outsider' })).status, 403);
  assert.equal((await request('/api/rooms/nope', { uid: null })).status, 401);
  const res = await request('/api/rooms');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).rooms.length, 1);
  assert.ok(verified.every(([, revocation]) => revocation === true));
  assert.equal((await request('/api/allocate', { uid: null, body: { memory: {} } })).status, 200);
});

test('DEV_SEED cannot enable identity spoofing in production', async t => {
  const { request } = await setup(t, { auth: null, env: { NODE_ENV: 'production', DEV_SEED: '1' } });
  assert.equal((await request('/api/dev/seed', { uid: null, body: {} })).status, 404);
  assert.equal((await request('/api/rooms/room-one', { uid: null, headers: { 'x-demo-user': 'me' } })).status, 401);
});

test('AI limits follow verified uid even when IP changes', async t => {
  const { request } = await setup(t);
  const path = '/api/rooms/room-one/receipts/extract';
  for (let i = 0; i < 30; i++) {
    assert.equal((await request(path, { body: {}, headers: { 'x-forwarded-for': `192.0.2.${i + 1}` } })).status, 400);
  }
  assert.equal((await request(path, { body: {}, headers: { 'x-forwarded-for': '198.51.100.1' } })).status, 429);
  assert.equal((await request(path, { uid: 'ms', body: {}, headers: { 'x-forwarded-for': '198.51.100.1' } })).status, 400);
});

test('profile updates only verified user and room list never leaks other rooms', async t => {
  const { request, store } = await setup(t);
  await store.put('rooms', { id: 'secret', name: '비공개', members: [{ uid: 'outsider', name: '타인' }] });
  assert.equal((await request('/api/me', { body: { name: '새 이름', color: '#112233', uid: 'ms' } })).status, 200);
  assert.equal((await store.get('users', 'me')).name, '새 이름');
  assert.equal(await store.get('users', 'ms'), null);
  assert.deepEqual((await (await request('/api/rooms')).json()).rooms.map(r => r.id), ['room-one']);
  assert.equal((await request('/api/me', { body: { name: 'x', color: 'url(evil)' } })).status, 400);
  assert.equal((await store.listEvents('room-one')).at(-1).kind, 'profile_updated');
});

test('account deletion removes private data; failures can be retried', async t => {
  const { request, store, auth, deleted } = await setup(t);
  await store.put('users', { id: 'outsider', name: '별명' });
  await store.put('agents', { id: 'outsider', memory: ['개인정보'] });
  const remove = auth.deleteUser;
  auth.deleteUser = async () => { throw new Error('network failure'); };
  assert.equal((await request('/api/me/delete', { uid: 'outsider', body: {} })).status, 500);
  assert.equal((await request('/api/me', { uid: 'outsider' })).status, 401);
  auth.deleteUser = remove;
  assert.equal((await request('/api/me/delete', { uid: 'outsider', body: {} })).status, 200);
  assert.equal(await store.get('users', 'outsider'), null);
  assert.equal(await store.get('agents', 'outsider'), null);
  assert.deepEqual(deleted, ['outsider']);
});

test('location requires consent, rejects coordinates/stale times/cross-room data, expires and purges', async t => {
  const { request, exp, now, advance, store } = await setup(t);
  const path = '/api/rooms/room-one/location';
  const body = { expenseId: exp.id, action: 'checkout', relation: 'away', observedAt: now().toISOString() };
  assert.equal((await request(path, { body })).status, 403);
  assert.equal((await request(`${path}/consent`, { body: { agree: false, expiresAt: new Date(+now() + 60000).toISOString() } })).status, 400);
  assert.equal((await request(`${path}/consent`, { body: { agree: true, expiresAt: new Date(+now() + 60000).toISOString() } })).status, 200);
  assert.equal((await request(path, { body: { ...body, latitude: 37 } })).status, 400);
  assert.equal((await request(path, { body: { ...body, observedAt: '2026-10-31T12:00:00Z' } })).status, 400);
  assert.equal((await request(path, { body: { ...body, expenseId: 'other-room' } })).status, 400);
  assert.equal((await request(path, { uid: 'outsider', body })).status, 403);
  assert.equal((await request(path, { body })).status, 200);
  assert.equal((await request(path, { body })).status, 409);
  assert.deepEqual((await (await request(path, { uid: 'ms' })).json()).records, []);
  const records = await store.list('locationEvidence');
  assert.equal(records.length, 1);
  assert.equal(records[0].latitude, undefined);
  assert.match(records[0].summary, /체크아웃.*확정 아님/);
  advance(61000);
  assert.deepEqual((await (await request(path)).json()).records, []);
  assert.deepEqual(await store.list('locationEvidence'), []);
  const events = await store.listEvents('room-one');
  assert.equal(events.at(-1).kind, 'location_removed');
  await request(path);
  assert.equal((await store.listEvents('room-one')).length, events.length);
});

test('revocation removes attached summaries and reopens an unconfirmed proposal', async t => {
  const { request, exp, now, store } = await setup(t);
  const path = '/api/rooms/room-one/location';
  await request(`${path}/consent`, { body: { agree: true, expiresAt: new Date(+now() + 60000).toISOString() } });
  await request(path, { body: { expenseId: exp.id, action: 'checkout', relation: 'away', observedAt: now().toISOString() } });
  const response = await request('/api/rooms/room-one/disputes', { body: { expenseId: exp.id, claim: '참석 근거를 확인해 주세요' } });
  assert.equal(response.status, 200);
  const d = (await store.list('disputes'))[0];
  assert.equal(d.evidence.length, 1);
  assert.equal(d.evidence[0].kind, 'text');
  assert.equal(d.evidence[0].uncertain, false);
  assert.equal(d.evidence[0].relation, 'away');
  assert.equal(d.evidence[0].observedAt, now().toISOString());
  assert.equal(d.evidence[0].requiresHumanApproval, true);
  await store.put('disputes', { ...d, status: 'proposed', agreedBy: ['me'], proposal: { summary: d.evidence[0].summary } });
  await request(`${path}/revoke`, { body: {} });
  const after = await store.get('disputes', d.id);
  assert.deepEqual(after.evidence, []);
  assert.equal(after.proposal, undefined);
  assert.equal(after.status, 'open');
  assert.deepEqual(after.agreedBy, []);
  assert.ok(!(JSON.stringify(await store.listEvents('room-one'))).includes('한국 시각'));
  assert.equal((await store.listEvents('room-one')).at(-1).kind, 'location_removed');
});

// #7: 원본 대신 요약을 '상대 비서와 중재 비서'에게만 공유한다. 같은 방의 다른 멤버에게는 첨부됐다는 사실만 보인다
test('location summary is visible only to the dispute parties; other members see that one is attached', async t => {
  const { request, exp, now, store } = await setup(t);
  const path = '/api/rooms/room-one/location';
  await request(`${path}/consent`, { body: { agree: true, expiresAt: new Date(+now() + 60000).toISOString() } });
  await request(path, { body: { expenseId: exp.id, action: 'checkout', relation: 'away', observedAt: now().toISOString() } });
  assert.equal((await request('/api/rooms/room-one/disputes', { body: { expenseId: exp.id, claim: '참석 근거를 확인해 주세요' } })).status, 200);
  const d = (await store.list('disputes'))[0];
  const summary = d.evidence[0].summary;
  // 중재안 요약과 줄별 이유에도 위치 요약이 그대로 들어갈 수 있다
  await store.put('disputes', { ...d, status: 'proposed', agreedBy: [], proposal: { summary: `근거: ${summary}`, alloc: { [exp.items[0].id]: { consumers: ['me'], confidence: 0.4, reason: summary } }, source: 'rules' } });
  const seen = async uid => (await (await request('/api/rooms/room-one', { uid })).json()).disputes.find(x => x.id === d.id);
  const parties = new Set(['me', exp.payer]);
  for (const uid of parties) assert.ok(JSON.stringify(await seen(uid)).includes(summary), `${uid}는 당사자예요`);
  const room = await store.get('rooms', 'room-one');
  const others = room.members.map(m => m.uid).filter(uid => !parties.has(uid));
  assert.ok(others.length);
  for (const uid of others) {
    const hidden = await seen(uid);
    assert.doesNotMatch(JSON.stringify(hidden), /한국 시각|체크아웃|지정 장소/);
    assert.equal(hidden.evidence.length, 1);
    assert.equal(hidden.evidence[0].locationId, undefined);
  }
  assert.match((await store.get('disputes', d.id)).evidence[0].summary, /한국 시각/); // 저장본은 그대로
});

test('clear location retains confidence but cannot turn a model assertion into a confirmed allocation', async t => {
  const { store, exp } = await setup(t);
  const room = await store.get('rooms', 'room-one');
  const result = await mediateWithGemini({ model: 'fake', generate: async () => ({ summary: '확인', lines: exp.items.map(it => ({ id: it.id, consumers: [room.members.find(m => m.uid === 'me').name], confidence: 1, reason: '추측', evidenceConflict: false })) }) }, {
    exp, room, dispute: { by: 'me', claim: '이의', evidence: [{ kind: 'text', source: 'browser_self_report', relation: 'away', uncertain: false, summary: '기기 보고' }] }, memoryByUid: {},
  });
  assert.ok(Object.values(result.alloc).every(a => a.confidence === 1 && a.confirmed === false));
});

test('distance uses accuracy and never classifies poor GPS as definitive', () => {
  const target = { latitude: 37, longitude: 127, radius: 100 };
  assert.equal(classifyPosition({ coords: { latitude: 37, longitude: 127, accuracy: 10 } }, target), 'near');
  assert.equal(classifyPosition({ coords: { latitude: 38, longitude: 127, accuracy: 10 } }, target), 'away');
  assert.equal(classifyPosition({ coords: { latitude: 37, longitude: 127, accuracy: 300 } }, target), 'uncertain');
  assert.throws(() => classifyPosition({ coords: { latitude: NaN, longitude: 127, accuracy: 10 } }, target));
});
