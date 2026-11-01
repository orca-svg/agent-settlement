// 화면 공용 모듈 중 DOM 없이 쓰는 순수 함수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, topic, subj, whose, restNote, allocLabel } from '../public/ui.js';

test('조사: 받침에 따라 은/는, 이/가, 나는 내가', () => {
  assert.equal(topic('오차즈케'), '오차즈케는');
  assert.equal(topic('‘하이볼’'), '‘하이볼’은');
  assert.equal(subj('나'), '내가');
  assert.equal(subj('철수'), '철수가');
  assert.equal(subj('민준'), '민준이');
});

test('esc: HTML 특수문자를 바꾼다', () => {
  assert.equal(esc(`<b>"철수"&'영희'</b>`), '&lt;b&gt;&quot;철수&quot;&amp;&#39;영희&#39;&lt;/b&gt;');
});

test('restNote: 남은 원이 있을 때만 한 줄로 알린다', () => {
  assert.equal(restNote(0), '');
  assert.equal(restNote(1), '<p class="group-note">나누고 남은 ₩1은 낸 사람 몫에 더했어요.</p>');
});

test('whose: 나는 내 몫, 다른 이름은 그대로', () => {
  assert.equal(whose('나'), '내');
  assert.equal(whose('영희'), '영희');
  assert.equal(whose('나·철수'), '나·철수');
});

test('allocLabel: 어떻게 나눴는지 짧게 알린다', () => {
  assert.equal(allocLabel({ source: 'gemini-3.8-flash', how: 'gemini', latencyMs: 2000 }), 'Gemini 3.8 Flash · 2.0초');
  assert.equal(allocLabel({ source: 'gemini-3.8-flash', how: 'cache', latencyMs: 3 }), 'Gemini 3.8 Flash · 이전 답 재사용');
  assert.equal(allocLabel({ source: 'rules', how: 'obvious', latencyMs: 1 }), 'AI 없이 나눔');
  assert.equal(allocLabel({ source: 'rules', how: 'rules', latencyMs: 0 }), '규칙');
});
