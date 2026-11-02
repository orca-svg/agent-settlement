// Store 계약: MemoryStore와 이후의 FirestoreStore(#3)가 똑같이 지켜야 하는 동작.
// 계좌 칸을 잠그는 래퍼(encryptedStore, #8·#10)도 같은 계약을 지켜야 하므로 두 구현에 똑같이 돌린다.
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
}
