// FirestoreStore(#3)에서만 생기는 일: 동시 seq, 숨은 칸, 영수증 사진(Cloud Storage), 탈퇴 트랜잭션, 보안 규칙, 서버 계산.
// 에뮬레이터가 있을 때만 돈다(docs/firestore-setup.md). 없으면 건너뛴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const skip = !(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) && 'Firestore·Storage 에뮬레이터 없음';
const load = async () => ({
  ...(await import('./helpers/firestore-emulator.mjs')),
  ...(await import('../src/dev/seed.mjs')),
  ...(await import('../src/store/encrypted.mjs')),
  ...(await import('../public/core.js')),
  ...(await import('../src/app.mjs')),
});
const KEY = Buffer.alloc(32, 9);

test('appendEvent: 동시에 불러도 seq가 빈틈·중복 없이. 경합에 진 호출은 seq를 먹지 않고 오류로 끝난다', { skip }, async () => {
  const { emulatorStore } = await load();
  const store = emulatorStore();
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => store.appendEvent('r1', { from: 'system', to: 'all', kind: 'x', text: String(i) })));
  const saved = results.filter((r) => r.status === 'fulfilled').map((r) => r.value.seq).sort((a, b) => a - b);
  assert.ok(saved.length >= 1);
  assert.deepEqual(saved, Array.from({ length: saved.length }, (_, i) => i + 1));
  assert.deepEqual((await store.listEvents('r1')).map((e) => e.seq), saved);
  assert.equal((await store.appendEvent('r1', { from: 'system', to: 'all', kind: 'x', text: 'next' })).seq, saved.length + 1);
  for (const r of results) if (r.status === 'rejected') assert.equal(r.reason.code, 10); // ABORTED
});

test('목록 순서는 처음 넣은 순서(덮어써도 유지), 숨은 칸은 밖으로 안 나온다, undefined 칸은 빠진다', { skip }, async () => {
  const { emulatorStore } = await load();
  const store = emulatorStore();
  for (const id of ['r1-zz', 'r1-aa', 'r1-mm']) await store.put('expenses', { id, roomId: 'r1' });
  await store.put('expenses', { id: 'r1-zz', roomId: 'r1', title: '고침', note: undefined });
  const list = await store.list('expenses', { roomId: 'r1' });
  assert.deepEqual(list.map((e) => e.id), ['r1-zz', 'r1-aa', 'r1-mm']);
  assert.deepEqual(list[0], { id: 'r1-zz', roomId: 'r1', title: '고침' });
  await store.put('rooms', { id: 'r1', members: [{ uid: 'a' }, { uid: 'gone', deleted: true }] });
  assert.deepEqual(await store.get('rooms', 'r1'), { id: 'r1', members: [{ uid: 'a' }, { uid: 'gone', deleted: true }] });
  assert.deepEqual((await store.db.collection('rooms').doc('r1').get()).get('_memberUids'), ['a']);
  await assert.rejects(store.put('rooms', { id: 'a/b' }), /쓸 수 없는 id/);
});

// #55 방에서 나간 사람: 멤버 색인(_memberUids)에서 빠져 규칙상 못 읽고 내 방 목록에도 없지만,
// 나간 사람 색인(_leftUids)으로 찾을 수 있어 그 사람이 탈퇴하면 나간 방의 기록도 익명으로 바뀐다
test('나간 사람은 멤버 색인에서 빠지고, 탈퇴하면 나간 방도 익명으로 바뀐다', { skip }, async () => {
  const { emulatorStore } = await load();
  const store = emulatorStore();
  await store.put('rooms', { id: 'left-room', members: [{ uid: 'a', name: '가' }, { uid: 'leaver', name: '나간 사람', left: true }] });
  await store.put('expenses', { id: 'left-room-e', roomId: 'left-room', title: '저녁', payer: 'leaver', present: ['a', 'leaver'], amount: 1000 });
  const doc = (await store.db.collection('rooms').doc('left-room').get());
  assert.deepEqual(doc.get('_memberUids'), ['a']);
  assert.deepEqual(doc.get('_leftUids'), ['leaver']);
  assert.ok(!('_leftUids' in await store.get('rooms', 'left-room')), '숨은 칸은 밖으로 안 나온다');
  assert.deepEqual((await store.roomsOf('leaver')).map((r) => r.id), []);
  await store.eraseUser('leaver');
  const room = await store.get('rooms', 'left-room');
  assert.ok(!JSON.stringify(room).includes('leaver') && !JSON.stringify(room).includes('나간 사람'));
  assert.equal((await store.get('expenses', 'left-room-e')).title, '탈퇴한 사용자의 지출');
});

