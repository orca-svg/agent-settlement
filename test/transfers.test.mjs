// 송금: 청구가 끝나면 송금을 만들고, 받는 계좌가 있으면 토스 링크를 미리 채운다. 때가 되면 알리고, 보냈어요·받았어요로 끝낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { pendingActions } from '../src/actions.mjs';
import { createApp } from '../src/app.mjs';
import { verifyQrToken } from '../src/payments/qr.mjs';

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

// 철수→영희 송금을 보냈어요까지 진행한다(철수는 월급날 규칙이라 scheduled지만 보냈어요는 미리 눌러도 된다)
async function sentCsYh(ctx) {
  const t = pair(await ctx.transfers(), 'cs', 'yh');
  await ctx.orch.markSent('demo-t', t.id, 'cs');
  return t.id;
}

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

// 데스크톱 QR(#8): 토큰을 송금이 생길 때 미리 만들어 두면 15분 뒤 죽는다. 보내는 사람이 화면을 열 때마다 새로 만든다
test('송금 문서에는 QR 토큰을 미리 넣어 두지 않는다', async () => {
  const { transfers } = await setup();
  assert.ok((await transfers()).every((t) => !('qrToken' in t)));
});

test('월급날 며칠 뒤에 송금 화면을 열어도, 그때 만든 QR은 토스 링크로 풀린다', async () => {
  const { orch, clock, transfers } = await setup();
  clock.now = new Date('2026-11-25T00:00:00Z'); // 철수의 월급날 알림 시각(송금이 생기고 15일 뒤)
  await orch.tick();
  const t = pair(await transfers(), 'cs', 'me');
  const { qrToken, expiresAt } = await orch.qrFor('demo-t', t.id, 'cs');
  assert.equal(verifyQrToken(qrToken, { now: () => clock.now.getTime() }), t.link);
  assert.equal(expiresAt, '2026-11-25T00:15:00.000Z');
});

test('QR은 보내는 사람만 만들 수 있다(받는 사람은 403)', async () => {
  const { orch, transfers } = await setup();
  const t = pair(await transfers(), 'cs', 'me');
  await assert.rejects(orch.qrFor('demo-t', t.id, 'me'), (e) => e.status === 403);
});

test('이미 보냈거나 지출이 바뀐 송금에는 QR을 만들지 않는다(409)', async () => {
  const { store, orch, transfers } = await setup();
  const sent = pair(await transfers(), 'ms', 'me');
  await orch.markSent('demo-t', sent.id, 'ms');
  await assert.rejects(orch.qrFor('demo-t', sent.id, 'ms'), (e) => e.status === 409);
  const t = pair(await transfers(), 'cs', 'me');
  await store.put('rooms', { ...(await store.get('rooms', 'demo-t')), version: 2 });
  await assert.rejects(orch.qrFor('demo-t', t.id, 'cs'), (e) => e.status === 409);
});

test('받을 계좌가 없으면 QR을 만들지 않는다(409)', async () => {
  const { orch, transfers } = await setup({ withoutPayout: 'me' });
  const t = pair(await transfers(), 'cs', 'me');
  await assert.rejects(orch.qrFor('demo-t', t.id, 'cs'), (e) => e.status === 409);
});

