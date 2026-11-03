// 개인 비서 설정(#5): 기억·규칙·변경 기록·처음 설정이 저장되고, 저장한 한도와 보낼 시기가 실제 청구·송금에 반영되는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { encryptedStore } from '../src/store/encrypted.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { createAgentSettings, normalizeSettings } from '../src/agents/settings.mjs';
import { sharedMemory, roomMemory } from '../src/agents/memory.mjs';
import { evidenceFor } from '../src/agents/evidence.mjs';
import { pendingActions } from '../src/actions.mjs';
import { createApp } from '../src/app.mjs';
import { notifies, DEFAULT_RULES, ruleChangeText } from '../public/agent-rules.js';
import { draftFromRules, rulesFromDraft, memoryRowsHtml, historyHtml, limitHtml } from '../public/agent-panel.js';

const ROOM = 'demo-t';
async function setup({ evidence = false, store = new MemoryStore() } = {}) {
  await seedDemoRoom(store, { id: ROOM });
  // 시드의 규칙 대신 시험마다 정한 규칙만 쓴다(민수의 근거 규칙도 끈다)
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { autoAccept: 1_000_000, sendWhen: 'now', onDispute: 'ask' } });
  }
  const clock = { now: new Date('2026-11-10T03:00:00Z') };
  const orch = createOrchestrator({ store, clock: () => clock.now, ...(evidence ? { evidenceFor } : {}) });
  const settings = createAgentSettings({ store, clock: () => clock.now });
  const invoiceOf = async (uid) => {
    const { version } = await store.get('rooms', ROOM);
    return (await store.list('invoices', { roomId: ROOM })).find((i) => i.to === uid && i.version === version);
  };
  const transfers = () => store.list('transfers', { roomId: ROOM });
  const metas = async (kind) => (await store.listEvents(ROOM)).filter((e) => e.kind === kind).map((e) => e.meta);
  return { store, orch, settings, clock, invoiceOf, transfers, metas };
}
// 시드 방에서 철수가 내는 돈은 132,617원, 민수는 260,453원(규칙 모드, 실제 낸 원화 기준)
const CS_OWES = 132_617;

// ---------------------------------------------------------------- 완료 기준 1: 한도가 실제 청구 처리에 반영된다
test('완료 기준: 저장한 자동 수락 한도가 청구 처리에 반영된다(경계값 포함)', async () => {
  const ctx = await setup();
  await ctx.settings.updateRules('cs', { autoAccept: CS_OWES });
  await ctx.orch.sendInvoices(ROOM, 'me');
  const inv = await ctx.invoiceOf('cs');
  assert.equal(-inv.net, CS_OWES);
  assert.deepEqual([inv.status, inv.decidedBy], ['accepted', 'agent']);
});

test('완료 기준: 한도를 1원이라도 넘으면 주인에게 묻고, 답하기 전에는 송금이 생기지 않는다', async () => {
  const ctx = await setup();
  await ctx.settings.updateRules('cs', { autoAccept: CS_OWES - 1 });
  await ctx.orch.sendInvoices(ROOM, 'me');
  const inv = await ctx.invoiceOf('cs');
  assert.deepEqual([inv.status, inv.decidedBy], ['asked', null]);
  assert.equal((await ctx.transfers()).length, 0);
  const actions = pendingActions({ invoices: await ctx.store.list('invoices', { roomId: ROOM }) });
  assert.deepEqual(actions.map((a) => [a.type, a.for]), [['answer_invoice', 'cs']]);
  await ctx.orch.answerInvoice(ROOM, inv.id, 'cs', { decision: 'accept' });
  assert.ok((await ctx.transfers()).length > 0);
});

test('완료 기준: 근거로 이의를 내도 한도를 넘은 청구서를 대신 받지 않는다. 이의가 끝나면 다시 판단해 묻는다', async () => {
  const ctx = await setup({ evidence: true });
  await ctx.settings.updateRules('ms', { autoAccept: 0, onDispute: 'evidence' });
  await ctx.settings.updateRules('me', { onDispute: 'mediator' });
  await ctx.orch.sendInvoices(ROOM, 'me');
  assert.equal((await ctx.invoiceOf('ms')).status, 'disputed');
  assert.equal((await ctx.transfers()).length, 0, '이의가 열려 있으면 송금으로 넘어가지 않는다');
  const [d] = await ctx.store.list('disputes', { roomId: ROOM });
  await ctx.orch.agree(ROOM, d.id, 'me');
  const again = await ctx.invoiceOf('ms');
  assert.equal(again.version, 2);
  assert.deepEqual([again.status, again.decidedBy], ['asked', null]);
  assert.equal((await ctx.transfers()).filter((t) => t.status !== 'superseded').length, 0);
});