test('영수증 사진은 문서 한도(1MiB)보다 커도 Cloud Storage에 저장·조회·삭제된다', { skip }, async () => {
  const { emulatorStore } = await load();
  const store = emulatorStore();
  const data = Buffer.alloc(1_500_000, 7).toString('base64'); // 화면이 보낼 수 있는 최대(본문 2.1MB)에 가까운 크기
  await store.put('receipts', { id: 'r1-big', roomId: 'r1', mimeType: 'image/jpeg', data });
  assert.deepEqual(await store.get('receipts', 'r1-big'), { id: 'r1-big', roomId: 'r1', mimeType: 'image/jpeg', data });
  await store.delete('receipts', 'r1-big');
  assert.equal(await store.get('receipts', 'r1-big'), null);
  await store.delete('receipts', 'r1-big');
  // 요청에서 온 이상한 id는 다른 문서처럼 '없음'
  assert.equal(await store.get('receipts', 'a/b'), null);
  await store.delete('receipts', 'a/b');
});

test('eraseUser: 메모리 구현과 같은 결과를 한 트랜잭션으로(금액 유지, 개인정보·사진·링크 삭제, 다시 불러도 같음)', { skip }, async () => {
  const { emulatorStore, seedDemoRoom, encryptedStore, ledger } = await load();
  const store = encryptedStore(emulatorStore(), KEY);
  await seedDemoRoom(store, { id: 'one' });
  await seedDemoRoom(store, { id: 'two' });
  await store.put('rooms', { id: 'other', name: '남의 방', members: [{ uid: 'cs', name: '철수' }], version: 1 });
  await store.put('users', { id: 'me', name: 'Alice', color: '#112233' });
  await store.put('locationEvidence', { id: 'loc', roomId: 'one', uid: 'me', summary: 'PRIVATE LOCATION' });
  await store.put('locationConsents', { id: 'consent', roomId: 'one', uid: 'me' });
  const expenses = await store.list('expenses', { roomId: 'one' });
  const before = ledger(await store.get('rooms', 'one'), expenses, 'actual');
  const owned = expenses.find((e) => e.payer === 'me');
  const otherOwned = expenses.find((e) => e.payer === 'cs');
  await store.put('receipts', { id: owned.id, roomId: 'one', mimeType: 'image/jpeg', data: 'UFJJVkFURQ==' });
  await store.put('receipts', { id: otherOwned.id, roomId: 'one', mimeType: 'image/jpeg', data: 'S0VFUA==' });
  await store.put('transfers', { id: 'one:v1:t1', roomId: 'one', from: 'me', to: 'cs', amount: 100, link: 'supertoss://mine', fallback: { accountNo: '123' } });
  await store.put('transfers', { id: 'one:v1:t2', roomId: 'one', from: 'ms', to: 'cs', amount: 200, link: 'supertoss://theirs', fallback: { accountNo: '456' } });
  await store.put('disputes', { id: 'd', roomId: 'one', by: 'me', status: 'proposed', claim: 'PRIVATE CLAIM', evidence: [{ locationId: 'loc', summary: 'PRIVATE LOCATION' }], proposal: { summary: 'PRIVATE CLAIM' }, agreedBy: ['me'] });
  await store.appendEvent('one', { from: 'me', to: 'all', kind: 'dispute', text: 'PRIVATE LOCATION', meta: 'Alice' });
  await store.appendEvent('unrelated', { from: 'other', to: 'all', kind: 'x', text: 'keep me' });

  const { removedLinks } = await store.eraseUser('me');
  assert.deepEqual(removedLinks, ['supertoss://mine']);
  const room = await store.get('rooms', 'one');
  const gone = room.members.find((m) => m.deleted);
  assert.ok(gone.uid.startsWith('deleted-'));
  assert.notEqual(gone.uid, (await store.get('rooms', 'two')).members.find((m) => m.deleted).uid);
  const after = ledger(room, await store.list('expenses', { roomId: 'one' }), 'actual');
  assert.deepEqual(after[gone.uid], before.me);
  for (const uid of ['cs', 'yh', 'ms']) assert.deepEqual(after[uid], before[uid]);
  assert.equal(await store.get('users', 'me'), null);
  assert.equal(await store.get('agents', 'me'), null);
  assert.ok(await store.get('agents', 'cs'));
  assert.equal(await store.get('receipts', owned.id), null);
  assert.equal((await store.get('receipts', otherOwned.id)).data, 'S0VFUA==');
  assert.deepEqual(await store.list('locationEvidence', { uid: 'me' }), []);
  assert.deepEqual(await store.list('locationConsents', { uid: 'me' }), []);
  const transfers = await store.list('transfers', { roomId: 'one' });
  assert.deepEqual(transfers.map((t) => [t.from, t.amount, t.link]), [[gone.uid, 100, null], ['ms', 200, 'supertoss://theirs']]);
  assert.equal(transfers[1].fallback.accountNo, '456');
  assert.equal((await store.get('disputes', 'd')).proposal, undefined);
  const events = await store.listEvents('one');
  assert.ok(!JSON.stringify(events).includes('PRIVATE') && !JSON.stringify(events).includes('Alice'));
  assert.equal(events.at(-1).kind, 'account_erased');
  assert.equal((await store.appendEvent('one', { from: 'system', to: 'all', kind: 'x', text: 'next' })).seq, events.at(-1).seq + 1);
  assert.equal((await store.listEvents('unrelated'))[0].text, 'keep me');
  assert.deepEqual((await store.get('rooms', 'other')).members, [{ uid: 'cs', name: '철수' }]);
  assert.ok(!(await store.list('rooms')).some((r) => r.members.some((m) => m.uid === 'me')));

  const snapshot = async () => JSON.stringify(await Promise.all(['rooms', 'expenses', 'invoices', 'disputes', 'transfers', 'agents'].map((c) => store.list(c))));
  const once = await snapshot();
  await store.eraseUser('me');
  assert.equal(await snapshot(), once);
});

