// 청구 오케스트레이션: 방 version마다 청구서를 한 번만 보내고, 각자의 비서가 규칙대로 답한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { evidenceFor } from '../src/agents/evidence.mjs';
import { pendingActions } from '../src/actions.mjs';

async function setup() {
  const store = new MemoryStore();
  const room = await seedDemoRoom(store, { id: 'demo-t' });
  const orch = createOrchestrator({ store, gemini: null, clock: () => new Date('2026-11-10T03:00:00Z'), evidenceFor });
  return { store, room, orch };
}
const statusOf = (invoices) => Object.fromEntries(invoices.map((i) => [i.to, i.status]));

test('철수(한도 15만)는 수락, 민수는 근거로 이의, 영희·나는 받을 돈이라 수락', async () => {
  const { orch } = await setup();
  const { version, invoices } = await orch.sendInvoices('demo-t', 'me');
  assert.equal(version, 1);
  assert.deepEqual(statusOf(invoices), { me: 'accepted', cs: 'accepted', yh: 'accepted', ms: 'disputed' });
  assert.deepEqual(invoices.map((i) => i.id).sort(), ['demo-t:v1:cs', 'demo-t:v1:me', 'demo-t:v1:ms', 'demo-t:v1:yh']);
  assert.equal(invoices.find((i) => i.to === 'cs').net, -132617);
});

test('민수의 이의는 2차 바에 대한 열린 이의로 남는다', async () => {
  const { store, orch } = await setup();
  await orch.sendInvoices('demo-t', 'me');
  const [d] = await store.list('disputes', { roomId: 'demo-t' });
  assert.equal(d.by, 'ms');
  assert.equal(d.expenseId, 'demo-t-bar');
  assert.equal(d.evidence[0].kind, 'left_at');
  assert.match(d.claim, /22:55/);
});

test('sendInvoices는 같은 version에서 멱등', async () => {
  const { store, orch } = await setup();
  await orch.sendInvoices('demo-t', 'me');
  const events = (await store.listEvents('demo-t')).length;
  const again = await orch.sendInvoices('demo-t', 'me');
  assert.equal(again.invoices.length, 4);
  assert.equal((await store.list('invoices', { roomId: 'demo-t' })).length, 4);
  assert.equal((await store.listEvents('demo-t')).length, events);
});

test('version이 바뀌면 다시 평가하고 이전 청구서를 superseded로', async () => {
  const { store, orch } = await setup();
  await orch.sendInvoices('demo-t', 'me');
  const room = await store.get('rooms', 'demo-t');
  await store.put('rooms', { ...room, version: 2 });
  const { version, invoices } = await orch.sendInvoices('demo-t', 'me');
  assert.equal(version, 2);
  assert.ok(invoices.every((i) => i.id.includes(':v2:')));
  const old = (await store.list('invoices', { roomId: 'demo-t' })).filter((i) => i.version === 1);
  assert.deepEqual(old.map((i) => i.status).sort(), ['disputed', 'superseded', 'superseded', 'superseded']);
  assert.ok((await store.listEvents('demo-t')).some((e) => e.text === '지출이 바뀌어 다시 보내요'));
});

test('확인 필요 줄이 있으면 409', async () => {
  const { store, orch } = await setup();
  const izakaya = await store.get('expenses', 'demo-t-izakaya');
  await store.put('expenses', { ...izakaya, alloc: { ochazuke: { consumers: ['cs'], confidence: 0.3, reason: '' } } });
  await assert.rejects(orch.sendInvoices('demo-t', 'me'), (e) => e.status === 409 && e.message === '확인이 필요한 줄이 있어요');
});