test('완료 기준: 저장된 한도가 망가졌으면 대신 받지 않고 묻는다', async () => {
  for (const bad of ['999999999', -1, NaN, null, undefined, 1.5, {}, 10_000_001]) {
    const ctx = await setup();
    const a = await ctx.store.get('agents', 'cs');
    await ctx.store.put('agents', { ...a, rules: { ...a.rules, autoAccept: bad } });
    await ctx.orch.sendInvoices(ROOM, 'me');
    assert.equal((await ctx.invoiceOf('cs')).status, 'asked', `autoAccept=${String(bad)}`);
  }
});

test('비서 문서가 없는 새 사용자도 기본값으로 모든 청구서를 묻는다', async () => {
  const ctx = await setup();
  await ctx.store.delete('agents', 'cs');
  await ctx.orch.sendInvoices(ROOM, 'me');
  assert.equal((await ctx.invoiceOf('cs')).status, 'asked');
});

// ---------------------------------------------------------------- 완료 기준 2: 보낼 시기가 실제로 반영된다
const pair = (ts, from, to) => ts.find((t) => t.from === from && t.to === to && t.status !== 'superseded');

test('완료 기준: 지정일로 정하면 그날 09:00 KST 전에는 알리지 않고, 그때 알린다', async () => {
  const ctx = await setup();
  await ctx.settings.updateRules('cs', { sendWhen: { payday: 25 } });
  await ctx.orch.sendInvoices(ROOM, 'me');
  const t = pair(await ctx.transfers(), 'cs', 'me');
  assert.equal(t.remindAt, '2026-11-25T00:00:00.000Z');
  ctx.clock.now = new Date('2026-11-24T23:59:00Z');
  await ctx.orch.tick();
  assert.equal((await ctx.store.get('transfers', t.id)).status, 'scheduled');
  ctx.clock.now = new Date('2026-11-25T00:00:00Z');
  await ctx.orch.tick();
  assert.equal((await ctx.store.get('transfers', t.id)).status, 'due');
});

test('완료 기준: 바로로 정하면 다음 확인 때 바로 알린다', async () => {
  const ctx = await setup();
  await ctx.orch.sendInvoices(ROOM, 'me');
  await ctx.orch.tick();
  assert.equal(pair(await ctx.transfers(), 'cs', 'me').status, 'due');
});

test('직접 보내기: 알림 시각이 없고, 시간이 지나도 알리지 않으며, 본인이 보낼 수는 있다', async () => {
  const ctx = await setup();
  await ctx.settings.updateRules('cs', { sendWhen: 'manual' });
  await ctx.orch.sendInvoices(ROOM, 'me');
  const t = pair(await ctx.transfers(), 'cs', 'me');
  assert.equal(t.remindAt, null);
  ctx.clock.now = new Date('2027-06-01T00:00:00Z');
  await ctx.orch.tick();
  assert.equal((await ctx.store.get('transfers', t.id)).status, 'scheduled');
  assert.ok((await ctx.store.listEvents(ROOM)).every((e) => !(e.kind === 'transfer_due' && e.from === 'cs')));
  const room = await ctx.store.get('rooms', ROOM);
  assert.ok(!pendingActions({ room, transfers: await ctx.transfers() }).some((a) => a.type === 'approve_transfer' && a.for === 'cs'));
  assert.equal((await ctx.orch.approveTransfer(ROOM, t.id, 'cs')).status, 'opened');
  assert.equal((await ctx.orch.markSent(ROOM, t.id, 'cs')).status, 'sent');
});

test('보낼 시기를 바꿔도 이미 만들어진 송금은 그대로고, 다음 청구서부터 적용된다', async () => {
  const ctx = await setup();
  await ctx.settings.updateRules('cs', { sendWhen: { payday: 25 } });
  await ctx.orch.sendInvoices(ROOM, 'me');
  const before = pair(await ctx.transfers(), 'cs', 'me');
  await ctx.settings.updateRules('cs', { sendWhen: 'manual' });
  assert.deepEqual(await ctx.store.get('transfers', before.id), before);
  const room = await ctx.store.get('rooms', ROOM);
  await ctx.store.put('rooms', { ...room, version: room.version + 1 });
  await ctx.orch.sendInvoices(ROOM, 'me');
  assert.equal(pair((await ctx.transfers()).filter((t) => t.version === room.version + 1), 'cs', 'me').remindAt, null);
});

