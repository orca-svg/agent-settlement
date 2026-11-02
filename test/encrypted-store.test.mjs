// 계좌 칸만 잠그는 Store 래퍼(#8, #10): 진짜 저장소에는 잠긴 글자만, 래퍼로 꺼내면 평문.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { encryptedStore } from '../src/store/encrypted.mjs';
import { isSealed } from '../src/security/seal.mjs';

const KEY = Buffer.alloc(32, 3);
const PAYOUT = { bank: '토스뱅크', accountNo: '100000000002', holder: '철수' };
const LINK = 'supertoss://send?bank=%ED%86%A0%EC%8A%A4%EB%B1%85%ED%81%AC&accountNo=100000000002&amount=1000&origin=linkgen';
const FALLBACK = { bank: '토스뱅크', accountNo: '100000000002', amount: 1000 };

// inner: 진짜 저장소(직접 들여다보는 용도), store: 래퍼
const make = () => {
  const inner = new MemoryStore();
  return { inner, store: encryptedStore(inner, KEY) };
};

test('agents.payout: 진짜 저장소에는 잠긴 글자, 래퍼로 꺼내면 평문', async () => {
  const { inner, store } = make();
  const doc = { id: 'cs', uid: 'cs', memory: ['하이볼'], rules: { autoAccept: 1 }, payout: PAYOUT };
  assert.deepEqual(await store.put('agents', doc), doc);
  const raw = await inner.get('agents', 'cs');
  assert.ok(isSealed(raw.payout));
  assert.ok(!JSON.stringify(raw).includes('100000000002'));
  assert.deepEqual(raw.memory, ['하이볼']); // 다른 칸은 그대로
  assert.deepEqual(await store.get('agents', 'cs'), doc);
});

test('transfers.link·fallback: 잠그고, get·list 모두 풀어서 돌려준다', async () => {
  const { inner, store } = make();
  const t = { id: 'r1:v1:t1', roomId: 'r1', from: 'ms', to: 'cs', amount: 1000, status: 'due', link: LINK, fallback: FALLBACK, qrToken: 'tok' };
  await store.put('transfers', t);
  const raw = await inner.get('transfers', t.id);
  assert.ok(isSealed(raw.link) && isSealed(raw.fallback));
  assert.equal(raw.qrToken, 'tok');
  assert.equal(raw.amount, 1000);
  assert.ok(!JSON.stringify(raw).includes('100000000002'));
  assert.deepEqual(await store.get('transfers', t.id), t);
  assert.deepEqual(await store.list('transfers', { roomId: 'r1' }), [t]);
});

test('null·없는 칸은 잠그지 않고 그대로', async () => {
  const { inner, store } = make();
  await store.put('agents', { id: 'yh', uid: 'yh', payout: null });
  await store.put('transfers', { id: 't2', roomId: 'r1', link: null, fallback: null });
  await store.put('agents', { id: 'ms', uid: 'ms' });
  assert.equal((await inner.get('agents', 'yh')).payout, null);
  assert.equal((await store.get('agents', 'yh')).payout, null);
  assert.deepEqual(await store.get('transfers', 't2'), { id: 't2', roomId: 'r1', link: null, fallback: null });
  assert.deepEqual(await store.get('agents', 'ms'), { id: 'ms', uid: 'ms' });
});

test('없는 문서는 null, 다른 컬렉션은 손대지 않는다', async () => {
  const { inner, store } = make();
  assert.equal(await store.get('agents', 'nope'), null);
  await store.put('rooms', { id: 'r1', name: '오사카', link: 'not-a-secret' });
  assert.deepEqual(await inner.get('rooms', 'r1'), { id: 'r1', name: '오사카', link: 'not-a-secret' });
});

test('진짜 저장소에 평문 계좌를 몰래 넣으면 꺼낼 때 에러', async () => {
  const { inner, store } = make();
  await inner.put('agents', { id: 'cs', uid: 'cs', payout: { bank: '나쁜은행', accountNo: '999999999999', holder: '?' } });
  await assert.rejects(store.get('agents', 'cs'), /잠기지 않은 값/);
  await inner.put('transfers', { id: 't3', roomId: 'r1', link: 'supertoss://send?accountNo=999999999999', fallback: null });
  await assert.rejects(store.list('transfers', { roomId: 'r1' }), /잠기지 않은 값/);
});

test('다른 문서의 잠긴 값을 복사해 붙이면 풀리지 않는다', async () => {
  const { inner, store } = make();
  await store.put('agents', { id: 'ms', uid: 'ms', payout: { bank: '토스뱅크', accountNo: '100000000004', holder: '민수' } });
  await store.put('agents', { id: 'cs', uid: 'cs', payout: PAYOUT });
  const stolen = (await inner.get('agents', 'ms')).payout;
  await inner.put('agents', { ...(await inner.get('agents', 'cs')), payout: stolen });
  await assert.rejects(store.get('agents', 'cs'), /풀 수 없어요/);
});

test('잠긴 칸으로는 list 검색을 할 수 없다', async () => {
  const { store } = make();
  await assert.rejects(store.list('transfers', { link: LINK }), /잠긴 칸/);
  await assert.rejects(store.list('agents', { payout: null }), /잠긴 칸/);
});

test('delete와 비서 기록(appendEvent·listEvents)은 그대로 위임', async () => {
  const { store } = make();
  await store.put('agents', { id: 'cs', uid: 'cs', payout: PAYOUT });
  await store.delete('agents', 'cs');
  assert.equal(await store.get('agents', 'cs'), null);
  const ev = await store.appendEvent('r1', { from: 'system', to: 'all', kind: 'x', text: 'a' });
  assert.equal(ev.seq, 1);
  assert.deepEqual((await store.listEvents('r1')).map((e) => e.text), ['a']);
});

// #2 탈퇴(eraseUser): 팀원 브랜치의 MemoryStore처럼 진짜 저장소에 붙어 있으면 전달한다
test('진짜 저장소에 eraseUser가 있으면 전달하고, 지운 링크는 평문으로 돌려준다', async () => {
  const inner = new MemoryStore();
  const calls = [];
  let rawRemoved = [];
  inner.eraseUser = async (uid) => {
    calls.push(uid);
    const mine = (await inner.list('transfers')).filter((t) => t.from === uid || t.to === uid);
    rawRemoved = mine.map((t) => t.link);
    for (const t of mine) await inner.put('transfers', { ...t, link: null, fallback: null });
    return { removedLinks: rawRemoved }; // 진짜 저장소는 잠긴 글자를 돌려준다
  };
  const store = encryptedStore(inner, KEY);
  const other = 'supertoss://send?bank=x&accountNo=100000000001&amount=500&origin=linkgen';
  await store.put('transfers', { id: 't1', roomId: 'r1', from: 'ms', to: 'cs', link: LINK, fallback: FALLBACK });
  await store.put('transfers', { id: 't2', roomId: 'r1', from: 'yh', to: 'me', link: other, fallback: null });

  const { removedLinks } = await store.eraseUser('cs');
  assert.deepEqual(calls, ['cs']);
  assert.ok(rawRemoved.every(isSealed));
  assert.deepEqual(removedLinks, [LINK]);
  assert.equal((await store.get('transfers', 't1')).link, null);
  assert.equal((await store.get('transfers', 't2')).link, other);
});

test('진짜 저장소에 eraseUser가 없으면 래퍼에도 없다(탈퇴 API가 503으로 알림)', () => {
  const { store } = make();
  assert.equal(typeof store.eraseUser, 'undefined');
});
