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

// ---------------------------------------------------------------- 중재안 거부: 이의를 끝내고 지금 배분 그대로 정산한다
const transfersOf = (store) => store.list('transfers', { roomId: 'demo-t' });
const eventsOf = async (store, kind) => (await store.listEvents('demo-t')).filter((e) => e.kind === kind);

test('지출을 낸 사람이 거부하면 이의가 끝나고(기각) 배분은 그대로, 송금이 이어진다', async () => {
  const { store, orch, dispute } = await setup();
  assert.equal((await transfersOf(store)).length, 0); // 열린 이의가 있는 동안은 송금이 없다
  const out = await orch.reject('demo-t', dispute.id, 'me', { reason: '술은 같이 마셨어요' });
  assert.deepEqual([out.status, out.rejectedBy, out.rejectReason], ['dismissed', 'me', '술은 같이 마셨어요']);
  assert.equal((await store.get('disputes', dispute.id)).status, 'dismissed');
  assert.equal((await store.get('expenses', 'demo-t-bar')).split, 'equal'); // 중재안은 반영하지 않는다
  assert.equal((await store.get('rooms', 'demo-t')).version, 1);
  const transfers = await transfersOf(store);
  assert.ok(transfers.length > 0 && transfers.every((t) => t.version === 1));
  const [ev] = await eventsOf(store, 'dispute_dismissed');
  assert.equal(ev.from, 'me');
  assert.match(ev.text, /거부/);
  assert.match(ev.meta, /술은 같이 마셨어요/); // 사유가 양쪽 비서끼리 기록에 남는다
  assert.deepEqual((await actionsFor(store, 'me')).filter((a) => a.type === 'agree_dispute'), []);
});

test('이의를 낸 사람이 거부하면 철회. 이미 동의했어도 이의가 끝난다', async () => {
  const { store, orch, dispute } = await setup();
  assert.deepEqual(dispute.agreedBy, ['ms']); // 근거 규칙으로 먼저 동의해 둔 상태
  const out = await orch.reject('demo-t', dispute.id, 'ms');
  assert.deepEqual([out.status, out.rejectedBy, out.rejectReason], ['withdrawn', 'ms', undefined]);
  const [ev] = await eventsOf(store, 'dispute_withdrawn');
  assert.equal(ev.from, 'ms');
  assert.ok(!ev.meta); // 사유를 안 적으면 사실만 남긴다
  assert.ok((await transfersOf(store)).length > 0);
});

test('거부는 당사자만(403), 중재안이 있는 이의에만(409)', async () => {
  const { store, orch, dispute } = await setup();
  await assert.rejects(orch.reject('demo-t', dispute.id, 'yh'), (e) => e.status === 403);
  await store.put('disputes', { ...dispute, status: 'open' });
  await assert.rejects(orch.reject('demo-t', dispute.id, 'me'), (e) => e.status === 409);
  await store.put('disputes', dispute);
  await orch.agree('demo-t', dispute.id, 'me'); // 양쪽이 동의해 이미 끝난 이의
  await assert.rejects(orch.reject('demo-t', dispute.id, 'me'), (e) => e.status === 409);
});

test('이미 거부로 끝난 이의에는 동의도, 다른 쪽의 거부도 409', async () => {
  const { orch, dispute } = await setup();
  await orch.reject('demo-t', dispute.id, 'me');
  await assert.rejects(orch.agree('demo-t', dispute.id, 'ms'), (e) => e.status === 409);
  await assert.rejects(orch.reject('demo-t', dispute.id, 'ms'), (e) => e.status === 409);
});

test('같은 거부를 두 번 보내도 기록·송금이 늘지 않는다', async () => {
  const { store, orch, dispute } = await setup();
  const first = await orch.reject('demo-t', dispute.id, 'me', { reason: '같이 마셨어요' });
  const events = (await store.listEvents('demo-t')).length;
  const transfers = (await transfersOf(store)).length;
  const again = await orch.reject('demo-t', dispute.id, 'me', { reason: '다른 말' });
  assert.deepEqual(again, first); // 처음 남긴 사유 그대로
  assert.equal((await store.listEvents('demo-t')).length, events);
  assert.equal((await transfersOf(store)).length, transfers);
});