// ---------------------------------------------------------------- 규칙 저장과 변경 기록
test('규칙 검증: 잘못된 값은 400이고 아무것도 저장하지 않는다', async () => {
  const ctx = await setup();
  const before = await ctx.store.get('agents', 'cs');
  for (const input of [{ autoAccept: -1 }, { autoAccept: 1.5 }, { autoAccept: '5000' }, { autoAccept: 10_000_001 }, { sendWhen: 'later' }, { sendWhen: { payday: 0 } }, { sendWhen: { payday: 32 } }, { sendWhen: { payday: '25' } }, { onDispute: 'fight' }, { onDispute: 'toString' }, { notify: 'none' }, { autoAccept: 1000, notify: 'none' }]) {
    await assert.rejects(ctx.settings.updateRules('cs', input), (e) => e.status === 400, JSON.stringify(input));
  }
  assert.deepEqual(await ctx.store.get('agents', 'cs'), before);
});

test('규칙 변경 기록: 바뀐 칸만, 전후 값과 시각을 남긴다', async () => {
  const ctx = await setup();
  await ctx.settings.updateRules('yh', { autoAccept: 1_000_000, sendWhen: 'now' }); // 그대로면 남기지 않는다
  assert.deepEqual((await ctx.settings.get('yh')).ruleHistory, []);
  await ctx.settings.updateRules('yh', { autoAccept: 30_000, sendWhen: { payday: 25, junk: 1 } });
  const v = await ctx.settings.get('yh');
  assert.deepEqual(v.rules.sendWhen, { payday: 25 }, '모르는 칸은 저장하지 않는다');
  assert.deepEqual(v.ruleHistory.map((h) => [h.field, h.text, h.at]), [
    ['autoAccept', '자동 수락 한도: ₩1,000,000 → ₩30,000', '2026-11-10T03:00:00.000Z'],
    ['sendWhen', '보낼 시기: 바로 보내기 → 매달 25일에 보내기', '2026-11-10T03:00:00.000Z'],
  ]);
});

test('규칙 변경 기록은 최근 50개만 둔다', async () => {
  const ctx = await setup();
  for (let i = 1; i <= 55; i++) await ctx.settings.updateRules('yh', { autoAccept: i });
  const { ruleHistory } = await ctx.settings.get('yh');
  assert.equal(ruleHistory.length, 50);
  assert.equal(ruleHistory.at(-1).to, 55);
});

// ---------------------------------------------------------------- 규칙 적용 근거
test('규칙 적용 근거가 비서 기록에 남는다: 자동 수락, 묻기, 보낼 시기', async () => {
  const ctx = await setup();
  await ctx.settings.updateRules('cs', { autoAccept: 200_000, sendWhen: { payday: 25 } });
  await ctx.settings.updateRules('ms', { autoAccept: 0 });
  await ctx.orch.sendInvoices(ROOM, 'me');
  assert.ok((await ctx.metas('invoice_accepted')).includes('규칙 · 자동 수락 한도 ₩200,000 안이에요'));
  assert.deepEqual(await ctx.metas('invoice_asked'), ['규칙 · 자동 수락 한도 초과']);
  await ctx.orch.answerInvoice(ROOM, (await ctx.invoiceOf('ms')).id, 'ms', { decision: 'accept' });
  const scheduled = await ctx.metas('transfer_scheduled');
  assert.ok(scheduled.includes('규칙 · 매달 25일에 보내기'));
  assert.ok(scheduled.includes('규칙 · 바로 보내기'));
});