test('보안 규칙: 멤버만 방·기록을 읽고, 송금은 당사자만, 이의는 아무도 직접 못 읽고, 쓰기는 누구도 못 한다', { skip }, async () => {
  const fs = await import('node:fs');
  const { emulatorStore, mockIdToken, PROJECT } = await load();
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const store = emulatorStore({}, '(default)');
  const rules = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT',
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }] } }),
  });
  assert.equal(rules.status, 200);
  await store.put('rooms', { id: 'rr', members: [{ uid: 'a' }, { uid: 'b' }, { uid: 'gone', deleted: true }] });
  await store.put('expenses', { id: 'rr-e', roomId: 'rr', amount: 1 });
  await store.put('disputes', { id: 'rr-d', roomId: 'rr', expenseId: 'rr-e', by: 'a', evidence: [{ kind: 'text', summary: '체크아웃 · 지정 장소 밖', locationId: 'loc' }] });
  await store.put('transfers', { id: 'rr:t', roomId: 'rr', from: 'a', to: 'c', amount: 1 });
  await store.put('agents', { id: 'a', uid: 'a', memory: [] });
  await store.put('users', { id: 'a', name: 'A' });
  await store.appendEvent('rr', { from: 'system', to: 'all', kind: 'x', text: 'hi' });

  const docs = `http://${host}/v1/projects/${PROJECT}/databases/(default)/documents`;
  const read = async (path, uid) => (await fetch(`${docs}/${path}`, { headers: uid ? { authorization: `Bearer ${mockIdToken(uid)}` } : {} })).status;
  const write = async (path, uid) => (await fetch(`${docs}/${path}`, { method: 'PATCH', headers: { authorization: `Bearer ${mockIdToken(uid)}`, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { amount: { integerValue: '999' } } }) })).status;

  for (const path of ['rooms/rr', 'rooms/rr/events/1', 'expenses/rr-e']) {
    assert.equal(await read(path, 'a'), 200, `멤버 a: ${path}`);
    assert.equal(await read(path, 'x'), 403, `비멤버 x: ${path}`);
    assert.equal(await read(path, 'gone'), 403, `탈퇴 처리된 멤버: ${path}`);
    assert.equal(await read(path, null), 403, `비로그인: ${path}`);
  }
  assert.equal(await read('transfers/rr:t', 'a'), 200);
  assert.equal(await read('transfers/rr:t', 'b'), 403);
  assert.equal(await read('users/a', 'a'), 200);
  assert.equal(await read('users/a', 'b'), 403);
  assert.equal(await read('agents/a', 'a'), 403);
  // 위치 요약은 API(redactDispute)로만 가려서 내려가므로 이의 당사자도 직접은 못 읽는다(#7)
  assert.equal(await read('disputes/rr-d', 'b'), 403);
  assert.equal(await read('disputes/rr-d', 'a'), 403);
  assert.equal(await read('rooms/rr/meta/events', 'a'), 403);
  for (const path of ['expenses/rr-e', 'rooms/rr', 'rooms/rr/events/2', 'invoices/new', 'users/a']) assert.equal(await write(path, 'a'), 403, `쓰기 ${path}`);
  assert.equal((await store.get('expenses', 'rr-e')).amount, 1);
});

