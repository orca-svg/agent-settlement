// 계좌 칸만 잠그는 Store 래퍼(#8, #10): 진짜 저장소에는 잠긴 글자만, 래퍼로 꺼내면 평문.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { encryptedStore } from '../src/store/encrypted.mjs';
import { isSealed } from '../src/security/seal.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { createApp } from '../src/app.mjs';

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

// #7 위치 근거(#10): 본인 제출 시각과 그것으로 만든 문장. 찾을 때 쓰는 uid·roomId는 잠그지 않는다
const LEFT = {
  id: 'loc-1', uid: 'me', roomId: 'r1', expenseId: 'e1', source: 'timeline_export', createdAt: '2026-11-01T12:00:00.000Z',
  leftAt: '20:15', nextAt: '20:28', nextHome: true,
  summary: '첫 주문(17:45) 때 머물던 곳을 20:15에 떠났어요 · 20:28 집에 도착 · Google 지도 타임라인(본인 제출)',
};

test('locationEvidence: 시각·요약 5칸은 잠기고, 찾는 데 쓰는 칸은 평문', async () => {
  const { inner, store } = make();
  const stay = {
    id: 'loc-2', uid: 'me', roomId: 'r1', expenseId: 'e2', source: 'timeline_export', createdAt: LEFT.createdAt,
    stayedUntil: '20:45', summary: '첫 주문(17:45)부터 결제(20:45)까지 같은 곳에 있었어요 · Google 지도 타임라인(본인 제출)',
  };
  await store.put('locationEvidence', LEFT);
  await store.put('locationEvidence', stay);
  const raw = await inner.get('locationEvidence', 'loc-1');
  for (const f of ['summary', 'leftAt', 'nextAt', 'nextHome']) assert.ok(isSealed(raw[f]), `${f}가 잠기지 않음`);
  assert.ok(isSealed((await inner.get('locationEvidence', 'loc-2')).stayedUntil));
  assert.deepEqual([raw.uid, raw.roomId, raw.expenseId, raw.source], ['me', 'r1', 'e1', 'timeline_export']);
  assert.doesNotMatch(JSON.stringify(await inner.list('locationEvidence')), /20:15|20:28|20:45|떠났어요|있었어요/);
  assert.deepEqual(await store.list('locationEvidence', { uid: 'me', roomId: 'r1' }), [LEFT, stay]);
});

test('locationEvidence: 도착 시각이 없으면 null 그대로, false도 잠갔다가 false로 푼다', async () => {
  const { inner, store } = make();
  const doc = { ...LEFT, nextAt: null, nextHome: false };
  await store.put('locationEvidence', doc);
  const raw = await inner.get('locationEvidence', doc.id);
  assert.equal(raw.nextAt, null);
  assert.ok(isSealed(raw.nextHome));
  assert.deepEqual(await store.get('locationEvidence', doc.id), doc);
});

