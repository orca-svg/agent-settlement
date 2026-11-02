// 화면 공용 모듈 중 DOM 없이 쓰는 순수 함수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, topic, subj, whose, restNote, allocLabel, groupRuns, logItemHtml, qrImageUrl, qrIsFresh, disputeWaiting, agreedNote } from '../public/ui.js';

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

test('disputeWaiting: 지출을 낸 사람과 이의를 낸 사람 중 아직 동의하지 않은 사람', () => {
  const exp = { payer: 'me' };
  assert.deepEqual(disputeWaiting({ by: 'ms', agreedBy: [] }, exp), ['me', 'ms']);
  assert.deepEqual(disputeWaiting({ by: 'ms', agreedBy: ['me'] }, exp), ['ms']);
  assert.deepEqual(disputeWaiting({ by: 'ms', agreedBy: ['ms', 'me'] }, exp), []);
  assert.deepEqual(disputeWaiting({ by: 'me', agreedBy: [] }, exp), ['me']); // 낸 사람이 스스로 이의를 내도 한 번만
});

test('agreedNote: 동의한 뒤 방 화면에 남길 한 줄. 지금 이의 상태로 만든다', () => {
  const exp = { title: '2차 바', payer: 'me' };
  const nameOf = (u) => ({ me: '나', ms: '민수', cs: '철수' })[u];
  assert.equal(agreedNote({ status: 'proposed', by: 'ms', agreedBy: ['me'] }, exp, nameOf), '중재안에 동의했어요. 민수의 동의를 기다려요.');
  assert.equal(agreedNote({ status: 'proposed', by: 'ms', agreedBy: ['ms'] }, { ...exp, payer: 'cs' }, nameOf), '중재안에 동의했어요. 철수의 동의를 기다려요.');
  assert.equal(agreedNote({ status: 'resolved', by: 'ms', agreedBy: ['ms', 'me'] }, exp, nameOf), '양쪽이 동의해서 ‘2차 바’를 중재안대로 다시 나눴어요. 청구서도 다시 보냈어요.');
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

test('groupRuns: 이어진 같은 종류의 기록만 묶고, 할 일이 있거나 종류가 없으면 묶지 않는다', () => {
  const ev = (seq, kind, from = 'system', action) => ({ seq, kind, from, ...(action ? { action } : {}) });
  const runs = groupRuns([ev(5, 'expense_added'), ev(4, 'expense_added'), ev(3, 'allocated', 'me'), ev(2, 'confirm_line', 'me', { type: 'confirm_line' }), ev(1, 'confirm_line', 'me', { type: 'confirm_line' })]);
  assert.deepEqual(runs.map((r) => r.map((e) => e.seq)), [[5, 4], [3], [2], [1]]);
  assert.deepEqual(groupRuns([{ seq: 2, from: '나' }, { seq: 1, from: '나' }]).map((r) => r.length), [1, 1]);
});

test('logItemHtml: 안 읽은 기록 표시와 덧붙일 내용', () => {
  const html = logItemHtml({ avatar: '', who: '나의 비서 → 모두', time: '10:00', text: '<b>', unread: true, extraHtml: '<details></details>' });
  assert.match(html, /<li class=" ?unread">/);
  assert.match(html, /&lt;b&gt;/);
  assert.match(html, /<details><\/details>/);
});

test('qrImageUrl: 데이터를 인코딩해 QR 이미지 주소를 만든다', () => {
  assert.equal(
    qrImageUrl('supertoss://send?bank=토스뱅크&accountNo=1&amount=1'),
    'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=supertoss%3A%2F%2Fsend%3Fbank%3D%ED%86%A0%EC%8A%A4%EB%B1%85%ED%81%AC%26accountNo%3D1%26amount%3D1',
  );
});

test('qrIsFresh: 같은 송금의 QR 토큰이 1분 넘게 남았을 때만 그대로 쓴다', () => {
  const now = Date.parse('2026-11-25T00:00:00Z');
  const qr = { id: 't1', token: 'x', expiresAt: '2026-11-25T00:15:00.000Z' };
  assert.equal(qrIsFresh(qr, 't1', now), true);
  assert.equal(qrIsFresh(qr, 't2', now), false); // 다른 송금의 토큰
  assert.equal(qrIsFresh(qr, 't1', Date.parse('2026-11-25T00:14:30Z')), false); // 30초 남음 → 새로 받는다
  assert.equal(qrIsFresh(null, 't1', now), false);
});

test('qrImageUrl: 빈 값이면 null', () => {
  assert.equal(qrImageUrl(''), null);
  assert.equal(qrImageUrl(null), null);
});
