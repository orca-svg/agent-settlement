// 화면 공용 모듈 중 DOM 없이 쓰는 순수 함수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, topic, subj } from '../public/ui.js';

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
