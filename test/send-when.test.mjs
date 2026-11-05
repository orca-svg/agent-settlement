// 보낼 시기(사용자 테스트 11/5): '바로'와 '편할 때'의 차이를 느끼지 못했다. 둘 다 방에서 바로 보내러 갈 수 있고 알림 때만 달랐다.
// 그래서 '바로'를 없애고 '편할 때'를 기본으로 한다. 알림은 인터뷰대로 다음 날 오전 9시(KST)이고, 예전에 저장한 '바로'는 '편할 때'로 읽는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_RULES, MANUAL_WAIT_DAYS, sendWhenLabel } from '../public/agent-rules.js';
import { nextSendAt } from '../src/agents/rules.mjs';
import { normalizeSettings, rulesIn, createAgentSettings } from '../src/agents/settings.mjs';
import { sendHtml, draftFromRules } from '../public/agent-panel.js';
import { MemoryStore } from '../src/store/memory.mjs';

test('기본은 편할 때 보내기이고, 받았다는 확인이 없으면 다음 날 오전 9시에 알린다', () => {
  assert.equal(DEFAULT_RULES.sendWhen, 'manual');
  assert.equal(MANUAL_WAIT_DAYS, 1);
  assert.equal(nextSendAt(new Date('2026-11-08T13:00:00Z'), 'manual'), '2026-11-09T00:00:00.000Z', '11/8 22시 → 11/9 9시');
  assert.equal(nextSendAt(new Date('2026-11-08T16:00:00Z'), 'manual'), '2026-11-10T00:00:00.000Z', '11/9 1시 → 11/10 9시');
});

test("예전에 저장한 '바로'는 '편할 때'로 읽는다(기본 설정·방별 값·표시·알림 때·화면 초안)", () => {
  const s = normalizeSettings({ rules: { autoAccept: 0, sendWhen: 'now', onDispute: 'ask', notify: 'actions' }, roomRules: { r1: { sendWhen: 'now' } } }, 'u');
  assert.equal(s.rules.sendWhen, 'manual');
  assert.equal(rulesIn(s, 'r1').sendWhen, 'manual');
  assert.equal(sendWhenLabel('now'), '편할 때 보내기');
  assert.equal(nextSendAt(new Date('2026-11-08T13:00:00Z'), 'now'), '2026-11-09T00:00:00.000Z');
  assert.equal(draftFromRules({ autoAccept: 0, sendWhen: 'now', onDispute: 'ask', notify: 'actions' }).mode, 'manual');
});

test("예전 화면이 '바로'를 보내도 '편할 때'로 저장한다", async () => {
  const settings = createAgentSettings({ store: new MemoryStore(), clock: () => new Date('2026-11-10T03:00:00Z') });
  await settings.updateRules('u', { sendWhen: { payday: 25 } });
  assert.equal((await settings.updateRules('u', { sendWhen: 'now' })).rules.sendWhen, 'manual');
  assert.equal((await settings.setRoomRules('u', 'r1', { sendWhen: 'now' })).roomRules.r1.sendWhen, 'manual');
});

test('보낼 시기 고르기에는 바로가 없고, 고른 것이 무슨 뜻인지 한 줄로 알린다', () => {
  const manual = sendHtml(draftFromRules(DEFAULT_RULES));
  assert.doesNotMatch(manual, />바로</);
  assert.match(manual, /data-id="manual">편할 때</);
  assert.match(manual, /다음 날 오전 9시/);
  const payday = sendHtml({ ...draftFromRules(DEFAULT_RULES), mode: 'payday' });
  assert.match(payday, /매달 그날 오전 9시/);
});

test("방의 '보내면 돼요' 카드는 없어진 '바로'와 견주지 않고, 언제 알리는지만 말한다", () => {
  const room = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');
  assert.doesNotMatch(room, /바로 알리지 않아요/);
});