test('HTTP: 보내는 사람이 QR을 요청하면 새 토큰을 주고, 그 토큰 주소는 토스 링크로 보낸다', async () => {
  const { store, transfers } = await setup();
  const t = pair(await transfers(), 'cs', 'me');
  const server = createApp({ store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const qr = (uid) => fetch(`${base}/api/rooms/demo-t/transfers/${encodeURIComponent(t.id)}/qr`, { method: 'POST', headers: { 'x-demo-user': uid } });
  try {
    assert.equal((await qr('me')).status, 403);
    const res = await qr('cs');
    assert.equal(res.status, 200);
    const { qrToken } = await res.json();
    const hop = await fetch(`${base}/api/qr/${qrToken}`, { redirect: 'manual' });
    assert.equal(hop.status, 302);
    assert.equal(hop.headers.get('location'), t.link);
  } finally {
    server.close();
  }
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

test('월급날 규칙이면 remindAt이 다음 25일 09:00, 편할 때면 다음 날 09:00', async () => {
  const { transfers } = await setup();
  assert.equal(pair(await transfers(), 'cs', 'me').remindAt, '2026-11-25T00:00:00.000Z');
  assert.equal(pair(await transfers(), 'ms', 'me').remindAt, '2026-11-11T00:00:00.000Z');
});

test('알림 때 전에는 due 아님, 지나서 tick이 돌면 due + approve_transfer 액션', async () => {
  const { orch, clock, transfers, actions } = await setup();
  assert.deepEqual((await actions()).filter((a) => a.type === 'approve_transfer'), []);
  await orch.tick();
  assert.equal(pair(await transfers(), 'ms', 'me').status, 'scheduled');
  clock.now = new Date('2026-11-11T00:00:00Z');
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

// 보냈어요 뒤 받는 사람이 답이 없으면 sentAt 기준 1일·3일 뒤에 다시 묻는다. 그 뒤로는 할 일 카드만 남는다
const reminderTexts = async (ctx, id) => (await ctx.store.listEvents('demo-t')).filter((e) => e.kind === 'receipt_reminder' && e.action?.ref === id).map((e) => e.text);
const FIRST = '철수가 보낸 ₩41,155을 받았나요?';
const SECOND = '철수가 보낸 지 3일이 넘었어요. ₩41,155을 받았나요?';

test('보냈어요 뒤 미확인이면 1일·3일에 한 번씩, 두 번만 다시 묻는다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx); // 2026-11-10T03:00Z에 보냈어요
  const at = async (iso) => { ctx.clock.now = new Date(iso); await ctx.orch.tick(); };
  await at('2026-11-11T02:59:00Z'); // 아직 1일이 안 됨
  assert.deepEqual(await reminderTexts(ctx, id), []);
  await at('2026-11-11T03:00:00Z');
  assert.deepEqual(await reminderTexts(ctx, id), [FIRST]);
  await at('2026-11-12T03:00:00Z'); // 2일: 더 묻지 않음
  assert.deepEqual(await reminderTexts(ctx, id), [FIRST]);
  await at('2026-11-13T03:00:00Z');
  assert.deepEqual(await reminderTexts(ctx, id), [FIRST, SECOND]);
  await at('2026-11-20T03:00:00Z'); // 그 뒤로는 없음
  assert.deepEqual(await reminderTexts(ctx, id), [FIRST, SECOND]);
  assert.equal((await ctx.store.get('transfers', id)).reminders, 2);
  assert.deepEqual((await ctx.actions()).filter((a) => a.type === 'confirm_receipt' && a.ref === id).map((a) => a.for), ['yh']);
});

test('다시 알림이 밀려 3일 뒤 처음 돌면, 두 번째 문구 하나만 보낸다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  ctx.clock.now = new Date('2026-11-14T03:00:00Z');
  await ctx.orch.tick();
  await ctx.orch.tick();
  assert.deepEqual(await reminderTexts(ctx, id), [SECOND]);
  assert.equal((await ctx.store.get('transfers', id)).reminders, 2);
});

test('예전 송금(remindedAt만 있고 reminders 없음)은 한 번 물은 것으로 센다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  const legacy = { ...(await ctx.store.get('transfers', id)), remindedAt: '2026-11-11T03:00:00.000Z' };
  delete legacy.reminders;
  await ctx.store.put('transfers', legacy);
  ctx.clock.now = new Date('2026-11-12T03:00:00Z');
  await ctx.orch.tick();
  assert.deepEqual(await reminderTexts(ctx, id), []);
  ctx.clock.now = new Date('2026-11-13T03:00:00Z');
  await ctx.orch.tick();
  assert.deepEqual(await reminderTexts(ctx, id), [SECOND]);
});

// 리뷰 후속: 다시 보냈어요가 다시 알림을 처음부터 세는지 실제 tick으로 확인한다(remindedAt이 남아 있어도 reminders: 0이 이긴다)
test('안 들어왔다고 한 뒤 다시 보냈어요를 누르면, 그때부터 1일 뒤에 다시 묻는다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx); // 2026-11-10T03:00Z
  ctx.clock.now = new Date('2026-11-11T03:00:00Z');
  await ctx.orch.tick(); // 1번째 다시 알림
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  ctx.clock.now = new Date('2026-11-11T05:00:00Z');
  await ctx.orch.markSent('demo-t', id, 'cs');
  ctx.clock.now = new Date('2026-11-12T04:59:00Z');
  await ctx.orch.tick();
  assert.deepEqual(await reminderTexts(ctx, id), [FIRST]); // 다시 보낸 지 아직 1일이 안 됨
  ctx.clock.now = new Date('2026-11-12T05:00:00Z');
  await ctx.orch.tick();
  assert.deepEqual(await reminderTexts(ctx, id), [FIRST, FIRST]);
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

// 송금 확인 UX(#8): 받는 사람이 "아직 안 들어왔어요"를 누르면 상태는 sent로 두고 표시(notReceivedAt)만 붙여 보내는 사람에게 다시 묻는다.
// 보냈다고 한 돈은 은행 지연·계좌 착오로 늦게 들어올 수 있으니, 안 보낸 돈(opened)처럼 대체하거나 계좌를 바꿔 채우지 않는다
test('아직 안 들어왔어요: 받는 사람만, 보냈다고 한 송금에만(아니면 403·409)', async () => {
  const ctx = await setup();
  const t = pair(await ctx.transfers(), 'cs', 'yh');
  await assert.rejects(ctx.orch.reportNotReceived('demo-t', t.id, 'yh'), (e) => e.status === 409); // 아직 scheduled
  await ctx.orch.markSent('demo-t', t.id, 'cs');
  await assert.rejects(ctx.orch.reportNotReceived('demo-t', t.id, 'cs'), (e) => e.status === 403);
  await assert.rejects(ctx.orch.reportNotReceived('demo-t', t.id, 'me'), (e) => e.status === 403);
  await ctx.orch.confirmReceipt('demo-t', t.id, 'yh');
  await assert.rejects(ctx.orch.reportNotReceived('demo-t', t.id, 'yh'), (e) => e.status === 409); // 이미 confirmed
});

test('아직 안 들어왔어요: 상태는 sent 그대로 두고 표시만 붙이며, 보내는 사람에게 알린다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  ctx.clock.now = new Date('2026-11-10T05:00:00Z');
  const saved = await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  assert.equal(saved.status, 'sent');
  assert.equal(saved.notReceivedAt, '2026-11-10T05:00:00.000Z');
  assert.equal((await ctx.store.get('transfers', id)).status, 'sent');
  ctx.clock.now = new Date('2026-11-10T05:01:00Z');
  const again = await ctx.orch.reportNotReceived('demo-t', id, 'yh'); // 두 번 눌러도 오류 없이 같은 결과
  assert.deepEqual([again.status, again.notReceivedAt], ['sent', '2026-11-10T05:00:00.000Z']);
  const ev = (await ctx.store.listEvents('demo-t')).filter((e) => e.kind === 'transfer_not_received');
  assert.deepEqual(ev.map((e) => [e.from, e.to, e.text, e.action?.type, e.action?.for, e.action?.ref]), [
    ['yh', 'cs', '아직 ₩41,155을 못 받았어요. 송금 내역을 한 번 확인해 주세요', 'approve_transfer', 'cs', id],
  ]);
});

test('HTTP: 받는 사람이 not-received를 부르면 sent에 표시가 붙고, 보내는 사람은 403', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  // x-demo-user 신원은 개발 모드(DEV_SEED=1)에서만 받는다(#2)
  const server = createApp({ store: ctx.store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const call = (uid) => fetch(`http://localhost:${server.address().port}/api/rooms/demo-t/transfers/${encodeURIComponent(id)}/not-received`, { method: 'POST', headers: { 'x-demo-user': uid } });
  try {
    assert.equal((await call('cs')).status, 403);
    const res = await call('yh');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'sent');
    assert.ok(body.notReceivedAt);
  } finally {
    server.close();
  }
});

test('안 들어왔다고 한 뒤 보내는 사람이 보냈어요: 표시를 내리고 확인 시각을 적고, 다시 알림을 처음부터 센다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx); // 2026-11-10T03:00Z
  ctx.clock.now = new Date('2026-11-11T04:00:00Z');
  await ctx.orch.tick(); // 하루가 지나 한 번 물었다
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  ctx.clock.now = new Date('2026-11-11T06:00:00Z');
  const saved = await ctx.orch.markSent('demo-t', id, 'cs');
  assert.equal(saved.status, 'sent');
  assert.equal(saved.sentAt, '2026-11-11T06:00:00.000Z');
  assert.equal(saved.reminders, 0);
  assert.equal(saved.notReceivedAt, undefined);
  assert.equal(saved.recheckedAt, '2026-11-11T06:00:00.000Z'); // 받는 사람 쪽 문구("송금 내역을 확인했대요")에 쓴다
  const sent = (await ctx.store.listEvents('demo-t')).filter((e) => e.kind === 'transfer_sent').map((e) => e.text);
  assert.deepEqual(sent, ['영희에게 ₩41,155을 보냈어요', '송금 내역을 확인했어요. 영희에게 ₩41,155을 보냈어요']);
  await assert.rejects(ctx.orch.markSent('demo-t', id, 'cs'), (e) => e.status === 409); // 표시가 없는 sent에는 다시 못 누른다
  ctx.clock.now = new Date('2026-11-11T07:00:00Z');
  assert.equal((await ctx.orch.reportNotReceived('demo-t', id, 'yh')).notReceivedAt, '2026-11-11T07:00:00.000Z'); // 그래도 안 들어왔으면 또 알릴 수 있다
});

test('할 일 문구: 안 들어왔다고 하면 보내는 사람에게 "아직 못 받았대요", 받는 사람에게 "들어오면 알려 주세요", 다시 확인하면 "송금 내역을 확인했대요"', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  const of = async (type, uid) => (await ctx.actions()).filter((a) => a.type === type && a.for === uid && a.ref === id).map((a) => a.text);
  assert.deepEqual(await of('confirm_receipt', 'yh'), ['철수가 보낸 ₩41,155을 받았나요?']);
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  assert.deepEqual(await of('approve_transfer', 'cs'), ['영희가 ₩41,155을 아직 못 받았대요']);
  assert.deepEqual(await of('confirm_receipt', 'yh'), ['철수가 보낸 ₩41,155이 들어오면 알려 주세요']); // 늦게 들어오면 여기서 끝낸다
  await ctx.orch.markSent('demo-t', id, 'cs');
  assert.deepEqual(await of('approve_transfer', 'cs'), []);
  assert.deepEqual(await of('confirm_receipt', 'yh'), ['철수가 송금 내역을 확인했대요. ₩41,155을 받았나요?']);
});

test('안 들어왔다고 한 뒤에 돈이 들어왔으면 받는 사람이 받았어요로 끝낼 수 있다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  assert.equal((await ctx.orch.confirmReceipt('demo-t', id, 'yh')).status, 'confirmed');
});

