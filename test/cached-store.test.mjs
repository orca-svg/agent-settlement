// 읽기 캐시(src/store/cached.mjs). 쓰기는 모두 이 서버만 하고(firestore.rules) 인스턴스는 하나라서(--max-instances 1),
// 한 번 읽은 문서·목록은 메모리에서 돌려주고 Firestore에는 쓰기와 처음 읽기만 간다. Store 계약은 test/store.test.mjs가 같이 돌린다.
// 진짜 저장소 자리에는 MemoryStore를 두고, 읽기가 거기까지 몇 번 가는지 센다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { cachedStore } from '../src/store/cached.mjs';

const READS = ['get', 'list', 'roomsOf', 'listEvents'];
const WRITES = ['put', 'putIfAbsent', 'delete', 'appendEvent', 'eraseUser'];

// 읽기 메서드가 불릴 때마다 [이름, ...인자]를 남기는 저장소
function counted(inner = new MemoryStore()) {
  const reads = [];
  const store = {};
  for (const m of READS) store[m] = async (...args) => { reads.push([m, ...args]); return inner[m](...args); };
  for (const m of WRITES) store[m] = (...args) => inner[m](...args);
  return { inner, store, reads };
}

test('같은 문서·목록·내 방 목록을 다시 읽으면 진짜 저장소에 묻지 않는다(없는 문서도)', async () => {
  const { inner, store: base, reads } = counted();
  await inner.put('rooms', { id: 'r1', members: [{ uid: 'me' }] });
  const store = cachedStore(base, { now: () => 0 });
  for (let i = 0; i < 2; i++) {
    assert.equal((await store.get('rooms', 'r1')).id, 'r1');
    assert.equal(await store.get('deletedUsers', 'me'), null);
    assert.deepEqual(await store.list('expenses', { roomId: 'r1' }), []);
    assert.deepEqual((await store.roomsOf('me')).map((r) => r.id), ['r1']);
  }
  assert.equal(reads.length, 4);
});

test('쓰고 나면 다음 읽기는 새 값을 본다(문서·목록·내 방 목록·지운 문서)', async () => {
  const store = cachedStore(new MemoryStore(), { now: () => 0 });
  await store.put('rooms', { id: 'r1', members: [{ uid: 'me' }] });
  await store.put('users', { id: 'gone', name: '떠날 사람' });
  assert.deepEqual((await store.get('rooms', 'r1')).members, [{ uid: 'me' }]);
  assert.deepEqual(await store.list('expenses', { roomId: 'r1' }), []);
  assert.deepEqual(await store.roomsOf('cs'), []);
  assert.equal((await store.get('users', 'gone')).name, '떠날 사람');

  await store.put('rooms', { id: 'r1', members: [{ uid: 'me' }, { uid: 'cs' }] });
  await store.put('expenses', { id: 'e1', roomId: 'r1' });
  await store.delete('users', 'gone');
  assert.deepEqual((await store.get('rooms', 'r1')).members, [{ uid: 'me' }, { uid: 'cs' }]);
  assert.deepEqual((await store.list('expenses', { roomId: 'r1' })).map((e) => e.id), ['e1']);
  assert.deepEqual((await store.roomsOf('cs')).map((r) => r.id), ['r1']);
  assert.equal(await store.get('users', 'gone'), null);
});

test('putIfAbsent로 넣은 문서도 다음 읽기에 보인다', async () => {
  const store = cachedStore(new MemoryStore(), { now: () => 0 });
  assert.equal(await store.get('users', 'me'), null);
  await store.putIfAbsent('users', { id: 'me', color: '#123456' });
  assert.equal((await store.get('users', 'me')).color, '#123456');
});

test('돌려받은 문서를 고쳐도 캐시된 값은 그대로다', async () => {
  const store = cachedStore(new MemoryStore(), { now: () => 0 });
  await store.put('rooms', { id: 'r1', members: [{ uid: 'me' }] });
  // 처음 읽은 것(진짜 저장소에서 온 것)과 두 번째 읽은 것(캐시에서 온 것)을 모두 고쳐 본다
  for (let i = 0; i < 2; i++) {
    (await store.get('rooms', 'r1')).members.push({ uid: 'intruder' });
    (await store.list('rooms'))[0].members.push({ uid: 'intruder' });
  }
  assert.deepEqual((await store.get('rooms', 'r1')).members, [{ uid: 'me' }]);
  assert.deepEqual((await store.list('rooms'))[0].members, [{ uid: 'me' }]);
});