test('거부 사유는 한 줄, 100자까지만 남긴다', async () => {
  const { orch, dispute } = await setup();
  const out = await orch.reject('demo-t', dispute.id, 'me', { reason: `  같이\n\n마셨어요   ${'가'.repeat(200)}` });
  assert.ok(!/\s{2}|\n/.test(out.rejectReason));
  assert.equal(out.rejectReason.length, 100);
  assert.ok(out.rejectReason.startsWith('같이 마셨어요 가'));
});

test('거부로 끝난 이의는 다음 version 청구서에서 같은 근거로 다시 내지 않는다', async () => {
  const { store, orch, dispute } = await setup();
  await orch.reject('demo-t', dispute.id, 'me');
  await store.put('rooms', { ...(await store.get('rooms', 'demo-t')), version: 2 }); // 지출이 바뀌어 다시 보내는 경우
  await orch.sendInvoices('demo-t', 'me');
  assert.equal((await store.list('disputes', { roomId: 'demo-t' })).length, 1);
  assert.equal((await store.get('invoices', 'demo-t:v2:ms')).status, 'asked');
});

test('라우트: 거부는 당사자만, 두 번 보내도 같은 결과', async () => {
  const { createApp } = await import('../src/app.mjs');
  const server = createApp({ store: new MemoryStore(), env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const call = (path, uid, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body ?? {}) });
  try {
    const roomId = (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;
    await call(`/api/rooms/${roomId}/invoices/send`, 'me');
    const room = await (await fetch(`${url}/api/rooms/${roomId}`, { headers: { 'x-demo-user': 'me' } })).json();
    const path = `/api/rooms/${roomId}/disputes/${encodeURIComponent(room.disputes[0].id)}/reject`;
    assert.equal((await call(path, 'yh')).status, 403);
    const ok = await call(path, 'me', { reason: '같이 마셨어요' });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).status, 'dismissed');
    assert.equal((await call(path, 'me', { reason: '같이 마셨어요' })).status, 200);
    assert.equal((await call(path, 'ms')).status, 409);
    const after = await (await fetch(`${url}/api/rooms/${roomId}`, { headers: { 'x-demo-user': 'me' } })).json();
    assert.equal(after.disputes[0].status, 'dismissed');
    assert.ok(!after.actions.some((a) => a.type === 'agree_dispute'));
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------- 중재안 고치기(#62): 당사자가 줄별 사람을 고쳐 다시 제안한다
const allocOf = (d) => Object.fromEntries(Object.entries(d.proposal.alloc).map(([id, a]) => [id, a.consumers]));
// 민수도 위스키를 마셨다며 지출을 낸 사람(me)이 위스키 줄에 민수를 다시 넣는다. 고르는 순서는 아무래도 된다
const withWhisky = (d) => ({ ...allocOf(d), 'b-whisky': ['ms', 'me', 'cs', 'yh'] });

test('고치면 고친 사람만 동의한 새 안이 되고, 상대에게 다시 묻는다(지출은 그대로)', async () => {
  const { store, orch, dispute } = await setup();
  assert.deepEqual(dispute.agreedBy, ['ms']); // 민수의 비서가 근거 규칙으로 먼저 동의해 둔 상태
  const out = await orch.revise('demo-t', dispute.id, 'me', { alloc: withWhisky(dispute), rev: 0 });
  const bar = await store.get('expenses', 'demo-t-bar');
  assert.equal(out.status, 'proposed');
  assert.deepEqual(out.agreedBy, ['me']); // 먼저 해 둔 동의는 고친 안에 대한 동의가 아니다
  assert.deepEqual([out.proposal.source, out.proposal.revisedBy, out.proposal.rev], ['human', 'me', 1]);
  assert.deepEqual(out.proposal.alloc['b-whisky'].consumers, bar.present.filter((u) => ['me', 'cs', 'yh', 'ms'].includes(u))); // 함께 있던 사람 순서로
  assert.match(out.proposal.alloc['b-whisky'].reason, /고친 줄/);
  assert.deepEqual(out.proposal.alloc['b-nuts'], dispute.proposal.alloc['b-nuts']); // 고치지 않은 줄은 중재 비서의 안 그대로
  assert.deepEqual(await store.get('disputes', dispute.id), out);
  assert.equal(bar.split, 'equal');
  assert.equal((await store.get('rooms', 'demo-t')).version, 1);
  const forMs = await actionsFor(store, 'ms');
  assert.deepEqual(forMs.map((a) => [a.type, a.ref]), [['agree_dispute', dispute.id]]);
  assert.match(forMs[0].text, /중재안을 고쳤어요/);
  assert.deepEqual(await actionsFor(store, 'me'), []);
  const [ev] = await eventsOf(store, 'dispute_revised');
  assert.deepEqual([ev.from, ev.to, ev.action], ['me', 'ms', { type: 'agree_dispute', ref: dispute.id, for: 'ms' }]);
  assert.equal(ev.text, '‘2차 바’ 중재안을 고쳐 다시 제안했어요');
  assert.match(ev.meta, /당사자가 고친 배분/); // 비서 기록에서 중재 비서의 안과 구분된다
  assert.match(ev.meta, /위스키/);
});

test('상대가 고친 안에 동의하면 그 배분으로 다시 나누고 청구서를 다시 보낸다', async () => {
  const { store, orch, dispute } = await setup();
  const revised = await orch.revise('demo-t', dispute.id, 'me', { alloc: withWhisky(dispute) });
  const resolved = await orch.agree('demo-t', dispute.id, 'ms', { rev: 1 });
  assert.equal(resolved.status, 'resolved');
  const bar = await store.get('expenses', 'demo-t-bar');
  assert.equal(bar.split, 'items');
  assert.deepEqual(Object.fromEntries(Object.entries(bar.alloc).map(([id, a]) => [id, a.consumers])), allocOf(revised));
  assert.ok(Object.values(bar.alloc).every((a) => a.confirmed));
  assert.equal((await store.get('rooms', 'demo-t')).version, 2);
  assert.ok(await store.get('invoices', 'demo-t:v2:ms'));
  const [ev] = await eventsOf(store, 'dispute_resolved');
  assert.match(ev.text, /고친 배분대로/);
});

test('상대도 다시 고칠 수 있다. 그러면 처음 고친 사람에게 다시 묻는다', async () => {
  const { store, orch, dispute } = await setup();
  await orch.revise('demo-t', dispute.id, 'me', { alloc: withWhisky(dispute) });
  const back = await orch.revise('demo-t', dispute.id, 'ms', { alloc: allocOf(dispute), rev: 1 });
  assert.deepEqual([back.agreedBy, back.proposal.revisedBy, back.proposal.rev], [['ms'], 'ms', 2]);
  assert.deepEqual((await actionsFor(store, 'me')).map((a) => a.type), ['agree_dispute']);
  assert.deepEqual(await actionsFor(store, 'ms'), []);
});

test('본 안과 지금 안의 판(rev)이 다르면 동의·고치기 모두 409. 상대가 고친 줄을 모른 채 동의하지 않게', async () => {
  const { orch, dispute } = await setup();
  await orch.revise('demo-t', dispute.id, 'me', { alloc: withWhisky(dispute) });
  await assert.rejects(orch.agree('demo-t', dispute.id, 'ms', { rev: 0 }), (e) => e.status === 409);
  await assert.rejects(orch.revise('demo-t', dispute.id, 'ms', { alloc: allocOf(dispute), rev: 0 }), (e) => e.status === 409);
  assert.equal((await orch.agree('demo-t', dispute.id, 'ms', { rev: 1 })).status, 'resolved');
});

test('고치기는 당사자만(403), 중재안이 살아 있을 때만(409)', async () => {
  const { store, orch, dispute } = await setup();
  await assert.rejects(orch.revise('demo-t', dispute.id, 'yh', { alloc: withWhisky(dispute) }), (e) => e.status === 403);
  await store.put('disputes', { ...dispute, status: 'open' });
  await assert.rejects(orch.revise('demo-t', dispute.id, 'me', { alloc: withWhisky(dispute) }), (e) => e.status === 409);
  await store.put('disputes', dispute);
  await orch.agree('demo-t', dispute.id, 'me'); // 양쪽이 동의해 이미 끝난 이의
  await assert.rejects(orch.revise('demo-t', dispute.id, 'me', { alloc: withWhisky(dispute) }), (e) => e.status === 409);
});

test('줄이 맞지 않으면 400이고 아무것도 바꾸지 않는다', async () => {
  const { store, orch, dispute } = await setup();
  const events = (await store.listEvents('demo-t')).length;
  const { 'b-cheese': _, ...missing } = withWhisky(dispute);
  for (const alloc of [
    undefined, [], 'b-whisky',
    { ...withWhisky(dispute), 'b-ghost': ['me'] }, // 이 지출에 없는 줄
    missing, // 빠진 줄
    { ...withWhisky(dispute), 'b-cheese': [] }, // 아무도 고르지 않은 줄
    { ...withWhisky(dispute), 'b-cheese': ['me', 'stranger'] }, // 함께 있지 않던 사람
    { ...withWhisky(dispute), 'b-cheese': 'me' },
    allocOf(dispute), // 고친 줄이 없다
  ]) {
    await assert.rejects(orch.revise('demo-t', dispute.id, 'me', { alloc }), (e) => e.status === 400, JSON.stringify(alloc));
  }
  assert.deepEqual(await store.get('disputes', dispute.id), dispute);
  assert.equal((await store.listEvents('demo-t')).length, events);
});

test('위치 요약이 붙은 이의는 고친 안도 같은 규칙으로 가린다(당사자가 아닌 사람에게만)', async () => {
  const { redactDispute } = await import('../src/app.mjs');
  const { store, orch, dispute } = await setup();
  await store.put('disputes', { ...dispute, evidence: [{ kind: 'left_at', time: '22:55', summary: '난바역 근처 22:55', locationId: 'loc-1' }] });
  const out = await orch.revise('demo-t', dispute.id, 'me', { alloc: withWhisky(dispute) });
  const seen = redactDispute(out, 'yh', 'me');
  assert.ok(Object.values(seen.proposal.alloc).every((a) => a.reason === '위치 요약을 참고한 배분'));
  assert.ok(!JSON.stringify(seen).includes('난바역'));
  assert.deepEqual(allocOf(seen), allocOf(out)); // 누구 몫인지는 그대로 보인다
  assert.deepEqual(redactDispute(out, 'ms', 'me'), out);
});

test('라우트: 고치기는 당사자만, 고친 뒤 상대의 할 일과 동의', async () => {
  const { createApp } = await import('../src/app.mjs');
  const server = createApp({ store: new MemoryStore(), env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const call = (path, uid, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body ?? {}) });
  const view = async (roomId, uid) => (await fetch(`${url}/api/rooms/${roomId}`, { headers: { 'x-demo-user': uid } })).json();
  try {
    const roomId = (await (await fetch(`${url}/api/dev/seed`, { method: 'POST' })).json()).roomId;
    await call(`/api/rooms/${roomId}/invoices/send`, 'me');
    const [d] = (await view(roomId, 'me')).disputes;
    const base = `/api/rooms/${roomId}/disputes/${encodeURIComponent(d.id)}`;
    const alloc = withWhisky(d);
    assert.equal((await call(`${base}/revise`, 'yh', { alloc })).status, 403);
    assert.equal((await call(`${base}/revise`, 'me', { alloc: { ...alloc, 'b-whisky': [] } })).status, 400);
    const ok = await call(`${base}/revise`, 'me', { alloc, rev: 0 });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).proposal.revisedBy, 'me');
    const ms = await view(roomId, 'ms');
    assert.deepEqual(ms.actions.filter((a) => a.type === 'agree_dispute').map((a) => a.text), ['내가 ‘2차 바’ 중재안을 고쳤어요. 동의할까요?']); // 데모 방에서 me의 이름이 '나'다
    assert.equal((await call(`${base}/agree`, 'ms', { rev: 0 })).status, 409);
    assert.equal((await call(`${base}/agree`, 'ms', { rev: 1 })).status, 200);
    assert.equal((await view(roomId, 'ms')).disputes[0].status, 'resolved');
  } finally {
    server.close();
  }
});

// ---------------------------------------------------------------- 지출이 바뀌면 이의를 닫는다
import { splitChanged, supersedeDisputes } from '../src/agents/disputes.mjs';

test('splitChanged: 제목·종류·결제 시각·배분의 확인 표시만 바뀌면 그대로, 배분에 닿는 값이 바뀌면 바뀐 것', async () => {
  const { store } = await setup();
  const bar = await store.get('expenses', 'demo-t-bar');
  const alloc = { 'b-whisky': { consumers: ['me', 'cs'], confidence: 0.9, reason: 'x' } };
  const withAlloc = { ...bar, split: 'items', alloc };
  assert.equal(splitChanged(bar, { ...bar, title: '다른 이름', kind: 'food', time: '23:59' }), false);
  assert.equal(splitChanged(bar, { ...bar, split: 'items', items: bar.items.map((it) => ({ ...it, name: `${it.name}!` })) }), false); // 수정 API가 equal을 items로 바꿔 저장해도 몫은 같다
  assert.equal(splitChanged(withAlloc, { ...withAlloc, alloc: { 'b-whisky': { consumers: ['cs', 'me'], confidence: 1, reason: 'y', confirmed: true } } }), false);
  assert.equal(splitChanged(bar, { ...bar, items: bar.items.map((it, i) => (i ? it : { ...it, qty: it.qty + 1 })) }), true);
  assert.equal(splitChanged(bar, { ...bar, present: bar.present.slice(1) }), true);
  assert.equal(splitChanged(bar, { ...bar, date: '2026-11-09' }), true);
  assert.equal(splitChanged(bar, { ...bar, payer: 'cs' }), true);
  assert.equal(splitChanged(withAlloc, { ...withAlloc, alloc: { 'b-whisky': { ...alloc['b-whisky'], consumers: ['me'] } } }), true);
  assert.equal(splitChanged(bar, null), true); // 지운 지출
});

test('supersedeDisputes: 그 지출의 열린 이의만 닫고, 두 번 불러도 기록이 늘지 않는다', async () => {
  const { store, dispute } = await setup();
  const bar = await store.get('expenses', 'demo-t-bar');
  assert.deepEqual(await supersedeDisputes(store, 'demo-t', await store.get('expenses', 'demo-t-hotel'), null), []);
  assert.equal((await store.get('disputes', dispute.id)).status, 'proposed');
  assert.equal((await supersedeDisputes(store, 'demo-t', bar, { ...bar, present: bar.present.slice(1) })).length, 1);
  assert.equal((await store.get('disputes', dispute.id)).status, 'superseded');
  assert.deepEqual(await supersedeDisputes(store, 'demo-t', bar, null), []);
  assert.equal((await eventsOf(store, 'dispute_superseded')).length, 1);
});

test('지출이 사라진 이의에 동의·거부·중재해도 TypeError가 아니라 409', async () => {
  const { store, orch, dispute } = await setup();
  await store.delete('expenses', 'demo-t-bar'); // 옛 데이터: 이의만 남은 경우
  for (const act of [orch.agree('demo-t', dispute.id, 'me'), orch.reject('demo-t', dispute.id, 'me'), orch.mediate('demo-t', dispute.id, 'me')]) {
    await assert.rejects(act, (e) => e.status === 409);
  }
});