// 리뷰 1·2·7: 지출이 바뀌어도 보냈다고 한 기록은 남아야 한다. 대체되면 늦게 들어온 돈을 확인할 수 없고, 새 송금으로 두 번 내게 된다
test('안 들어왔다고 한 송금은 지출이 바뀌어도 대체되지 않고, 보내는 사람에게 할 일이 남는다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  await ctx.store.put('rooms', { ...(await ctx.store.get('rooms', 'demo-t')), version: 2 }); // 누군가 지출을 고쳤다
  await ctx.orch.tick();
  assert.equal((await ctx.store.get('transfers', id)).status, 'sent');
  const todo = (await ctx.actions()).filter((a) => a.ref === id).map((a) => [a.type, a.for]);
  assert.deepEqual(todo, [['approve_transfer', 'cs'], ['confirm_receipt', 'yh']]);
});

test('지출이 바뀐 뒤에도 보내는 사람은 보냈어요로 답하고, 받는 사람은 받았어요로 끝낼 수 있다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  await ctx.store.put('rooms', { ...(await ctx.store.get('rooms', 'demo-t')), version: 2 });
  await ctx.orch.tick();
  assert.equal((await ctx.orch.markSent('demo-t', id, 'cs')).status, 'sent'); // STALE 409가 아니다
  assert.equal((await ctx.orch.confirmReceipt('demo-t', id, 'yh')).status, 'confirmed');
});