test('규칙 적용 근거: 직접 보내기, 이의 처리(근거 이의·중재 맡기기·묻기)', async () => {
  const manual = await setup();
  await manual.settings.updateRules('cs', { sendWhen: 'manual' });
  await manual.orch.sendInvoices(ROOM, 'me');
  assert.ok((await manual.metas('transfer_scheduled')).includes('규칙 · 직접 보내기'));

  const med = await setup({ evidence: true });
  await med.settings.updateRules('ms', { onDispute: 'evidence' });
  await med.settings.updateRules('me', { onDispute: 'mediator' });
  await med.orch.sendInvoices(ROOM, 'me');
  const applied = await med.metas('rule_applied');
  assert.ok(applied.includes('규칙 · 근거가 있으면 이의 제기'));
  assert.ok(applied.includes('규칙 · 중재 비서에게 맡기기'));

  const ask = await setup({ evidence: true });
  await ask.settings.updateRules('ms', { onDispute: 'evidence' });
  await ask.orch.sendInvoices(ROOM, 'me');
  const [e] = (await ask.store.listEvents(ROOM)).filter((x) => x.kind === 'dispute_asked');
  assert.equal(e.meta, '규칙 · 이의가 오면 주인에게 묻기');
  assert.deepEqual([e.action.type, e.action.for], ['agree_dispute', 'me']);
});

// ---------------------------------------------------------------- 기억
test('기억: 더하기·고치기·지우기, 공백 정리', async () => {
  const { settings } = await setup();
  let v = await settings.addMemory('new', '  술을\n  마시지   않아요 ');
  assert.deepEqual(v.memory, ['술을 마시지 않아요']);
  v = await settings.editMemory('new', '술을 마시지 않아요', '맥주만 마셔요');
  assert.deepEqual(v.memory, ['맥주만 마셔요']);
  v = await settings.deleteMemory('new', '맥주만 마셔요');
  assert.deepEqual(v.memory, []);
});

test('기억: 무료 요금제 5개 한도, 중복, 빈 글, 60자 초과는 막는다', async () => {
  const { settings, store } = await setup();
  for (let i = 1; i <= 5; i++) await settings.addMemory('new', `기억 ${i}`);
  await assert.rejects(settings.addMemory('new', '여섯 번째'), (e) => e.status === 409 && /5개까지/.test(e.message));
  await assert.rejects(settings.editMemory('new', '기억 1', '기억 2'), (e) => e.status === 409);
  await assert.rejects(settings.editMemory('new', '없는 기억', '다른 글'), (e) => e.status === 404);
  await assert.rejects(settings.deleteMemory('new', '없는 기억'), (e) => e.status === 404);
  await settings.deleteMemory('new', '기억 5');
  await assert.rejects(settings.addMemory('new', '기억 1'), (e) => e.status === 409);
  await assert.rejects(settings.addMemory('new', '   '), (e) => e.status === 400);
  await assert.rejects(settings.addMemory('new', '가'.repeat(61)), (e) => e.status === 400);
  await settings.addMemory('new', '가'.repeat(60));
  assert.equal((await store.get('agents', 'new')).memory.length, 5);
});

// 모델에게 간 프롬프트를 모아 두는 가짜 Gemini
function spyGemini() {
  const prompts = [];
  return {
    prompts,
    model: 'gemini-test',
    async generate(p) {
      prompts.push(JSON.stringify(p));
      const props = p.schema.properties.lines.items.properties;
      return { summary: '테스트', lines: props.id.enum.map((id) => ({ id, consumers: [props.consumers.items.enum[0]], confidence: 0.9, reason: '테스트' })) };
    },
  };
}

