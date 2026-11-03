// Store 계약: MemoryStore와 이후의 FirestoreStore(#3)가 똑같이 지켜야 하는 동작.
// 계좌·위치 요약 칸을 잠그는 래퍼(encryptedStore, #8·#10)도 같은 계약을 지켜야 하므로 두 구현에 똑같이 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { encryptedStore } from '../src/store/encrypted.mjs';

const fixedNow = () => new Date('2026-11-10T00:00:00Z');
const KEY = Buffer.alloc(32, 5);
const IMPLS = [
  ['MemoryStore', (opts) => new MemoryStore(opts)],
  ['encryptedStore', (opts) => encryptedStore(new MemoryStore(opts), KEY)],
];
// FirestoreStore(#3)는 에뮬레이터가 있을 때만 같은 계약을 돌린다(docs/firestore-setup.md). 테스트마다 빈 데이터베이스를 쓴다
if (process.env.FIRESTORE_EMULATOR_HOST) {
  const { emulatorStore } = await import('./helpers/firestore-emulator.mjs');
  IMPLS.push(['FirestoreStore', (opts) => emulatorStore(opts)], ['encryptedStore(FirestoreStore)', (opts) => encryptedStore(emulatorStore(opts), KEY)]);
}

for (const [name, make] of IMPLS) {
  test(`[${name}] put 후 get이 같은 문서`, async () => {
    const store = make();
    await store.put('rooms', { id: 'r1', name: '오사카' });
    assert.deepEqual(await store.get('rooms', 'r1'), { id: 'r1', name: '오사카' });
    assert.equal(await store.get('rooms', 'nope'), null);
  });

  test(`[${name}] list(where)가 동등 필터`, async () => {
    const store = make();
    await store.put('expenses', { id: 'e1', roomId: 'r1', payer: 'me' });
    await store.put('expenses', { id: 'e2', roomId: 'r1', payer: 'cs' });
    await store.put('expenses', { id: 'e3', roomId: 'r2', payer: 'me' });
    assert.deepEqual((await store.list('expenses', { roomId: 'r1' })).map((d) => d.id), ['e1', 'e2']);
    assert.deepEqual((await store.list('expenses', { roomId: 'r1', payer: 'me' })).map((d) => d.id), ['e1']);
    assert.equal((await store.list('expenses')).length, 3);
    assert.deepEqual(await store.list('transfers', { roomId: 'r1' }), []);
  });

  test(`[${name}] appendEvent의 seq는 방마다 1부터`, async () => {
    const store = make({ now: fixedNow });
    const a = await store.appendEvent('r1', { from: 'system', to: 'all', kind: 'x', text: 'a' });
    const b = await store.appendEvent('r1', { from: 'system', to: 'all', kind: 'x', text: 'b' });
    const c = await store.appendEvent('r2', { from: 'system', to: 'all', kind: 'x', text: 'c' });
    assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 1]);
    assert.equal(a.roomId, 'r1');
    assert.equal(a.at, '2026-11-10T00:00:00.000Z');
  });

  test(`[${name}] listEvents(after)는 이후 것만`, async () => {
    const store = make();
    for (const text of ['a', 'b', 'c']) await store.appendEvent('r1', { from: 'system', to: 'all', kind: 'x', text });
    assert.deepEqual((await store.listEvents('r1', 1)).map((e) => e.text), ['b', 'c']);
    assert.deepEqual((await store.listEvents('r1')).map((e) => e.seq), [1, 2, 3]);
    assert.deepEqual(await store.listEvents('r9'), []);
  });

  test(`[${name}] get이 돌려준 문서를 고쳐도 저장본은 안 바뀐다(복사본 반환)`, async () => {
    const store = make();
    const doc = { id: 'r1', members: [{ uid: 'me' }] };
    await store.put('rooms', doc);
    doc.members.push({ uid: 'late' });
    const got = await store.get('rooms', 'r1');
    got.members.push({ uid: 'x' });
    assert.deepEqual((await store.get('rooms', 'r1')).members, [{ uid: 'me' }]);
    const listed = await store.list('rooms');
    listed[0].name = '바뀜';
    assert.equal((await store.get('rooms', 'r1')).name, undefined);
  });

  test(`[${name}] delete는 문서를 지우고, 없는 문서를 지워도 오류가 아니다`, async () => {
    const store = make();
    await store.put('rooms', { id: 'r1' });
    await store.delete('rooms', 'r1');
    assert.equal(await store.get('rooms', 'r1'), null);
    await store.delete('rooms', 'nope');
  });

  // 내 방 목록·프로필 변경이 서비스의 모든 방을 읽지 않게(#3)
  test(`[${name}] roomsOf(uid)는 그 사람이 탈퇴하지 않은 멤버인 방만, 처음 넣은 순서로`, async () => {
    const store = make();
    await store.put('rooms', { id: 'r2', members: [{ uid: 'a' }, { uid: 'b' }] });
    await store.put('rooms', { id: 'r1', members: [{ uid: 'b' }] });
    await store.put('rooms', { id: 'r3', members: [{ uid: 'a', deleted: true }] });
    await store.put('rooms', { id: 'r4', name: '둘째', members: [{ uid: 'a' }] });
    assert.deepEqual((await store.roomsOf('a')).map((r) => r.id), ['r2', 'r4']);
    assert.deepEqual((await store.roomsOf('a'))[1], await store.get('rooms', 'r4'));
    assert.deepEqual(await store.roomsOf('nobody'), []);
  });

  // 처음 들어온 사람의 프로필처럼 '없을 때만 만들기'가 동시에 와도 하나만 남게
  test(`[${name}] putIfAbsent는 없을 때만 넣고, 있으면 있던 문서를 돌려준다`, async () => {
    const store = make();
    const results = await Promise.all(['#111111', '#222222', '#333333'].map((color) => store.putIfAbsent('users', { id: 'u', color })));
    const saved = await store.get('users', 'u');
    assert.ok(results.every((r) => r.color === saved.color), JSON.stringify(results));
    assert.deepEqual(await store.putIfAbsent('users', { id: 'u', color: '#444444' }), saved);
  });

  // 요청에서 온 id가 이상해도 '없음'으로 다룬다(넣을 수 없는 id로는 문서가 있을 수 없다). 넣기만 거부한다
  test(`[${name}] 넣을 수 없는 id로 get·delete·listEvents하면 없음으로 다룬다`, async () => {
    const store = make();
    for (const id of [undefined, 123, 'a/b', '__x__', '..']) {
      assert.equal(await store.get('expenses', id), null, String(id));
      await store.delete('expenses', id);
      assert.deepEqual(await store.listEvents(id), [], String(id));
    }
  });
}
