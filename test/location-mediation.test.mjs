import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createLocationService } from '../src/location.mjs';
import { mediateWithGemini, mediatePrompt } from '../src/agents/mediate.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';

// #7: 이의를 낼 때 Google 지도 타임라인에서 찾은 '떠난 시각'(본인 제출)이 붙은 이의
async function fixture() {
  const store = new MemoryStore();
  const room = await seedDemoRoom(store, { id: 'location-policy' });
  const exp = await store.get('expenses', 'location-policy-bar');
  // 중재 규칙만 보므로 저장된 기록(locationId)과 잇지 않는다. 이으면 중재가 철회 여부를 확인한다(auth-location.test.mjs)
  const evidence = [{ kind: 'left_at', time: '22:55', source: 'timeline_export', requiresHumanApproval: true, summary: '첫 주문(22:30) 때 머물던 곳을 22:55에 떠났어요 · Google 지도 타임라인(본인 제출)' }];
  const dispute = { by: 'ms', claim: '부담 항목 확인', evidence };
  return { store, room, exp, dispute, memoryByUid: {} };
}

test('timeline provider passes the stored time as left_at, a stay as text, and always asks for human approval', async () => {
  const { store, room, exp } = await fixture();
  const clock = () => new Date('2026-11-08T14:00:00Z');
  await store.put('locationConsents', { id: JSON.stringify([room.id, 'ms']), roomId: room.id, uid: 'ms', expiresAt: '2026-11-15T14:00:00Z' });
  const provider = createLocationService({ store, clock });
  await store.put('locationEvidence', { id: 'left', roomId: room.id, uid: 'ms', expenseId: exp.id, source: 'timeline_export', leftAt: '22:55', nextAt: '23:08', nextHome: false, summary: '떠났어요' });
  let [e] = await provider.evidenceFor('ms', exp, room);
  assert.deepEqual([e.kind, e.time, e.source, e.requiresHumanApproval, e.locationId], ['left_at', '22:55', 'timeline_export', true, 'left']);
  await store.put('locationEvidence', { id: 'left', roomId: room.id, uid: 'ms', expenseId: exp.id, source: 'timeline_export', stayedUntil: '23:40', summary: '있었어요' });
  [e] = await provider.evidenceFor('ms', exp, room);
  assert.deepEqual([e.kind, e.time, e.stayedUntil, e.requiresHumanApproval], ['text', undefined, '23:40', true]);
  // 예전 체크인·체크아웃 기록은 근거로 쓰지 않는다
  await store.put('locationEvidence', { id: 'left', roomId: room.id, uid: 'ms', expenseId: exp.id, action: 'checkout', relation: 'away', summary: '지정 장소 밖' });
  assert.deepEqual(await provider.evidenceFor('ms', exp, room), []);
});

test('only conflicting rows lose confidence; a self-report does not penalize unrelated rows', async () => {
  const context = await fixture();
  const lines = context.exp.items.map((it, i) => ({ id: it.id, consumers: [context.room.members[0].name], confidence: 0.95, reason: i ? '다른 근거로 판단' : '근거 충돌', evidenceConflict: i === 0 }));
  const result = await mediateWithGemini({ model: 'fake', generate: async () => ({ summary: '제안', lines }) }, context);
  assert.equal(result.alloc[lines[0].id].confidence, 0.49);
  assert.equal(result.alloc[lines[0].id].evidenceConflict, true);
  for (const line of lines.slice(1)) assert.equal(result.alloc[line.id].confidence, 0.95);
  assert.ok(Object.values(result.alloc).every(a => a.confirmed === false));
  const prompt = mediatePrompt(context);
  assert.match(prompt.user, /"leftAt":"22:55"/);
  assert.match(prompt.system, /타임라인/);
  assert.ok(prompt.schema.properties.lines.items.required.includes('evidenceConflict'));
});

test('rules fallback keeps original confidence and requires human approval for a self-reported stay', async () => {
  const context = await fixture();
  context.dispute.evidence = [{ kind: 'text', stayedUntil: '23:40', source: 'timeline_export', locationId: 'timeline-1', requiresHumanApproval: true, summary: '결제까지 같은 곳에 있었어요' }];
  const ordinary = await mediateWithGemini(null, { ...context, dispute: { ...context.dispute, evidence: [] } });
  const timeline = await mediateWithGemini(null, context);
  for (const [id, a] of Object.entries(timeline.alloc)) {
    assert.equal(a.confidence, ordinary.alloc[id].confidence);
    assert.equal(a.confirmed, false);
  }
});

test('a self-reported leaving time never triggers automatic agreement or changes the expense', async () => {
  const { store, room, exp, dispute } = await fixture();
  const settings = await store.get('agents', 'ms');
  await store.put('agents', { ...settings, rules: { ...settings.rules, onDispute: 'evidence' } });
  const payerSettings = await store.get('agents', exp.payer);
  await store.put('agents', { ...payerSettings, rules: { ...payerSettings.rules, onDispute: 'ask' } });
  const orch = createOrchestrator({ store });
  const raised = await orch.raiseDispute(room.id, { ...dispute, expenseId: exp.id });
  const before = await store.get('expenses', exp.id);
  const proposed = await orch.mediate(room.id, raised.id, exp.payer);
  assert.deepEqual(proposed.agreedBy, []);
  assert.equal(proposed.status, 'proposed');
  assert.deepEqual(await store.get('expenses', exp.id), before);
  const oneSide = await orch.agree(room.id, raised.id, 'ms');
  assert.equal(oneSide.status, 'proposed');
  assert.deepEqual(await store.get('expenses', exp.id), before);
});
