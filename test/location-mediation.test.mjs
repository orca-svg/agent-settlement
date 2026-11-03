import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createLocationService } from '../src/location.mjs';
import { mediateWithGemini, mediatePrompt } from '../src/agents/mediate.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';

async function fixture() {
  const store = new MemoryStore();
  const room = await seedDemoRoom(store, { id: 'location-policy' });
  const exp = await store.get('expenses', 'location-policy-bar');
  const evidence = [{ kind: 'text', source: 'browser_self_report', relation: 'away', observedAt: '2026-11-08T13:55:00Z', uncertain: false, requiresHumanApproval: true, summary: '체크아웃 · 지정 장소 밖' }];
  const dispute = { by: 'ms', claim: '부담 항목 확인', evidence };
  return { store, room, exp, dispute, memoryByUid: {} };
}

test('location provider preserves near/away/uncertain and handles legacy records without parsing prose', async () => {
  const { store, room, exp } = await fixture();
  const clock = () => new Date('2026-11-08T14:00:00Z');
  await store.put('locationConsents', { id: JSON.stringify([room.id, 'ms']), roomId: room.id, uid: 'ms', expiresAt: '2026-11-08T15:00:00Z' });
  for (const relation of ['near', 'away', 'uncertain', undefined]) {
    await store.put('locationEvidence', { id: 'measurement', roomId: room.id, uid: 'ms', expenseId: exp.id, action: 'checkout', relation, observedAt: clock().toISOString(), summary: '지정 장소 밖' });
    const [e] = await createLocationService({ store, clock }).evidenceFor('ms', exp, room);
    assert.equal(e.relation, relation ?? 'uncertain');
    assert.equal(e.uncertain, !relation || relation === 'uncertain');
    assert.equal(e.requiresHumanApproval, true);
    assert.equal(e.kind, 'text');
    assert.equal(e.time, undefined); // never infer continuous absence
  }
});

test('only conflicting rows lose confidence; uncertain GPS does not penalize unrelated rows', async () => {
  const context = await fixture();
  context.dispute.evidence[0].relation = 'uncertain';
  context.dispute.evidence[0].uncertain = true;
  const lines = context.exp.items.map((it, i) => ({ id: it.id, consumers: [context.room.members[0].name], confidence: 0.95, reason: i ? '다른 근거로 판단' : '근거 충돌', evidenceConflict: i === 0 }));
  const result = await mediateWithGemini({ model: 'fake', generate: async () => ({ summary: '제안', lines }) }, context);
  assert.equal(result.alloc[lines[0].id].confidence, 0.49);
  assert.equal(result.alloc[lines[0].id].evidenceConflict, true);
  for (const line of lines.slice(1)) assert.equal(result.alloc[line.id].confidence, 0.95);
  assert.ok(Object.values(result.alloc).every(a => a.confirmed === false));
  const prompt = mediatePrompt(context);
  assert.match(prompt.user, /"relation":"uncertain"/);
  assert.match(prompt.user, /2026-11-08T13:55:00Z/);
  assert.ok(prompt.schema.properties.lines.items.required.includes('evidenceConflict'));
});

test('rules fallback keeps original confidence and requires human approval for browser reports', async () => {
  const context = await fixture();
  const ordinary = await mediateWithGemini(null, { ...context, dispute: { ...context.dispute, evidence: [] } });
  const browser = await mediateWithGemini(null, context);
  for (const [id, a] of Object.entries(browser.alloc)) {
    assert.equal(a.confidence, ordinary.alloc[id].confidence);
    assert.equal(a.confirmed, false);
  }
});

test('browser report mixed with left_at never triggers automatic agreement or changes expense', async () => {
  const { store, room, exp, dispute } = await fixture();
  const settings = await store.get('agents', 'ms');
  await store.put('agents', { ...settings, rules: { ...settings.rules, onDispute: 'evidence' } });
  const payerSettings = await store.get('agents', exp.payer);
  await store.put('agents', { ...payerSettings, rules: { ...payerSettings.rules, onDispute: 'ask' } });
  const orch = createOrchestrator({ store });
  const raised = await orch.raiseDispute(room.id, { ...dispute, expenseId: exp.id, evidence: [...dispute.evidence, { kind: 'left_at', time: '22:55', summary: '다른 근거' }] });
  const before = await store.get('expenses', exp.id);
  const proposed = await orch.mediate(room.id, raised.id, exp.payer);
  assert.deepEqual(proposed.agreedBy, []);
  assert.equal(proposed.status, 'proposed');
  assert.deepEqual(await store.get('expenses', exp.id), before);
  const oneSide = await orch.agree(room.id, raised.id, 'ms');
  assert.equal(oneSide.status, 'proposed');
  assert.deepEqual(await store.get('expenses', exp.id), before);
});
