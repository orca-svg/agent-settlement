// 사용자 테스트(11/5): 이의가 무엇이고 중재로 무엇이 바뀌었는지 알기 어려웠다("화살표의 뜻을 모르겠다", "바뀐 차이를 보고 싶다").
// 그래서 중재안은 바뀐 줄을 먼저, 줄마다 누가 빠지고 더해졌는지 글로 보이고, 사람별 몫은 지금·중재안·차이를 따로 적는다.
// 중재 비서에게 맡겨 둔 사람도 중재안을 고칠 수 있고, 영수증 줄이 없어 중재할 수 없는 이의는 막다른 길 대신 고칠 길을 보인다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proposalLinesHtml, currentConsumers, sharesDiffHtml } from '../public/ui.js';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { pendingActions } from '../src/actions.mjs';

const bar = {
  id: 'bar', currency: 'KRW', present: ['me', 'cs', 'ms'], split: 'items',
  items: [{ id: 'n', name: '믹스넛', qty: 1, unit: 600 }, { id: 'w', time: '23:10', name: '위스키', qty: 2, unit: 1200 }],
  alloc: { n: { consumers: ['me', 'cs', 'ms'] }, w: { consumers: ['me', 'cs', 'ms'] } },
};
const proposal = { n: { consumers: ['me', 'cs', 'ms'], reason: '나눠 먹는 안주' }, w: { consumers: ['me', 'cs'], reason: '22:55 뒤 주문이라 민수는 빠져요' } };
const opts = { nameOf: (u) => ({ me: '나', cs: '철수', ms: '민수' })[u], avatar: (u) => `<i>${u}</i>` };

test('지금 배분: 줄로 나눈 지출은 그 배분, 아니면 함께한 사람 모두', () => {
  assert.deepEqual(currentConsumers(bar), { n: ['me', 'cs', 'ms'], w: ['me', 'cs', 'ms'] });
  assert.deepEqual(currentConsumers({ ...bar, split: 'equal', alloc: null }), { n: ['me', 'cs', 'ms'], w: ['me', 'cs', 'ms'] });
});

test('중재안은 바뀐 줄을 먼저 보이고, 누가 빠지고 더해졌는지 글로 적는다(색에만 기대지 않는다)', () => {
  const html = proposalLinesHtml(bar, proposal, { ...opts, before: currentConsumers(bar) });
  assert.ok(html.indexOf('위스키') < html.indexOf('믹스넛'), '바뀐 위스키 줄이 먼저');
  assert.match(html, /class="line moved"[\s\S]*민수 빠짐/);
  assert.match(html, /data-p="ms" data-diff="out"/, '빠진 사람 칩에 표시');
  assert.match(html, /그대로인 줄 1개/);
  assert.equal((html.match(/class="pick"/g) ?? []).length, 6, '칩은 그대로 지출 시트와 같은 캡슐');
});

test('고친 줄도 지금 배분과 견줘 더해진 사람을 적는다', () => {
  const html = proposalLinesHtml(bar, proposal, { ...opts, editable: true, before: { n: ['me', 'cs'], w: ['me', 'cs', 'ms'] }, draft: { w: ['me', 'cs', 'ms'] } });
  assert.match(html, /민수 더함/, '믹스넛에 민수가 더해졌다');
  assert.match(html, /내가 고친 줄/);
});

test('사람별 몫은 이름 아래에 지금 몫, 오른쪽에 바뀐 몫과 차이를 적고, 차이는 부호와 글로 말한다', () => {
  const html = sharesDiffHtml([{ uid: 'me', now: 50_605, after: 40_000, role: '이의 낸 사람' }, { uid: 'cs', now: 40_000, after: 50_605 }, { uid: 'ms', now: 1_000, after: 1_000 }], opts);
  assert.match(html, /나[\s\S]*이의 낸 사람[\s\S]*지금 ₩50,605[\s\S]*₩40,000[\s\S]*−₩10,605 덜 내요/);
  assert.match(html, /\+₩10,605 더 내요/);
  assert.match(html, /aria-label="나: 지금 ₩50,605, 중재안 ₩40,000, −₩10,605 덜 내요"/, '읽어 주는 글도 같은 말');
  assert.match(html, /그대로/);
  assert.doesNotMatch(html, /→/, '뜻을 몰랐던 화살표는 쓰지 않는다');
});

test('영수증 줄이 없는 지출은 낸 사람이 중재를 맡겨 뒀어도 중재하지 않고 낸 사람에게 묻는다(오류로 끝나지 않는다)', async () => {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: 'demo-t' });
  const orch = createOrchestrator({ store, clock: () => new Date('2026-11-10T03:00:00Z') });
  const exp = (await store.list('expenses', { roomId: 'demo-t' })).find((e) => !e.items?.length);
  const a = await store.get('agents', exp.payer);
  await store.put('agents', { ...a, rules: { ...a.rules, onDispute: 'mediator' } });
  const by = exp.present.find((u) => u !== exp.payer);
  const d = await orch.raiseDispute('demo-t', { by, expenseId: exp.id, claim: '' });
  assert.equal(d.status, 'open');
  const asked = pendingActions({ expenses: await store.list('expenses', { roomId: 'demo-t' }), disputes: await store.list('disputes', { roomId: 'demo-t' }) });
  assert.ok(asked.some((x) => x.type === 'agree_dispute' && x.for === exp.payer && x.ref === d.id));
});

test('이의 시트: 무엇이 맞지 않는지 먼저, 줄 없는 이의는 지출 고치기로, 중재안은 고칠 수 있다고 그 자리에서 알린다', () => {
  const src = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');
  const sheet = src.match(/function disputeSheet\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(sheet, /before: currentConsumers\(exp\)/);
  assert.match(sheet, /sharesDiffHtml\(/);
  assert.match(sheet, /무엇이 맞지 않나요/);
  assert.match(sheet, /data-action="open-exp"/, '줄 없는 이의는 낸 사람이 지출을 고친다');
  assert.match(sheet, /이름을 눌러 고쳐요/, '중재 비서에게 맡겨 둬도 당사자가 고칠 수 있다');
  const panel = readFileSync(new URL('../public/agent-panel.js', import.meta.url), 'utf8');
  assert.match(panel, /mediator: '[^']*중재안은 내가 고치거나 거부할 수 있어요/);
});
