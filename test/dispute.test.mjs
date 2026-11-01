// 이의와 중재: 근거가 있는 이의는 중재 비서가 영수증 주문 시각으로 다시 나누고, 양쪽이 동의하면 청구서를 다시 보낸다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { evidenceFor } from '../src/agents/evidence.mjs';
import { pendingActions } from '../src/actions.mjs';

// 줄마다 모두를 넣는 가짜 Gemini(떠난 사람도 넣는다)
const greedy = {
  model: 'gemini-test-flash',
  async generate({ schema }) {
    const props = schema.properties.lines.items.properties;
    return { summary: '모두 함께 나눠요.', lines: props.id.enum.map((id) => ({ id, consumers: props.consumers.items.enum, confidence: 0.9, reason: '테스트' })) };
  },
};

async function setup({ gemini = null } = {}) {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: 'demo-t' });
  const orch = createOrchestrator({ store, gemini, clock: () => new Date('2026-11-10T03:00:00Z'), evidenceFor });
  await orch.sendInvoices('demo-t', 'me');
  const [dispute] = await store.list('disputes', { roomId: 'demo-t' });
  return { store, orch, dispute };
}
const actionsFor = async (store, uid) => pendingActions({
  expenses: await store.list('expenses', { roomId: 'demo-t' }),
  invoices: await store.list('invoices', { roomId: 'demo-t' }),
  disputes: await store.list('disputes', { roomId: 'demo-t' }),
}).filter((a) => a.for === uid);

test('지출을 낸 사람의 규칙이 mediator면 이의를 바로 중재한다(Gemini 없으면 규칙 중재)', async () => {
  const { store, dispute } = await setup();
  assert.equal(dispute.status, 'proposed');
  assert.equal(dispute.proposal.source, 'rules');
  assert.match(dispute.proposal.summary, /22:55/);
  assert.ok((await store.listEvents('demo-t')).some((e) => e.from === 'mediator' && e.kind === 'dispute_proposed'));
});

test('가짜 Gemini가 떠난 사람을 넣어도 제안에서 빠진다', async () => {
  const { dispute } = await setup({ gemini: greedy });
  assert.equal(dispute.proposal.source, 'gemini-test-flash');
  assert.deepEqual(dispute.proposal.alloc['b-whisky'].consumers, ['me', 'cs', 'yh']);
  assert.ok(dispute.proposal.alloc['b-nuts'].consumers.includes('ms'));
});

test('근거와 맞는 제안이면 이의를 낸 비서가 자동 동의하고, 낸 사람에게 동의를 묻는다', async () => {
  const { store, dispute } = await setup();
  assert.deepEqual(dispute.agreedBy, ['ms']);
  assert.deepEqual((await actionsFor(store, 'me')).map((a) => [a.type, a.ref]), [['agree_dispute', dispute.id]]);
  assert.deepEqual(await actionsFor(store, 'ms'), []);
});

test('한쪽만 동의하면 지출 그대로', async () => {
  const { store } = await setup();
  assert.equal((await store.get('expenses', 'demo-t-bar')).split, 'equal');
  assert.equal((await store.get('rooms', 'demo-t')).version, 1);
});

test('양쪽 동의 → version 증가, 새 청구서, 민수 몫 감소, 다시 이의하지 않음', async () => {
  const { store, orch, dispute } = await setup();
  const before = await store.get('invoices', 'demo-t:v1:ms');
  await orch.agree('demo-t', dispute.id, 'me');
  assert.equal((await store.get('rooms', 'demo-t')).version, 2);
  const bar = await store.get('expenses', 'demo-t-bar');
  assert.equal(bar.split, 'items');
  assert.ok(Object.values(bar.alloc).every((a) => a.confirmed));
  const after = await store.get('invoices', 'demo-t:v2:ms');
  assert.ok(after.owed < before.owed, `${after.owed} < ${before.owed}`);
  assert.equal(after.status, 'asked'); // 해결된 이의는 다시 내지 않고, 한도대로 주인에게 묻는다
  assert.equal((await store.get('disputes', dispute.id)).status, 'resolved');
  assert.equal((await store.list('disputes', { roomId: 'demo-t' })).length, 1);
});

test('당사자가 아니면 동의 403, 중재안이 없으면 409', async () => {
  const { store, orch, dispute } = await setup();
  await assert.rejects(orch.agree('demo-t', dispute.id, 'yh'), (e) => e.status === 403);
  await store.put('disputes', { ...dispute, status: 'open' });
  await assert.rejects(orch.agree('demo-t', dispute.id, 'me'), (e) => e.status === 409);
});

test('낸 사람이 중재를 맡기지 않았으면 열린 이의로 묻고, 중재를 부르면 제안이 된다', async () => {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: 'demo-t' });
  const me = await store.get('agents', 'me');
  await store.put('agents', { ...me, rules: { ...me.rules, onDispute: 'ask' } });
  const orch = createOrchestrator({ store, clock: () => new Date('2026-11-10T03:00:00Z'), evidenceFor });
  await orch.sendInvoices('demo-t', 'me');
  const [d] = await store.list('disputes', { roomId: 'demo-t' });
  assert.equal(d.status, 'open');
  assert.deepEqual((await actionsFor(store, 'me')).map((a) => a.type), ['agree_dispute']);
  await assert.rejects(orch.mediate('demo-t', d.id, 'yh'), (e) => e.status === 403);
  const proposed = await orch.mediate('demo-t', d.id, 'me');
  assert.equal(proposed.status, 'proposed');
});
