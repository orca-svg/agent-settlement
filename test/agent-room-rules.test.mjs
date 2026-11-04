// 비서는 사람마다 하나이고 모든 방에 기본으로 적용된다. 방마다 '이 방에는 적용하지 않을' 규칙만 끌 수 있고,
// 끈 방에서는 그 규칙만 안전한 기본값(모든 청구서 먼저 묻기, 바로 보내기, 이의는 나에게 묻기)으로 돌아간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { createAgentSettings, rulesIn } from '../src/agents/settings.mjs';
import { createApp } from '../src/app.mjs';
import { ruleScopeHtml } from '../public/agent-panel.js';

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

test('rulesIn: 끈 규칙만 기본값으로 돌아가고, 알림 수준과 다른 방은 그대로다', () => {
  const s = { rules: { autoAccept: 50_000, sendWhen: 'manual', onDispute: 'mediator', notify: 'all' }, rulesOff: { r1: ['autoAccept', 'sendWhen'] } };
  assert.deepEqual(rulesIn(s, 'r1'), { autoAccept: 0, sendWhen: 'now', onDispute: 'mediator', notify: 'all' });
  assert.deepEqual(rulesIn(s, 'r2'), s.rules);
  assert.deepEqual(rulesIn({ rules: s.rules }, 'r1'), s.rules, '끈 방이 없는 옛 문서');
});

test('자동 수락 한도를 한 방에서 끄면 그 방 청구서만 묻고, 다른 방은 그대로 받는다', async () => {
  const { store, orch, settings } = await twoRooms();
  await settings.setRuleInRoom('cs', A, 'autoAccept', false);
  await orch.sendInvoices(A, 'me');
  await orch.sendInvoices(B, 'me');
  assert.equal((await invoiceOf(store, A, 'cs')).status, 'asked');
  assert.equal((await invoiceOf(store, B, 'cs')).status, 'accepted');
});

test('보낼 시기를 한 방에서 끄면 그 방은 바로 보내기로 한다', async () => {
  const { store, orch, settings } = await twoRooms();
  await settings.updateRules('cs', { sendWhen: 'manual' });
  await settings.setRuleInRoom('cs', A, 'sendWhen', false);
  await orch.sendInvoices(A, 'me');
  await orch.sendInvoices(B, 'me');
  const from = async (roomId) => (await store.list('transfers', { roomId })).find((t) => t.from === 'cs');
  assert.equal((await from(A)).manual, undefined);
  assert.equal((await from(B)).manual, true);
});

test('API: 방 멤버가 이 방에 적용할 규칙을 끄고 켜며, 방 요약에는 이 방에서 실제로 쓰는 값이 온다', async () => {
  const { store } = await twoRooms();
  const server = createApp({ store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const req = async (path, uid, body) => {
    const res = await fetch(url + path, { method: body ? 'POST' : 'GET', headers: { 'x-demo-user': uid, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, json: await res.json() };
  };
  try {
    const off = await req(`/api/rooms/${A}/agent/rule`, 'cs', { field: 'autoAccept', on: false });
    assert.equal(off.status, 200);
    assert.deepEqual(off.json.rulesOff, { [A]: ['autoAccept'] });
    const inA = (await req(`/api/rooms/${A}`, 'cs')).json.myAgent;
    assert.deepEqual([inA.autoAccept, inA.off], [0, ['autoAccept']], '이 방에서는 한도 없이 모두 묻는다');
    assert.equal((await req(`/api/rooms/${B}`, 'cs')).json.myAgent.autoAccept, 1_000_000, '다른 방은 그대로');
    assert.deepEqual((await req(`/api/rooms/${A}/agent/rule`, 'cs', { field: 'autoAccept', on: true })).json.rulesOff, {}, '다시 켜면 흔적이 없다');
    assert.equal((await req(`/api/rooms/${A}/agent/rule`, 'cs', { field: 'notify', on: false })).status, 400, '알림 수준은 방마다 끄지 않는다');
    assert.equal((await req(`/api/rooms/${A}/agent/rule`, 'stranger', { field: 'autoAccept', on: false })).status, 403);
  } finally {
    server.close();
  }
});

test('설정 화면: 규칙마다 이 방에 적용 여부를 누를 수 있고, 끈 방에서 무엇으로 하는지 알려 준다', () => {
  const on = ruleScopeHtml('autoAccept', false);
  assert.match(on, /aria-pressed="true"[^>]*data-action="rule-scope"[^>]*data-field="autoAccept"[^>]*>이 방에 적용/);
  const off = ruleScopeHtml('autoAccept', true);
  assert.match(off, /aria-pressed="false"/);
  assert.match(off, /이 방에서는 모든 청구서를 먼저 물어봐요/);
});
