// 화면 공용 모듈 중 DOM 없이 쓰는 순수 함수.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, topic, subj, whose, restNote, allocLabel, allocButton, groupRuns, logItemHtml, qrImageUrl, qrIsFresh, receiptPickers, sendMode } from '../public/ui.js';

test('allocButton: 나눈 뒤 바뀐 게 없으면 막고, 남은 일을 알려 준다', () => {
  assert.deepEqual(allocButton({ allocated: false, fresh: false, flagged: 0 }), { label: '비서에게 나누기 맡기기', disabled: false, hint: '' });
  assert.deepEqual(allocButton({ allocated: true, fresh: false, flagged: 1 }), { label: '비서에게 다시 나누기', disabled: false, hint: '' }); // 기억이 바뀌었다
  assert.deepEqual(allocButton({ allocated: true, fresh: true, flagged: 1 }), { label: '비서가 나누기를 마쳤어요', disabled: true, hint: '확인 필요한 1줄만 확인하면 끝나요.' });
  assert.deepEqual(allocButton({ allocated: true, fresh: true, flagged: 0 }), { label: '나누기를 모두 마쳤어요', disabled: true, hint: '지출을 고치거나 비서의 기억이 바뀌면 다시 나눌 수 있어요.' });
});

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

// 비서끼리 기록은 시스템 로그가 아니라 비서들의 대화처럼 보인다: 받는 사람은 '→' 대신 '○○에게',
// 근거(규칙·수치)는 말풍선 밖 '왜 그렇게 했나요'를 눌러야 펼쳐지고, 같은 분의 시각은 한 번만 보인다
test('logItemHtml: 받는 사람은 문장처럼, 근거는 펼쳐 보기로, 빈 시각은 그리지 않는다', () => {
  const html = logItemHtml({ avatar: '', who: '민수의 비서', to: '중재 비서', time: '9:01', text: '동의할게요', meta: '규칙: 근거와 맞으면 <동의>' });
  assert.match(html, /<span class="to">중재 비서에게<\/span>/);
  assert.doesNotMatch(html, /→/);
  assert.match(html, /<p class="text">동의할게요<\/p>/);
  assert.match(html, /<details class="why"><summary>왜 그렇게 했나요<\/summary><p>규칙: 근거와 맞으면 &lt;동의&gt;<\/p><\/details>/);
  const quiet = logItemHtml({ avatar: '', who: '나의 비서', time: '', text: '다음 말' });
  assert.doesNotMatch(quiet, /<time>/);
  assert.doesNotMatch(quiet, /class="why"|class="to"/);
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

test('sendMode: 컴퓨터에서 토스 링크가 있으면 QR만, 휴대폰이나 링크가 없으면 슬라이더', () => {
  const link = { link: 'supertoss://send?bank=x', fallback: { bank: 'x', accountNo: '1' } };
  const copyOnly = { link: null, fallback: { bank: '경남은행', accountNo: '1' } };
  const none = { link: null, fallback: null };
  assert.equal(sendMode(link, { computer: true }), 'qr');
  assert.equal(sendMode(link, { computer: false }), 'slider');
  assert.equal(sendMode(copyOnly, { computer: true }), 'slider'); // QR로 열 토스 링크가 없으니 계좌 복사 슬라이더를 남긴다
  assert.equal(sendMode(none, { computer: true }), 'no-payout');
  assert.equal(sendMode(none, { computer: false }), 'no-payout');
});

test('qrImageUrl: 빈 값이면 null', () => {
  assert.equal(qrImageUrl(''), null);
  assert.equal(qrImageUrl(null), null);
});

// 영수증 사진 버튼을 (라벨, capture 여부)로 읽는다. 모두 영수증 입력(data-receipt)이고 이미지만 받아야 한다.
const pickers = (html) => [...html.matchAll(/<label[^>]*>([^<]+)<input([^>]*)>/g)].map(([, label, attrs]) => {
  assert.match(attrs, /type="file"/);
  assert.match(attrs, /accept="image\/\*"/);
  assert.match(attrs, /data-receipt/);
  return [label.trim(), attrs.match(/capture="([^"]*)"/)?.[1] ?? null];
});

test('receiptPickers: 휴대폰·태블릿은 카메라로 찍기와 앨범에서 고르기를 따로 둔다', () => {
  assert.deepEqual(pickers(receiptPickers(true)), [['사진 찍기', 'environment'], ['앨범에서 고르기', null]]);
});

test('receiptPickers: 컴퓨터는 capture 없이 파일 고르기 하나만', () => {
  assert.deepEqual(pickers(receiptPickers(false)), [['사진 고르기', null]]);
});