test('지출이 바뀌기 전에 보낸 송금(예전 version)에 안 들어왔어요를 눌러도 기록이 남고 보내는 사람에게 묻는다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx); // version 1에서 보냈다
  await ctx.store.put('rooms', { ...(await ctx.store.get('rooms', 'demo-t')), version: 2 });
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  await ctx.orch.tick();
  assert.equal((await ctx.store.get('transfers', id)).status, 'sent');
  assert.deepEqual((await ctx.actions()).filter((a) => a.type === 'approve_transfer' && a.ref === id).map((a) => a.for), ['cs']);
});

// 리뷰 3: 안 들어왔다고 한 뒤 받는 사람이 계좌를 바꿔도, 보낸 송금의 링크를 새 계좌로 바꾸면 보내는 사람이 새 계좌로 한 번 더 보내게 된다
test('안 들어왔다고 한 뒤 받는 사람이 계좌를 바꿔도, 보낸 송금의 링크와 계좌는 그대로다', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  const before = await ctx.store.get('transfers', id);
  await ctx.orch.setPayout('demo-t', 'yh', { bank: '토스뱅크', accountNo: '1000-9999-0001', holder: '영희' });
  const after = await ctx.store.get('transfers', id);
  assert.deepEqual([after.link, after.fallback], [before.link, before.fallback]);
});

