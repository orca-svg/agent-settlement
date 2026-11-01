// 송금: 청구가 끝나면 송금을 만들고, 받는 계좌가 있으면 토스 링크를 미리 채운다. 때가 되면 알리고, 보냈어요·받았어요로 끝낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { pendingActions } from '../src/actions.mjs';
import { createApp } from '../src/app.mjs';

// 이의 없이 모두 수락하는 방: 민수의 근거 규칙을 끄고 한도를 넉넉히
async function setup({ withoutPayout } = {}) {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: 'demo-t' });
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { ...a.rules, autoAccept: 1_000_000, onDispute: 'ask' }, ...(uid === withoutPayout ? { payout: null } : {}) });
  }
  const clock = { now: new Date('2026-11-10T03:00:00Z') };
  const orch = createOrchestrator({ store, clock: () => clock.now });
  await orch.sendInvoices('demo-t', 'me');
  const transfers = () => store.list('transfers', { roomId: 'demo-t' });
  const actions = async () => pendingActions({ room: await store.get('rooms', 'demo-t'), expenses: [], transfers: await transfers() });
  return { store, orch, clock, transfers, actions };
}
const pair = (ts, from, to) => ts.find((t) => t.from === from && t.to === to && t.status !== 'superseded');

test('청구가 끝나면 송금을 만든다. 0원은 없다', async () => {
  const { transfers } = await setup();
  const ts = await transfers();
  assert.deepEqual(ts.map((t) => [t.from, t.to, t.amount]).sort(), [['cs', 'me', 91462], ['cs', 'yh', 41155], ['ms', 'me', 260453]]);
  assert.ok(ts.every((t) => t.amount > 0 && t.status === 'scheduled' && t.version === 1));
});

test('받는 정보가 있으면 link와 fallback이 미리 채워진다', async () => {
  const { transfers } = await setup();
  const t = pair(await transfers(), 'cs', 'yh');
  assert.equal(t.link, 'supertoss://send?bank=%ED%86%A0%EC%8A%A4%EB%B1%85%ED%81%AC&accountNo=100000000003&amount=41155&origin=linkgen');
  assert.deepEqual(t.fallback, { bank: '토스뱅크', accountNo: '100000000003', amount: 41155 });
});

test('받는 정보가 없으면 link=null, fallback도 null이고 받는 사람에게 set_payout', async () => {
  const { transfers, actions } = await setup({ withoutPayout: 'me' });
  const t = pair(await transfers(), 'cs', 'me');
  assert.deepEqual([t.link, t.fallback], [null, null]);
  const asks = (await actions()).filter((a) => a.type === 'set_payout');
  assert.deepEqual(asks.map((a) => [a.for, a.text]), [['me', '받을 계좌를 알려 주면 바로 보낼 수 있어요']]);
});

test('받는 계좌를 알려 주면 열린 송금에 링크가 채워진다', async () => {
  const { orch, transfers, actions } = await setup({ withoutPayout: 'me' });
  await orch.setPayout('demo-t', 'me', { bank: '토스뱅크', accountNo: '1000-0000-0001', holder: '나' });
  const t = pair(await transfers(), 'cs', 'me');
  assert.match(t.link, /^supertoss:\/\/send\?/);
  assert.deepEqual((await actions()).filter((a) => a.type === 'set_payout'), []);
});

test('월급날 규칙이면 remindAt이 다음 25일 09:00', async () => {
  const { transfers } = await setup();
  assert.equal(pair(await transfers(), 'cs', 'me').remindAt, '2026-11-25T00:00:00.000Z');
  assert.equal(pair(await transfers(), 'ms', 'me').remindAt, '2026-11-10T03:00:00.000Z');
});

test('tick 전에는 due 아님, 뒤에는 due + approve_transfer 액션', async () => {
  const { orch, transfers, actions } = await setup();
  assert.deepEqual((await actions()).filter((a) => a.type === 'approve_transfer'), []);
  await orch.tick();
  assert.equal(pair(await transfers(), 'ms', 'me').status, 'due');
  assert.equal(pair(await transfers(), 'cs', 'me').status, 'scheduled');
  assert.deepEqual((await actions()).filter((a) => a.type === 'approve_transfer').map((a) => a.for), ['ms']);
});