test('읽는 사이에 쓰기가 끝나면, 늦게 도착한 옛 값으로 캐시를 덮지 않는다', async () => {
  const inner = new MemoryStore();
  await inner.put('rooms', { id: 'r1', name: '옛 이름' });
  let entered;
  let release;
  const inGet = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  let hold = true;
  const base = counted(inner).store;
  base.get = async (col, id) => {
    const doc = await inner.get(col, id);
    if (hold) { hold = false; entered(); await gate; }
    return doc;
  };
  const store = cachedStore(base, { now: () => 0 });
  const slow = store.get('rooms', 'r1');
  await inGet; // 옛 값을 읽어 둔 채 멈춰 있다
  await store.put('rooms', { id: 'r1', name: '새 이름' });
  release();
  assert.equal((await slow).name, '옛 이름'); // 그 요청 자체는 옛 값을 받을 수 있다(캐시가 없어도 같다)
  assert.equal((await store.get('rooms', 'r1')).name, '새 이름');
});

test('여러 요청이 동시에 같은 것을 읽으면 진짜 저장소에는 한 번만 묻는다', async () => {
  const { inner, store: base, reads } = counted();
  await inner.put('rooms', { id: 'r1', name: '오사카' });
  const store = cachedStore(base, { now: () => 0 });
  const rooms = await Promise.all(Array.from({ length: 5 }, () => store.get('rooms', 'r1')));
  assert.deepEqual(rooms.map((r) => r.name), ['오사카', '오사카', '오사카', '오사카', '오사카']);
  assert.equal(reads.length, 1);
});

test('60초가 지나면 진짜 저장소에서 다시 읽는다(배포 중 겹친 인스턴스나 콘솔에서 바꾼 값을 따라잡게)', async () => {
  const inner = new MemoryStore();
  let now = 0;
  const store = cachedStore(inner, { now: () => now });
  await inner.put('rooms', { id: 'r1', name: 'A' });
  assert.equal((await store.get('rooms', 'r1')).name, 'A');
  await inner.put('rooms', { id: 'r1', name: 'B' }); // 캐시를 거치지 않은 쓰기
  now = 59_999;
  assert.equal((await store.get('rooms', 'r1')).name, 'A');
  now = 60_000;
  assert.equal((await store.get('rooms', 'r1')).name, 'B');
});

test('비서 기록: 처음부터 읽은 방은 이후 조회를 메모리에서 하고, 새로 붙인 기록도 바로 보인다', async () => {
  const { store: base, reads } = counted(new MemoryStore({ now: () => new Date('2026-11-10T00:00:00Z') }));
  const store = cachedStore(base, { now: () => 0 });
  await store.appendEvent('r1', { kind: 'a' });
  assert.deepEqual((await store.listEvents('r1')).map((e) => e.seq), [1]);
  await store.appendEvent('r1', { kind: 'b' });
  assert.deepEqual((await store.listEvents('r1', 1)).map((e) => e.kind), ['b']);
  assert.deepEqual((await store.listEvents('r1')).map((e) => e.kind), ['a', 'b']);
  assert.equal(reads.filter(([m]) => m === 'listEvents').length, 1);
});

test('탈퇴(eraseUser) 뒤에는 그 사람의 프로필·방을 진짜 저장소에서 다시 읽는다', async () => {
  const store = cachedStore(new MemoryStore(), { now: () => 0 });
  await store.put('users', { id: 'me', name: '나' });
  await store.put('rooms', { id: 'r1', members: [{ uid: 'me', name: '나' }, { uid: 'cs', name: '철수' }] });
  assert.equal((await store.get('users', 'me')).name, '나');
  assert.deepEqual((await store.roomsOf('me')).map((r) => r.id), ['r1']);
  await store.eraseUser('me');
  assert.equal(await store.get('users', 'me'), null);
  assert.deepEqual(await store.roomsOf('me'), []);
  assert.equal((await store.get('rooms', 'r1')).members.some((m) => m.deleted), true);
});

test('진짜 저장소에 탈퇴 기능이 없으면 캐시도 내보이지 않는다(탈퇴 API가 503으로 알리게)', () => {
  const inner = counted().store;
  delete inner.eraseUser;
  assert.equal(typeof cachedStore(inner).eraseUser, 'undefined');
});

test('영수증 사진은 메모리에 남기지 않는다(장당 수 MB)', async () => {
  const { store: base, reads } = counted();
  const store = cachedStore(base, { now: () => 0 });
  await store.put('receipts', { id: 'e1', roomId: 'r1', mimeType: 'image/jpeg', data: 'AAAA' });
  assert.equal((await store.get('receipts', 'e1')).data, 'AAAA');
  assert.equal((await store.get('receipts', 'e1')).data, 'AAAA');
  assert.equal(reads.length, 2);
});