test('방별 공유: 끈 기억은 그 방의 배분·중재 프롬프트에 가지 않고, 다른 방에는 그대로 간다', async () => {
  const store = new MemoryStore();
  const gemini = spyGemini();
  const server = createApp({ store, gemini, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const call = async (path, uid, body) => {
    const res = await fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json() };
  };
  try {
    await seedDemoRoom(store, { id: 'room-a' });
    await seedDemoRoom(store, { id: 'room-b' });
    const secret = (await store.get('agents', 'yh')).memory[0];
    assert.ok(secret);
    assert.equal((await call('/api/rooms/room-a/agent/shared', 'yh', { text: secret, shared: false })).status, 200);

    const allocA = await call('/api/rooms/room-a/expenses/room-a-izakaya/allocate', 'me');
    assert.equal(allocA.status, 200);
    assert.ok(!gemini.prompts.at(-1).includes(secret), '끈 방의 배분에 가지 않는다');
    await call('/api/rooms/room-b/expenses/room-b-izakaya/allocate', 'me');
    assert.ok(gemini.prompts.at(-1).includes(secret), '다른 방에는 간다');

    // 중재 프롬프트도 같은 길을 거친다
    const orch = createOrchestrator({ store, gemini, clock: () => new Date('2026-11-10T03:00:00Z') });
    const d = await orch.raiseDispute('room-a', { by: 'yh', expenseId: 'room-a-izakaya', claim: '술은 안 마셨어요' });
    const open = (await store.list('disputes', { roomId: 'room-a' })).find((x) => x.id === d.id);
    if (open.status === 'open') await orch.mediate('room-a', d.id, 'yh');
    assert.ok(!gemini.prompts.at(-1).includes(secret), '끈 방의 중재에 가지 않는다');
    assert.match(gemini.prompts.at(-1), /술은 안 마셨어요/, '중재 프롬프트가 맞다');

    // 공유를 바꾸면 기억이 달라진 것이니 다시 나눌 수 있다
    const seen = async () => (await (await fetch(`${url}/api/rooms/room-a`, { headers: { 'x-demo-user': 'yh' } })).json());
    assert.equal((await seen()).expenses.find((e) => e.id === 'room-a-izakaya').allocFresh, true);
    assert.deepEqual([(await seen()).myAgent.sharedCount, (await seen()).myAgent.memoryCount], [0, 1]);
    await call('/api/rooms/room-a/agent/shared', 'yh', { text: secret, shared: true });
    assert.equal((await seen()).expenses.find((e) => e.id === 'room-a-izakaya').allocFresh, false);
    assert.deepEqual((await store.get('agents', 'yh')).memoryHidden, {});
  } finally {
    server.close();
  }
});

test('방별 공유: 기억을 고쳐도 끈 상태가 유지되고, 지우면 흔적이 남지 않는다', async () => {
  const { settings, store } = await setup();
  await settings.addMemory('yh', '비밀 기억');
  await settings.shareMemory('yh', 'r1', '비밀 기억', false);
  await settings.editMemory('yh', '비밀 기억', '고친 기억');
  const room = (id) => ({ id, members: [{ uid: 'yh', name: '영희' }] });
  assert.ok(!(await roomMemory(store, room('r1'))).yh.includes('고친 기억'));
  assert.ok((await roomMemory(store, room('r2'))).yh.includes('고친 기억'));
  await settings.deleteMemory('yh', '고친 기억');
  assert.deepEqual((await store.get('agents', 'yh')).memoryHidden, { r1: [] });
  await assert.rejects(settings.shareMemory('yh', 'r1', '없는 기억', false), (e) => e.status === 404);
  assert.deepEqual(sharedMemory(null, 'r1'), []);
});

// ---------------------------------------------------------------- 받을 계좌: 사람마다 하나
async function twoRooms(store = new MemoryStore()) {
  const ctx = await setup({ store });
  await seedDemoRoom(store, { id: 'demo-u' });
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { autoAccept: 1_000_000, sendWhen: 'now', onDispute: 'ask' } });
  }
  await ctx.orch.sendInvoices(ROOM, 'me');
  await ctx.orch.sendInvoices('demo-u', 'me');
  return ctx;
}
const NEW_ACCOUNT = { bank: '국민은행', accountNo: '123-456-789012', holder: '나' };

test('계좌를 바꾸면 그 사람이 받을 모든 방의 대기 중 송금 링크가 함께 바뀐다', async () => {
  const ctx = await twoRooms();
  const list = async (id) => ctx.store.list('transfers', { roomId: id });
  const sent = await ctx.orch.markSent(ROOM, pair(await list(ROOM), 'cs', 'me').id, 'cs');
  await ctx.orch.setPayout(ROOM, 'me', NEW_ACCOUNT);
  for (const id of [ROOM, 'demo-u']) {
    const t = pair(await list(id), 'ms', 'me');
    assert.match(t.link, /accountNo=123456789012/, id);
    assert.equal(t.fallback.bank, 'KB국민은행');
    assert.ok((await ctx.store.listEvents(id)).some((e) => e.kind === 'payout_set' && /바꿨어요/.test(e.text)));
  }
  // 이미 보냈다고 한 송금은 옛 계좌 그대로(새 계좌로 또 보내지 않게), 남이 받는 송금도 그대로
  assert.deepEqual((await ctx.store.get('transfers', sent.id)).link, sent.link);
  assert.match(pair(await list(ROOM), 'cs', 'yh').link, /accountNo=100000000003/);
});