test('안 들어왔다고 한 송금은 보내는 사람이 다시 보내도록 QR을 만들 수 있다(받는 사람은 403)', async () => {
  const ctx = await setup();
  const id = await sentCsYh(ctx);
  await ctx.orch.reportNotReceived('demo-t', id, 'yh');
  const { qrToken } = await ctx.orch.qrFor('demo-t', id, 'cs');
  assert.equal(verifyQrToken(qrToken, { now: () => ctx.clock.now.getTime() }), (await ctx.store.get('transfers', id)).link);
  await assert.rejects(ctx.orch.qrFor('demo-t', id, 'yh'), (e) => e.status === 403);
});

// #3: Firestore에서는 읽은 문서 수가 곧 비용이고 tick은 1분마다 돈다. 그래서 끝난 송금(confirmed·superseded)은 읽지 않고,
// 방은 tick 한 번에 방마다 한 번만 읽고, 지출은 읽지 않는다
test('tick은 처리할 송금만 읽고, 방은 한 번만 읽고, 지출은 읽지 않는다', async () => {
  const ctx = await setup();
  const { store, orch } = ctx;
  await orch.confirmReceipt('demo-t', await sentCsYh(ctx), 'yh');
  const room = await store.get('rooms', 'demo-t');
  await store.put('rooms', { ...room, version: 2 });
  await orch.sendInvoices('demo-t', 'me');
  const all = await store.list('transfers');
  const active = all.filter((t) => ['scheduled', 'due', 'opened', 'sent'].includes(t.status));
  assert.ok(active.length && active.length < all.length, '끝난 송금이 섞여 있어야 확인이 된다');
  const read = { transfers: 0, rooms: 0, expenses: 0 };
  for (const method of ['get', 'list']) {
    const original = store[method].bind(store);
    store[method] = async (col, ...rest) => {
      const out = await original(col, ...rest);
      if (col in read) read[col] += Array.isArray(out) ? out.length : out ? 1 : 0;
      return out;
    };
  }
  await orch.tick();
  assert.deepEqual(read, { transfers: active.length, rooms: 1, expenses: 0 });
});