test('서버 계산이 Firestore 위에서도 맞다: 몫의 합 = 결제액, 차액의 합 = 0, 송금하면 잔액 0', { skip }, async () => {
  const { emulatorStore, encryptedStore, createApp, settle } = await load();
  const store = encryptedStore(emulatorStore(), KEY);
  const server = createApp({ store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const call = async (path, uid, body) => (await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'x-demo-user': uid, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })).json();
    const { roomId } = await call('/api/dev/seed', 'me', {});
    const data = await call(`/api/rooms/${roomId}`, 'me');
    const rows = Object.values(data.ledger);
    assert.equal(rows.reduce((s, r) => s + r.paid, 0), rows.reduce((s, r) => s + r.owed, 0));
    assert.equal(rows.reduce((s, r) => s + r.net, 0), 0);
    const balance = structuredClone(data.ledger);
    for (const t of settle(data.ledger)) { balance[t.from].net += t.amount; balance[t.to].net -= t.amount; }
    assert.ok(Object.values(balance).every((r) => r.net === 0));
    // 다른 멤버 화면에서도 같은 방·같은 계산
    assert.deepEqual((await call(`/api/rooms/${roomId}`, 'cs')).ledger, data.ledger);
    assert.deepEqual((await call(`/api/rooms/${roomId}/events`, 'cs')).events.map((e) => e.kind), ['room_created']);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

// #7 위치 근거 흐름이 Firestore에서도 같게: 두 조건 조회(uid·roomId), 이의에 붙이기, 청구서 표시, 7일 뒤 방을 열 때 정리(purge)
test('위치 요약: 붙이기 → 이의·청구서 → 7일 뒤 방을 열면 Firestore에서도 지워진다', { skip }, async (t) => {
  const { emulatorStore, seedDemoRoom, encryptedStore, createApp } = await load();
  const { expenseWindow } = await import('../public/timeline.js');
  const store = encryptedStore(emulatorStore(), KEY);
  await seedDemoRoom(store, { id: 'room-one' });
  const exp = (await store.list('expenses', { roomId: 'room-one' })).find((e) => e.items?.length);
  await store.put('expenses', { ...exp, date: '2026-11-01' });
  let now = new Date('2026-11-01T12:00:00Z');
  const auth = { verifyIdToken: async (uid) => ({ uid, name: '테스트 사용자', auth_time: now.getTime() / 1000 }) };
  const server = createApp({ store, auth, clock: () => now });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer me' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const kst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
  const { until } = expenseWindow({ ...exp, date: '2026-11-01' });

  assert.equal((await call('/api/rooms/room-one/location/timeline', { agree: true, expenseId: exp.id, leftAt: kst(until - 30 * 60000), nextAt: kst(until - 17 * 60000), nextHome: false })).status, 200);
  assert.equal((await store.list('locationEvidence', { uid: 'me', roomId: 'room-one' })).length, 1);
  assert.equal((await call('/api/rooms/room-one/disputes', { expenseId: exp.id, claim: '참석 근거를 확인해 주세요' })).status, 200);
  assert.equal((await store.list('disputes', { roomId: 'room-one' }))[0].evidence.length, 1);
  assert.equal((await call('/api/rooms/room-one/invoices/send', {})).status, 200);
  const mine = (await store.list('invoices', { roomId: 'room-one' })).find((i) => i.to === 'me');
  assert.equal(mine.hasLocationSummary, true);

  now = new Date(now.getTime() + 7 * 86400000 + 1000);
  assert.equal((await call('/api/rooms/room-one')).status, 200);
  assert.deepEqual(await store.list('locationEvidence', { uid: 'me', roomId: 'room-one' }), []);
  assert.deepEqual(await store.list('locationConsents', { roomId: 'room-one' }), []);
  assert.deepEqual((await store.list('disputes', { roomId: 'room-one' }))[0].evidence, []);
  assert.equal((await store.get('invoices', mine.id)).hasLocationSummary, false);
  assert.equal((await store.listEvents('room-one')).at(-1).kind, 'location_removed');
});