test('version이 바뀌면 이전 송금도 superseded', async () => {
  const { store, orch, transfers } = await setup();
  const room = await store.get('rooms', 'demo-t');
  await store.put('rooms', { ...room, version: 2 });
  await orch.sendInvoices('demo-t', 'me');
  const ts = await transfers();
  assert.ok(ts.filter((t) => t.version === 1).every((t) => t.status === 'superseded'));
  assert.equal(ts.filter((t) => t.version === 2).length, 3);
});

test('보내는 사람만 승인·보냈어요, 받는 사람만 받았어요(아니면 403)', async () => {
  const { orch, transfers } = await setup();
  await orch.tick();
  const t = pair(await transfers(), 'ms', 'me');
  await assert.rejects(orch.approveTransfer('demo-t', t.id, 'me'), (e) => e.status === 403);
  assert.equal((await orch.approveTransfer('demo-t', t.id, 'ms')).status, 'opened');
  assert.equal((await orch.markSent('demo-t', t.id, 'ms')).status, 'sent');
  await assert.rejects(orch.confirmReceipt('demo-t', t.id, 'ms'), (e) => e.status === 403);
  assert.equal((await orch.confirmReceipt('demo-t', t.id, 'me')).status, 'confirmed');
});

test('sent 후 24시간 미확인 → confirm_receipt 액션과 알림은 한 번만', async () => {
  const { store, orch, clock, transfers, actions } = await setup();
  await orch.tick();
  const t = pair(await transfers(), 'ms', 'me');
  await orch.markSent('demo-t', t.id, 'ms');
  clock.now = new Date('2026-11-11T04:00:00Z');
  await orch.tick();
  await orch.tick();
  const reminders = (await store.listEvents('demo-t')).filter((e) => e.kind === 'receipt_reminder');
  assert.equal(reminders.length, 1);
  assert.deepEqual((await actions()).filter((a) => a.type === 'confirm_receipt').map((a) => a.for), ['me']);
});

test('cron tick은 비밀값이 맞을 때만 동작한다', async () => {
  const server = createApp({ store: new MemoryStore(), env: { CRON_SECRET: 's3cret' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/api/cron/tick`;
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-cron-secret': 'nope' } })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'x-cron-secret': 's3cret' } })).status, 200);
  } finally {
    server.close();
  }
  const open = createApp({ store: new MemoryStore(), env: {} });
  await new Promise((r) => open.listen(0, r));
  try {
    assert.equal((await fetch(`http://localhost:${open.address().port}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': '' } })).status, 401);
  } finally {
    open.close();
  }
});

test('지출이 바뀌면 다시 보내기 전에도 이전 금액은 할 일에서 빠지고, 보낼 수 없고, tick이 대체한다', async () => {
  const { store, orch, transfers, actions } = await setup();
  await orch.tick();
  const t = pair(await transfers(), 'ms', 'me');
  const room = await store.get('rooms', 'demo-t');
  await store.put('rooms', { ...room, version: 2 }); // 누군가 지출을 고쳤다
  assert.deepEqual((await actions()).filter((a) => a.type === 'approve_transfer'), []);
  await assert.rejects(orch.approveTransfer('demo-t', t.id, 'ms'), (e) => e.status === 409);
  await assert.rejects(orch.markSent('demo-t', t.id, 'ms'), (e) => e.status === 409);
  await orch.tick();
  assert.ok((await transfers()).every((x) => x.status === 'superseded'));
});

test('지출이 바뀌면 이전 version의 물은 청구서에는 답할 수 없다', async () => {
  const { store, orch } = await setup();
  const cs = await store.get('agents', 'cs');
  await store.put('agents', { ...cs, rules: { ...cs.rules, autoAccept: 0 } });
  const room = await store.get('rooms', 'demo-t');
  await store.put('rooms', { ...room, version: 2 });
  await orch.sendInvoices('demo-t', 'me');
  await store.put('invoices', { ...(await store.get('invoices', 'demo-t:v2:cs')), version: 2 });
  await store.put('rooms', { ...(await store.get('rooms', 'demo-t')), version: 3 });
  const stale = pendingActions({ room: await store.get('rooms', 'demo-t'), invoices: await store.list('invoices', { roomId: 'demo-t' }) });
  assert.deepEqual(stale, []);
  await assert.rejects(orch.answerInvoice('demo-t', 'demo-t:v2:cs', 'cs', { decision: 'accept' }), (e) => e.status === 409);
});