test('처음 계좌를 정하면 비어 있던 링크가 모든 방에서 채워지고 할 일이 사라진다', async () => {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: ROOM });
  await seedDemoRoom(store, { id: 'demo-u' });
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { autoAccept: 1_000_000, sendWhen: 'now', onDispute: 'ask' }, ...(uid === 'me' ? { payout: null } : {}) });
  }
  const orch = createOrchestrator({ store, clock: () => new Date('2026-11-10T03:00:00Z') });
  await orch.sendInvoices(ROOM, 'me');
  await orch.sendInvoices('demo-u', 'me');
  assert.equal(pair(await store.list('transfers', { roomId: 'demo-u' }), 'ms', 'me').link, null);
  await orch.setPayout(ROOM, 'me', NEW_ACCOUNT); // 한 방에서 등록해도
  const t = pair(await store.list('transfers', { roomId: 'demo-u' }), 'ms', 'me'); // 다른 방까지 채워진다
  assert.match(t.link, /accountNo=123456789012/);
  const room = await store.get('rooms', 'demo-u');
  assert.ok(!pendingActions({ room, transfers: await store.list('transfers', { roomId: 'demo-u' }) }).some((a) => a.type === 'set_payout'));
});

test('암호화 저장소: 여러 방을 고쳐도 저장소에는 잠긴 글자만 남고, 규칙·기억은 읽을 수 있다', async () => {
  const inner = new MemoryStore();
  const store = encryptedStore(inner, Buffer.alloc(32, 7));
  const ctx = await twoRooms(store);
  await ctx.settings.updateRules('me', { autoAccept: 12345 });
  await ctx.settings.addMemory('me', '새 기억');
  await ctx.orch.setPayout(ROOM, 'me', NEW_ACCOUNT);
  const raw = JSON.stringify([await inner.get('agents', 'me'), await inner.list('transfers', { to: 'me' })]);
  assert.ok(!raw.includes('123456789012') && !raw.includes('123-456-789012'));
  assert.ok(raw.includes('새 기억') && raw.includes('12345'));
  assert.equal((await ctx.store.get('agents', 'me')).payout.accountNo, '123-456-789012');
});

// ---------------------------------------------------------------- 처음 설정
test('처음 설정: 기본값은 묻기 위주이고, 마치면 규칙·기억·완료 시각이 남는다', async () => {
  const { settings, store } = await setup();
  const fresh = await settings.get('new');
  assert.deepEqual(fresh.rules, DEFAULT_RULES);
  assert.deepEqual([fresh.onboardedAt, fresh.memory, fresh.payout, fresh.plan, fresh.memoryLimit], [null, [], null, 'free', 5]);
  assert.equal(await store.get('agents', 'new'), null, '읽기만 해서는 문서를 만들지 않는다');
  assert.equal((await settings.summary('new', ROOM)).onboarded, false);

  const v = await settings.finishOnboarding('new', { rules: { autoAccept: 30_000, sendWhen: { payday: 10 }, onDispute: 'mediator', notify: 'all' }, memory: ' 고기를 먹지 않아요 ' });
  assert.deepEqual(v.rules, { autoAccept: 30_000, sendWhen: { payday: 10 }, onDispute: 'mediator', notify: 'all' });
  assert.deepEqual(v.memory, ['고기를 먹지 않아요']);
  assert.equal(v.onboardedAt, '2026-11-10T03:00:00.000Z');
  assert.equal(v.ruleHistory.length, 4);
});

test('처음 설정: 기본값으로 시작할 수 있고, 다시 해도 처음 완료 시각은 그대로다', async () => {
  const ctx = await setup();
  const v = await ctx.settings.finishOnboarding('new', {});
  assert.deepEqual([v.rules, v.memory, v.ruleHistory], [DEFAULT_RULES, [], []]);
  ctx.clock.now = new Date('2026-12-01T00:00:00Z');
  const again = await ctx.settings.finishOnboarding('new', { rules: { autoAccept: 1000 }, memory: '' });
  assert.equal(again.onboardedAt, v.onboardedAt);
  assert.equal(again.rules.autoAccept, 1000);
});

test('처음 설정: 잘못된 값이나 가득 찬 기억이면 아무것도 저장하지 않는다', async () => {
  const { settings, store } = await setup();
  await assert.rejects(settings.finishOnboarding('new', { rules: { autoAccept: -5 } }), (e) => e.status === 400);
  await assert.rejects(settings.finishOnboarding('new', { rules: { autoAccept: 100 }, memory: '가'.repeat(61) }), (e) => e.status === 400);
  assert.equal(await store.get('agents', 'new'), null);
});