test('한도를 넘으면 주인에게 묻고, 본인만 답할 수 있다', async () => {
  const { store, orch } = await setup();
  const cs = await store.get('agents', 'cs');
  await store.put('agents', { ...cs, rules: { ...cs.rules, autoAccept: 100000 } });
  const { invoices } = await orch.sendInvoices('demo-t', 'me');
  const mine = invoices.find((i) => i.to === 'cs');
  assert.equal(mine.status, 'asked');
  const actions = pendingActions({ expenses: [], invoices: await store.list('invoices', { roomId: 'demo-t' }) });
  assert.deepEqual(actions.map((a) => [a.type, a.for, a.ref]), [['answer_invoice', 'cs', mine.id]]);
  await assert.rejects(orch.answerInvoice('demo-t', mine.id, 'yh', { decision: 'accept' }), (e) => e.status === 403);
  const { invoice } = await orch.answerInvoice('demo-t', mine.id, 'cs', { decision: 'accept' });
  assert.deepEqual([invoice.status, invoice.decidedBy], ['accepted', 'human']);
  await assert.rejects(orch.answerInvoice('demo-t', mine.id, 'cs', { decision: 'accept' }), (e) => e.status === 409);
});

test('사람이 이의를 고르면 지출은 있어야 하고 이의가 열린다', async () => {
  const { store, orch } = await setup();
  const cs = await store.get('agents', 'cs');
  await store.put('agents', { ...cs, rules: { ...cs.rules, autoAccept: 0 } });
  await orch.sendInvoices('demo-t', 'me');
  const id = 'demo-t:v1:cs';
  await assert.rejects(orch.answerInvoice('demo-t', id, 'cs', { decision: 'dispute' }), (e) => e.status === 400);
  await orch.answerInvoice('demo-t', id, 'cs', { decision: 'dispute', expenseId: 'demo-t-limo', claim: '리무진은 내가 안 탔어요' });
  const mine = (await store.list('disputes', { roomId: 'demo-t' })).find((d) => d.by === 'cs');
  assert.deepEqual([mine.expenseId, mine.claim, mine.status], ['demo-t-limo', '리무진은 내가 안 탔어요', 'open']);
});

test('이의는 여러 지출에 한 번에 내고, 맞지 않는 점을 비우면 기본 문구로 채운다', async () => {
  const { store, orch } = await setup();
  const cs = await store.get('agents', 'cs');
  await store.put('agents', { ...cs, rules: { ...cs.rules, autoAccept: 0 } });
  await orch.sendInvoices('demo-t', 'me');
  const id = 'demo-t:v1:cs';
  const byCs = async () => (await store.list('disputes', { roomId: 'demo-t' })).filter((d) => d.by === 'cs');
  // 하나라도 맞지 않으면 아무 이의도 만들지 않고 청구서도 그대로 둔다
  await assert.rejects(orch.answerInvoice('demo-t', id, 'cs', { decision: 'dispute', disputes: [{ expenseId: 'demo-t-limo', claim: '' }, { expenseId: 'nope', claim: '' }] }), (e) => e.status === 400);
  assert.equal((await byCs()).length, 0);
  assert.equal((await store.get('invoices', id)).status, 'asked');

  const { invoice } = await orch.answerInvoice('demo-t', id, 'cs', { decision: 'dispute', disputes: [
    { expenseId: 'demo-t-bar', claim: '23:10에 자리를 떠났어요.' }, { expenseId: 'demo-t-limo', claim: '  ' }, { expenseId: 'demo-t-bar', claim: '두 번' },
  ] });
  assert.equal(invoice.status, 'disputed');
  const mine = await byCs();
  assert.deepEqual(mine.map((d) => d.expenseId).sort(), ['demo-t-bar', 'demo-t-limo'], '같은 지출은 한 번만');
  assert.equal(mine.find((d) => d.expenseId === 'demo-t-bar').claim, '23:10에 자리를 떠났어요.');
  assert.match(mine.find((d) => d.expenseId === 'demo-t-limo').claim, /공항 리무진 버스/, '비운 이유는 지출 이름을 넣은 기본 문구');
});

test('라우트: 청구서 보내기와 남의 청구서 답하기(403)', async () => {
  const { createApp } = await import('../src/app.mjs');
  const store = new MemoryStore();
  const server = createApp({ store, env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const call = (path, uid, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body ?? {}) });
  try {
    const roomId = (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;
    const sent = await (await call(`/api/rooms/${roomId}/invoices/send`, 'me')).json();
    assert.equal(sent.invoices.length, 4);
    const res = await call(`/api/rooms/${roomId}/invoices/${encodeURIComponent(`${roomId}:v1:cs`)}/answer`, 'yh', { decision: 'accept' });
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});