test('locationEvidence: 잠긴 시각으로는 찾을 수 없다', async () => {
  const { store } = make();
  await assert.rejects(store.list('locationEvidence', { leftAt: '20:15' }), /잠긴 칸/);
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

test('넘긴 객체·돌려받은 계좌 객체를 고쳐도 저장본은 안 바뀐다(잠긴 칸도 복사본)', async () => {
  const { store } = make();
  const doc = { id: 'cs', uid: 'cs', payout: { ...PAYOUT } };
  await store.put('agents', doc);
  doc.payout.accountNo = '777';
  (await store.get('agents', 'cs')).payout.accountNo = '999';
  (await store.list('agents'))[0].payout.accountNo = '888';
  assert.equal((await store.get('agents', 'cs')).payout.accountNo, '100000000002');
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
  inner.eraseUser = async function (uid) {
    calls.push(uid);
    const mine = (await this.list('transfers')).filter((t) => t.from === uid || t.to === uid);
    rawRemoved = mine.map((t) => t.link);
    for (const t of mine) await this.put('transfers', { ...t, link: null, fallback: null });
    return { removedLinks: rawRemoved, anonymized: true }; // 진짜 저장소는 잠긴 글자를 돌려준다
  };
  const store = encryptedStore(inner, KEY);
  const other = 'supertoss://send?bank=x&accountNo=100000000001&amount=500&origin=linkgen';
  await store.put('transfers', { id: 't1', roomId: 'r1', from: 'ms', to: 'cs', link: LINK, fallback: FALLBACK });
  await store.put('transfers', { id: 't2', roomId: 'r1', from: 'yh', to: 'me', link: other, fallback: null });

  const result = await store.eraseUser('cs');
  assert.deepEqual(calls, ['cs']);
  assert.ok(rawRemoved.every((v) => isSealed(v)));
  assert.deepEqual(result, { removedLinks: [LINK], anonymized: true });
  assert.equal((await store.get('transfers', 't1')).link, null);
  assert.equal((await store.get('transfers', 't2')).link, other);
});

test('진짜 저장소에 eraseUser가 없으면 래퍼에도 없다(탈퇴 API가 503으로 알림)', () => {
  const inner = new MemoryStore();
  inner.eraseUser = undefined; // #2가 머지되면 MemoryStore에 생기므로, 없는 저장소를 직접 만든다
  assert.equal(typeof encryptedStore(inner, KEY).eraseUser, 'undefined');
});

test('탈퇴는 그 사람의 송금만 풀어 보고, 풀리지 않는 값이 있어도 막히지 않는다', async () => {
  const inner = new MemoryStore();
  inner.eraseUser = async function () {
    return { removedLinks: [] };
  };
  const store = encryptedStore(inner, KEY);
  await store.put('transfers', { id: 't1', roomId: 'r1', from: 'ms', to: 'cs', link: LINK, fallback: FALLBACK });
  // 다른 방의 손상된 송금(풀어 보지도 않아야 한다)과, 이 사람의 손상된 송금(건너뛴다)
  await inner.put('transfers', { id: 'x1', roomId: 'r2', from: 'yh', to: 'me', link: 'enc:v1:broken-broken-broken-broken-broken', fallback: null });
  await inner.put('transfers', { id: 't9', roomId: 'r1', from: 'cs', to: 'yh', link: 'enc:v1:broken-broken-broken-broken-broken', fallback: null });
  const { removedLinks } = await store.eraseUser('cs');
  assert.deepEqual(removedLinks, [LINK]);
});

test('진짜 저장소의 메서드를 래퍼도 모두 갖는다(새 메서드가 래퍼 뒤에서 사라지지 않게)', () => {
  const { store } = make();
  const methods = Object.getOwnPropertyNames(MemoryStore.prototype).filter((n) => n !== 'constructor');
  for (const m of methods) assert.equal(typeof store[m], 'function', `래퍼에 ${m}이 없어요`);
});

test('32바이트가 아닌 열쇠, id가 없는 문서는 바로 거부한다', async () => {
  assert.throws(() => encryptedStore(new MemoryStore(), Buffer.alloc(16)), /32바이트/);
  const { store } = make();
  await assert.rejects(store.put('agents', { uid: 'cs', payout: PAYOUT }), /id가 없는 문서/);
});

// ---------------------------------------------------------------- 통합: 데모 방 전체 흐름
const DEMO_ACCOUNTS = ['100000000001', '100000000002', '100000000003', '100000000004'];
// 진짜 저장소 전체(모든 컬렉션 + 비서 기록). 새 컬렉션이 생겨도 저절로 포함된다(MemoryStore의 cols·events를 직접 읽음)
const rawDump = async (inner) =>
  JSON.stringify({ cols: [...inner.cols].map(([name, docs]) => [name, [...docs.values()]]), events: [...inner.events.values()] });

// 이의 없이 모두 수락하는 데모 방(test/transfers.test.mjs의 setup과 같은 조건)을 래퍼 위에 만든다
async function demoRoom() {
  const { inner, store } = make();
  await seedDemoRoom(store, { id: 'demo-e' });
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { ...a.rules, autoAccept: 1_000_000, onDispute: 'ask' } });
  }
  const orch = createOrchestrator({ store, clock: () => new Date('2026-11-10T03:00:00Z') });
  await orch.sendInvoices('demo-e', 'me');
  return { inner, store, orch };
}

test('통합: 청구→송금까지 돌려도 저장소에는 계좌번호가 없고, 당사자 화면에는 평문', async () => {
  const { inner, store } = await demoRoom();
  const ts = await store.list('transfers', { roomId: 'demo-e' });
  assert.equal(ts.length, 3);
  assert.ok(ts.every((t) => t.link?.startsWith('supertoss://send?')));

  const dump = await rawDump(inner);
  for (const n of DEMO_ACCOUNTS) assert.ok(!dump.includes(n), `저장소에 ${n}이 평문으로 남음`);
  assert.ok(!dump.includes('토스뱅크') && !dump.includes(encodeURIComponent('토스뱅크')));

  const server = createApp({ store, gemini: null, env: { DEV_SEED: '1' } }); // #2 이후 x-demo-user 헤더는 개발 모드에서만 받는다
  await new Promise((r) => server.listen(0, r));
  try {
    const res = await fetch(`http://localhost:${server.address().port}/api/rooms/demo-e`, { headers: { 'x-demo-user': 'cs' } });
    assert.equal(res.status, 200);
    const t = (await res.json()).transfers.find((x) => x.from === 'cs' && x.to === 'yh');
    assert.deepEqual(t.fallback, { bank: '토스뱅크', accountNo: '100000000003', amount: 41155 });
    assert.match(t.link, /accountNo=100000000003/);
  } finally {
    server.close();
  }
});

test('통합: 받을 계좌를 새로 정해도 저장소에는 잠긴 글자만', async () => {
  const { inner, store, orch } = await demoRoom();
  await orch.setPayout('demo-e', 'yh', { bank: '국민은행', accountNo: '123-456-789012', holder: '영희' });
  const dump = await rawDump(inner);
  assert.ok(!dump.includes('123456789012') && !dump.includes('123-456-789012'));
  assert.ok(!dump.includes('국민') && !dump.includes(encodeURIComponent('국민'))); // 'KB국민은행'(저장 표기)·'국민'(토스 표기)
  assert.equal((await store.get('agents', 'yh')).payout.accountNo, '123-456-789012');
  const t = (await store.list('transfers', { roomId: 'demo-e' })).find((x) => x.to === 'yh');
  assert.equal(t.fallback.accountNo, '123456789012');
});
