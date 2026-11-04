// 비서는 사람마다 하나다. '내 계정'에서 정한 기본 설정(받을 계좌, 자동 수락 한도·보낼 시기·이의 처리)으로 모든 방에 들어가고,
// 방 안의 비서 설정에서 그 방에만 쓸 값을 따로 정할 수 있다(roomRules). 그 칸을 비우면 다시 기본 설정을 따른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { createAgentSettings, rulesIn, normalizeSettings } from '../src/agents/settings.mjs';
import { createApp } from '../src/app.mjs';
import { roomRuleHtml } from '../public/agent-panel.js';

const A = 'room-a';
const B = 'room-b';
async function twoRooms() {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: A });
  await seedDemoRoom(store, { id: B });
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { autoAccept: 1_000_000, sendWhen: 'now', onDispute: 'ask', notify: 'actions' } });
  }
  const clock = () => new Date('2026-11-10T03:00:00Z');
  return { store, orch: createOrchestrator({ store, clock }), settings: createAgentSettings({ store, clock }) };
}
const invoiceOf = async (store, roomId, uid) => (await store.list('invoices', { roomId })).find((i) => i.to === uid);

test('rulesIn: 이 방에서 정한 값만 기본 설정을 덮고, 알림 수준과 다른 방은 기본 설정 그대로다', () => {
  const s = { rules: { autoAccept: 50_000, sendWhen: 'manual', onDispute: 'mediator', notify: 'all' }, roomRules: { r1: { autoAccept: 0, sendWhen: { payday: 25 } } } };
  assert.deepEqual(rulesIn(s, 'r1'), { autoAccept: 0, sendWhen: { payday: 25 }, onDispute: 'mediator', notify: 'all' });
  assert.deepEqual(rulesIn(s, 'r2'), s.rules);
  assert.deepEqual(rulesIn({ rules: s.rules, roomRules: { r1: { autoAccept: -5, notify: 'none' } } }, 'r1'), s.rules, '이상한 값·방마다 나누지 않는 칸은 무시한다');
});

test('예전에 방에서 끈 규칙(rulesOff)은 그 방 전용 안전값(모두 묻기·바로·나에게 묻기)으로 옮겨 읽는다', () => {
  const doc = normalizeSettings({ rules: { autoAccept: 50_000 }, rulesOff: { r1: ['autoAccept', 'onDispute'] } }, 'u');
  assert.deepEqual(doc.roomRules, { r1: { autoAccept: 0, onDispute: 'ask' } });
  assert.equal(doc.rulesOff, undefined);
});

test('한 방의 자동 수락 한도를 0원으로 정하면 그 방 청구서만 묻고, 다른 방은 기본 설정대로 받는다', async () => {
  const { store, orch, settings } = await twoRooms();
  await settings.setRoomRules('cs', A, { autoAccept: 0 });
  await orch.sendInvoices(A, 'me');
  await orch.sendInvoices(B, 'me');
  assert.equal((await invoiceOf(store, A, 'cs')).status, 'asked');
  assert.equal((await invoiceOf(store, B, 'cs')).status, 'accepted');
});

test('보낼 시기를 한 방에서만 직접 보내기로 정한다', async () => {
  const { store, orch, settings } = await twoRooms();
  await settings.setRoomRules('cs', A, { sendWhen: 'manual' });
  await orch.sendInvoices(A, 'me');
  await orch.sendInvoices(B, 'me');
  const from = async (roomId) => (await store.list('transfers', { roomId })).find((t) => t.from === 'cs');
  assert.equal((await from(A)).manual, true);
  assert.equal((await from(B)).manual, undefined);
});

test('API: 방 멤버가 이 방 전용 값을 정하고 비우며, 방 요약에는 이 방에서 쓰는 값·정한 칸·기본 설정이 함께 온다', async () => {
  const { store } = await twoRooms();
  const server = createApp({ store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const req = async (path, uid, body) => {
    const res = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'x-demo-user': uid, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  try {
    const set = await req(`/api/rooms/${A}/agent/rules`, 'cs', { autoAccept: 0, onDispute: 'mediator' });
    assert.equal(set.status, 200);
    assert.deepEqual(set.json.roomRules, { [A]: { autoAccept: 0, onDispute: 'mediator' } });
    const inA = (await req(`/api/rooms/${A}`, 'cs')).json.myAgent;
    assert.deepEqual([inA.autoAccept, inA.onDispute, inA.custom], [0, 'mediator', ['autoAccept', 'onDispute']]);
    assert.equal(inA.defaults.autoAccept, 1_000_000, '기본 설정 값도 함께 알려 준다');
    const inB = (await req(`/api/rooms/${B}`, 'cs')).json.myAgent;
    assert.deepEqual([inB.autoAccept, inB.custom], [1_000_000, []], '다른 방은 기본 설정 그대로');
    assert.deepEqual((await req(`/api/rooms/${A}/agent/rules`, 'cs', { autoAccept: null })).json.roomRules, { [A]: { onDispute: 'mediator' } }, '비우면 그 칸만 기본 설정을 따른다');
    assert.deepEqual((await req(`/api/rooms/${A}/agent/rules`, 'cs', { onDispute: null })).json.roomRules, {}, '다 비우면 흔적이 없다');
    assert.equal((await req(`/api/rooms/${A}/agent/rules`, 'cs', { notify: 'all' })).status, 400, '알림 수준은 방마다 나누지 않는다');
    assert.equal((await req(`/api/rooms/${A}/agent/rules`, 'cs', { autoAccept: -1 })).status, 400);
    assert.equal((await req(`/api/rooms/${A}/agent/rules`, 'stranger', { autoAccept: 0 })).status, 403);
  } finally {
    server.close();
  }
});

test('API: 내 계정에서 방 없이 받을 계좌를 정하고, 끝 4자리만 돌아온다', async () => {
  const { store } = await twoRooms();
  const server = createApp({ store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const post = (path, uid, body) => fetch(url + path, { method: 'POST', headers: { 'x-demo-user': uid, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/api/me/payout', 'cs', { bank: '토스뱅크', accountNo: '1000-2000-3000', holder: '철수' })).status, 200);
    const view = await (await fetch(`${url}/api/me/agent`, { headers: { 'x-demo-user': 'cs' } })).json();
    assert.deepEqual(view.payout, { bank: '토스뱅크', holder: '철수', last4: '3000' });
    assert.equal((await post('/api/me/payout', 'cs', { bank: '', accountNo: '12' })).status, 400);
  } finally {
    server.close();
  }
});

test('방 비서 설정: 규칙마다 기본 설정을 따를지 이 방에서만 정할지 고르고, 기본 설정 값을 함께 보여 준다', () => {
  const follow = roomRuleHtml('autoAccept', { custom: false, defaultText: '₩30,000 이하는 비서가 받아요', body: '<input data-ag="autoAccept">' });
  assert.match(follow, /role="radio" aria-checked="true"[^>]*data-action="room-rule-scope"[^>]*data-field="autoAccept"[^>]*data-id="default"[^>]*>기본 설정/);
  assert.match(follow, /₩30,000 이하는 비서가 받아요/);
  assert.ok(!follow.includes('data-ag="autoAccept"'), '기본 설정을 따르는 동안은 값을 고치는 칸이 없다');
  const custom = roomRuleHtml('autoAccept', { custom: true, defaultText: '₩30,000 이하는 비서가 받아요', body: '<input data-ag="autoAccept">' });
  assert.match(custom, /aria-checked="true"[^>]*data-id="room"[^>]*>이 방에서만/);
  assert.ok(custom.includes('data-ag="autoAccept"'));
});