// ---------------------------------------------------------------- API
test('API: 새 사용자의 처음 설정, 규칙, 기억, 계좌', async () => {
  const store = new MemoryStore();
  const server = createApp({ store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const req = async (path, uid, body) => {
    const res = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { ...(uid ? { 'x-demo-user': uid } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  try {
    const { roomId } = (await req('/api/dev/seed', null, {})).json;
    await store.delete('agents', 'me'); // 비서를 아직 설정하지 않은 새 사용자
    assert.ok(await store.get('agents', 'cs'), '다른 사람은 그대로');
    const first = (await req(`/api/rooms/${roomId}`, 'me')).json;
    assert.deepEqual([first.myAgent.onboarded, first.myAgent.autoAccept, first.myAgent.hasPayout], [false, 0, false]);
    assert.equal((await req(`/api/rooms/${roomId}`, 'cs')).json.myAgent.onboarded, true);

    const done = await req('/api/me/agent/onboarding', 'me', { rules: { autoAccept: 50_000, sendWhen: 'manual' } });
    assert.equal(done.status, 200);
    assert.equal((await req('/api/me/agent', 'me')).json.rules.sendWhen, 'manual');
    assert.equal((await req(`/api/rooms/${roomId}`, 'me')).json.myAgent.onboarded, true);

    assert.equal((await req(`/api/rooms/${roomId}/payout`, 'me', { bank: '토스뱅크', accountNo: '1000-1234-5678', holder: '나' })).status, 200);
    assert.deepEqual((await req('/api/me/agent', 'me')).json.payout, { bank: '토스뱅크', holder: '나', last4: '5678' });
    assert.equal((await store.get('agents', 'me')).payout.accountNo, '1000-1234-5678', '저장은 전체 번호');

    // 방 응답에는 계좌번호가 없다. 설정 전체는 본인 신원으로만 읽는다
    const summary = JSON.stringify((await req(`/api/rooms/${roomId}`, 'me')).json.myAgent);
    assert.ok(!summary.includes('1234') && summary.includes('"hasPayout":true'));
    const full = JSON.stringify((await req('/api/me/agent', 'cs')).json);
    assert.ok(full.includes('"holder":"철수"') && !full.includes('accountNo') && !full.includes('100000000002'), '설정 응답에도 계좌번호 전체는 없다');
    for (const path of ['/rules', '/memory', '/memory/edit', '/memory/delete', '/onboarding']) {
      const res = await fetch(`${url}/api/me/agent${path}`, { method: 'POST', headers: { 'x-demo-user': 'cs', 'content-type': 'application/json' }, body: 'null' });
      assert.ok(res.status < 500, `${path}: 본문이 null이어도 500이 아니다(${res.status})`);
    }
    assert.equal((await req('/api/me/agent/memory', 'me', { text: { a: 1 } })).status, 400);
    assert.equal((await req('/api/me/agent/onboarding', 'cs', { memory: ['x'] })).status, 400);

    assert.equal((await req('/api/me/agent')).status, 401);
    assert.equal((await req('/api/me/agent/rules', null, { autoAccept: 1 })).status, 401);
    assert.equal((await req(`/api/rooms/${roomId}/agent/shared`, 'stranger', { text: 'x', shared: false })).status, 403);
    assert.equal((await req('/api/me/agent/rules', 'me', { autoAccept: -1 })).status, 400);
    assert.equal((await req('/api/me/agent/memory', 'me', { text: '한 줄' })).json.memory[0], '한 줄');
    assert.equal((await req('/api/me/agent/memory/edit', 'me', { from: '한 줄', to: '두 줄' })).json.memory[0], '두 줄');
    assert.deepEqual((await req('/api/me/agent/memory/delete', 'me', { text: '두 줄' })).json.memory, []);
  } finally {
    server.close();
  }
});

test('없어진 방의 송금이 남아 있어도 계좌 저장은 끝까지 되고, 그 방에는 기록을 만들지 않는다', async () => {
  const ctx = await setup();
  await ctx.orch.sendInvoices(ROOM, 'me');
  await ctx.store.put('transfers', { id: 'ghost', roomId: 'gone', version: 1, from: 'cs', to: 'me', amount: 100, status: 'scheduled', remindAt: null, link: null, fallback: null });
  await ctx.orch.setPayout(ROOM, 'me', NEW_ACCOUNT);
  assert.deepEqual(await ctx.store.listEvents('gone'), []);
});

test('처음 설정: 기본값으로 시작을 다시 고르면 규칙이 기본값으로 돌아가고 기록에 남는다', async () => {
  const { settings } = await setup();
  await settings.updateRules('yh', { notify: 'all' });
  const v = await settings.finishOnboarding('yh', { rules: DEFAULT_RULES });
  assert.deepEqual(v.rules, DEFAULT_RULES);
  assert.ok(v.ruleHistory.some((h) => h.field === 'autoAccept' && h.to === 0));
  assert.ok(v.ruleHistory.some((h) => h.field === 'notify' && h.to === 'actions'));
});

test('설정 응답(규칙·기억 변경 포함)에는 계좌번호 전체가 없다', async () => {
  const { settings } = await setup();
  for (const v of [await settings.get('cs'), await settings.updateRules('cs', { autoAccept: 1 }), await settings.addMemory('cs', '새 기억')]) {
    assert.deepEqual(v.payout, { bank: '토스뱅크', holder: '철수', last4: '0002' });
    assert.ok(!JSON.stringify(v).includes('100000000002'));
  }
  assert.equal((await settings.get('nobody')).payout, null);
});

test('한 사람이 규칙을 바꿔도 다른 사람의 설정과 청구에는 영향이 없다', async () => {
  const ctx = await setup();
  const yh = await ctx.store.get('agents', 'yh');
  await ctx.settings.updateRules('cs', { autoAccept: 0 });
  await ctx.settings.addMemory('cs', '철수만의 기억');
  assert.deepEqual(await ctx.store.get('agents', 'yh'), yh);
});

// ---------------------------------------------------------------- 표시
test('알림 수준: 확인할 일만이면 내 할 일만 알리고, 모든 진행 상황이면 다 알린다', () => {
  const mine = { action: { type: 'answer_invoice', for: 'me' } };
  const others = { action: { type: 'answer_invoice', for: 'cs' } };
  const plain = { kind: 'invoice_accepted' };
  assert.deepEqual([mine, others, plain].map((e) => notifies(e, 'me', 'actions')), [true, false, false]);
  assert.deepEqual([mine, others, plain].map((e) => notifies(e, 'me', 'all')), [true, true, true]);
  assert.equal(notifies(plain, 'me', undefined), false, '기본값은 확인할 일만');
});

test('설정 화면: 초안과 규칙이 서로 바뀌어도 값이 같다', () => {
  for (const sendWhen of ['now', 'manual', { payday: 25 }]) {
    const rules = { autoAccept: 30_000, sendWhen, onDispute: 'evidence', notify: 'all' };
    assert.deepEqual(rulesFromDraft(draftFromRules(rules)), rules);
  }
  assert.equal(rulesFromDraft({ ...draftFromRules(DEFAULT_RULES), autoAccept: '5,000원' }).autoAccept, 5000);
});

test('설정 화면: 기억과 규칙 기록의 글자를 이스케이프하고, 방별 공유 상태를 보여 준다', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = memoryRowsHtml({ memory: [evil, '평범'], memoryHidden: { r1: ['평범'] } }, 'r1');
  assert.ok(!html.includes('<img') && html.includes('&lt;img'));
  assert.match(html, /aria-pressed="true"[^>]*>이 방에 공유/);
  assert.match(html, /aria-pressed="false"[^>]*>공유 안 함/);
  assert.match(memoryRowsHtml({ memory: ['평범'], memoryHidden: { r1: ['평범'] } }, 'r2'), /이 방에 공유/, '다른 방에서는 공유');
  const log = historyHtml({ ruleHistory: [{ at: '2026-11-10T03:00:00Z', text: evil }] });
  assert.ok(!log.includes('<img'));
  assert.ok(!limitHtml({ autoAccept: '"><script>' }).includes('<script>'));
});

test('normalizeSettings: 빈 문서와 옛 문서(notify 없음)를 기본값으로 채우고 있던 값은 지킨다', () => {
  assert.deepEqual(normalizeSettings(null, 'u').rules, DEFAULT_RULES);
  const old = normalizeSettings({ uid: 'u', memory: ['m'], rules: { autoAccept: 5, sendWhen: { payday: 3 }, onDispute: 'evidence' } }, 'u');
  assert.deepEqual(old.rules, { autoAccept: 5, sendWhen: { payday: 3 }, onDispute: 'evidence', notify: 'actions' });
  assert.deepEqual(old.memory, ['m']);
  assert.equal(ruleChangeText('notify', 'actions', 'all'), '알림: 확인할 일만 → 모든 진행 상황');
});
