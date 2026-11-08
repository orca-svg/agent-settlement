// 정산 진행 상태(단계 막대·한 줄 요약·완료 요약). 방 화면·내 방 목록·서버가 같은 판정을 쓴다.
// 완료 기준: 지금 몇 번째 단계인지, 무엇이 누구를 기다리는지, 끝난 방이 무엇을 했는지를 상태 값만으로 말한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STEPS, progressOf, overallRatio, doneSummary, changeNotice } from '../public/progress.js';
import { stepperHtml } from '../public/progress-ui.js';
import { roomRowsHtml } from '../public/room-list.js';
import { doneCardHtml } from '../public/room-setup.js';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';

const members = [
  { uid: 'me', name: '재윤' },
  { uid: 'cs', name: '철수' },
  { uid: 'yh', name: '영희' },
  { uid: 'ms', name: '민수' },
];
const room = (extra = {}) => ({ id: 'r1', name: '오사카', members, version: 2, status: 'ready', ...extra });
const everyone = members.map((m) => m.uid);
const dinner = (extra = {}) => ({
  id: 'e1', title: '저녁', payer: 'me', present: everyone, currency: 'KRW', split: 'equal', amount: 40000,
  date: '2026-11-05', time: '19:00', createdBy: 'me', ...extra,
});
const izakaya = (alloc) => ({
  id: 'e2', title: '이자카야', payer: 'cs', present: everyone, currency: 'KRW', split: 'items', createdBy: 'cs',
  date: '2026-11-05', time: '22:00',
  items: [{ id: 'i1', name: '하이볼', qty: 2, unit: 6000 }, { id: 'i2', name: '오차즈케', qty: 1, unit: 8000 }],
  ...(alloc ? { alloc } : {}),
});
const sure = (consumers) => ({ consumers, confidence: 0.9, reason: '' });
const invoice = (to, status, version = 2) => ({ id: `inv-${to}-${version}`, to, status, version, net: -10000 });

// 지출 모으기·나누기는 정산이 끝날 때까지 언제든 다시 일어나서 단계가 아니라 늘 열린 장부(book)로 따로 둔다.
// 단계는 한 번의 정산이 지나가는 길(청구 → 응답 → 보내기 → 끝)만 센다
test('단계 이름은 네 개이고 순서가 정해져 있다', () => {
  assert.deepEqual(STEPS, ['청구', '응답', '보내기', '끝']);
});

test('지출이 없으면 1단계 청구에서 지출을 기다린다', () => {
  const p = progressOf({ room: room(), expenses: [] }, 'me');
  assert.equal(p.step, 1);
  assert.equal(p.label, '청구');
  assert.equal(p.summary, '지출을 남기면 청구서를 보낼 수 있어요');
});

test('장부는 단계와 따로 지출 수와 합계를 센다', () => {
  const p = progressOf({ room: room(), expenses: [dinner(), izakaya()] }, 'me');
  assert.deepEqual(p.book, { count: 2, total: 60000 });
  assert.deepEqual(progressOf({ room: room({ status: 'done' }), expenses: [dinner()] }, 'me').book, { count: 1, total: 40000 }, '끝난 방에도 장부는 열려 있다');
});

test('외화 방에서 환율 정책에 아직 동의하지 않은 사람이 있으면 1단계에 머물고 그 사람을 이름으로 적는다', () => {
  const r = room({ fx: { currency: 'JPY' }, policyAgreedBy: ['me', 'cs', 'ms'] });
  const p = progressOf({ room: r, expenses: [dinner()] }, 'me');
  assert.equal(p.step, 1);
  assert.equal(p.summary, '환율 정책 동의 3/4');
  assert.deepEqual(p.remaining, ['영희의 환율 정책 동의']);
  assert.equal(p.ratio, 3 / 4);
});

test('메뉴별로 아직 나누지 않은 영수증이 있으면 1단계 청구에 머물고 무엇을 나눌지 적는다', () => {
  const p = progressOf({ room: room(), expenses: [dinner(), izakaya()] }, 'me');
  assert.equal(p.step, 1);
  assert.equal(p.summary, '메뉴별로 나누지 않은 지출 1건');
  assert.deepEqual(p.remaining, ['‘이자카야’ 나누기']);
});

test('확인이 필요한 줄(확신 0.7 미만)이 남아 있어도 1단계이고, 누가 확인할지 적는다', () => {
  const alloc = { i1: sure(['cs', 'ms']), i2: { consumers: ['yh'], confidence: 0.4, reason: '' } };
  const p = progressOf({ room: room(), expenses: [izakaya(alloc)] }, 'me');
  assert.equal(p.step, 1);
  assert.equal(p.summary, '확인할 줄 1개');
  assert.deepEqual(p.remaining, ['철수의 ‘오차즈케’ 확인']);
});

test('모두 나눴고 청구서를 아직 안 보냈으면 1단계 청구', () => {
  const p = progressOf({ room: room(), expenses: [dinner(), izakaya({ i1: sure(['cs']), i2: sure(['yh']) })] }, 'me');
  assert.equal(p.step, 1);
  assert.equal(p.summary, '청구서를 보내면 비서들이 확인해요');
  assert.equal(p.ratio, null);
});

test('지출이 바뀌어 이전 버전 청구서만 있으면 다시 보내야 한다고 말한다', () => {
  const p = progressOf({ room: room({ status: 'settling' }), expenses: [dinner()], invoices: [invoice('cs', 'accepted', 1)] }, 'me');
  assert.equal(p.step, 1);
  assert.equal(p.summary, '지출이 바뀌어서 청구서를 다시 보내야 해요');
});

test('주인에게 물은 청구서가 있으면 2단계 응답이고, 응답한 비율을 센다', () => {
  const invoices = [invoice('cs', 'accepted'), invoice('yh', 'asked'), invoice('ms', 'accepted')];
  const p = progressOf({ room: room({ status: 'settling' }), expenses: [dinner()], invoices }, 'me');
  assert.equal(p.step, 2);
  assert.equal(p.label, '응답');
  assert.equal(p.summary, '청구서 3개 중 2개 응답');
  assert.deepEqual(p.remaining, ['영희의 확인']);
  assert.equal(p.ratio, 2 / 3);
});

test('진행 중인 이의가 있으면 2단계에 머물고, 중재를 기다리는 사람을 적는다', () => {
  const invoices = [invoice('cs', 'accepted'), invoice('yh', 'accepted'), invoice('ms', 'disputed')];
  const disputes = [
    { id: 'd1', expenseId: 'e1', by: 'ms', status: 'proposed', agreedBy: ['me'] },
    { id: 'd0', expenseId: 'e1', by: 'cs', status: 'resolved', agreedBy: [] },
  ];
  const p = progressOf({ room: room({ status: 'settling' }), expenses: [dinner()], invoices, disputes }, 'me');
  assert.equal(p.step, 2);
  assert.equal(p.summary, '청구서 3개 중 3개 응답 · 이의 1건 진행 중');
  assert.deepEqual(p.remaining, ['민수의 ‘저녁’ 중재안 동의']);
});

test('중재를 아직 맡기지 않은 이의는 지출을 낸 사람을 기다린다', () => {
  const disputes = [{ id: 'd1', expenseId: 'e1', by: 'ms', status: 'open', agreedBy: [] }];
  const p = progressOf({ room: room({ status: 'settling' }), expenses: [dinner()], invoices: [invoice('ms', 'disputed')], disputes }, 'me');
  assert.deepEqual(p.remaining, ['나의 ‘저녁’ 중재 맡기기']);
});

test('응답이 끝나면 3단계 보내기이고, 받은 송금 비율과 남은 송금을 사람 기준으로 적는다', () => {
  const invoices = [invoice('cs', 'accepted'), invoice('yh', 'accepted'), invoice('ms', 'accepted')];
  const transfers = [
    { id: 't1', from: 'yh', to: 'me', amount: 10000, version: 2, status: 'confirmed' },
    { id: 't2', from: 'cs', to: 'me', amount: 10000, version: 2, status: 'sent' },
    { id: 't3', from: 'ms', to: 'me', amount: 10000, version: 2, status: 'scheduled' },
    { id: 't0', from: 'ms', to: 'me', amount: 9000, version: 1, status: 'superseded' },
  ];
  const p = progressOf({ room: room({ status: 'settling' }), expenses: [dinner()], invoices, transfers }, 'me');
  assert.equal(p.step, 3);
  assert.equal(p.extra, null, '이미 오간 돈이 없으면 추가 정산이 아니다');
  assert.equal(p.summary, '송금 3번 중 1번 받음');
  assert.deepEqual(p.remaining, ['나의 받음 확인(철수 → 나)', '민수 → 나 보내기']);
  assert.equal(p.ratio, 1 / 3);
});

// 추가 정산: 지출이 바뀌기 전에 오간 돈은 그대로 두고 차액만 다시 보낸다(orchestrator의 afterMoved).
// 예전 묶음에서 보냈다고만 한 송금은 받았어요까지 이번 송금과 함께 센다
test('추가 정산이면 이미 오간 돈을 함께 알리고, 예전 묶음에서 보냈다고만 한 송금도 받을 때까지 센다', () => {
  const r = room({ status: 'settling', version: 3 });
  const invoices = [invoice('cs', 'accepted', 3), invoice('yh', 'accepted', 3)];
  const transfers = [
    { id: 't1', from: 'cs', to: 'me', amount: 15000, version: 2, status: 'confirmed' },
    { id: 't2', from: 'cs', to: 'yh', amount: 10000, version: 2, status: 'sent' },
    { id: 't3', from: 'me', to: 'cs', amount: 5000, version: 3, status: 'scheduled' },
    { id: 't0', from: 'ms', to: 'me', amount: 9000, version: 2, status: 'superseded' },
  ];
  const p = progressOf({ room: r, expenses: [dinner()], invoices, transfers }, 'me');
  assert.equal(p.step, 3);
  assert.equal(p.summary, '송금 2번 중 0번 받음');
  assert.deepEqual(p.remaining, ['영희의 받음 확인(철수 → 영희)', '나 → 철수 보내기']);
  assert.deepEqual(p.extra, { moved: 25000, count: 2 });
});

test('정산이 끝난 방은 4단계 끝', () => {
  const p = progressOf({ room: room({ status: 'done' }), expenses: [dinner()] }, 'me');
  assert.equal(p.step, 4);
  assert.equal(p.label, '끝');
  assert.equal(p.summary, '정산이 끝났어요');
  assert.deepEqual(p.remaining, []);
});

test('전체 진행 비율은 지난 단계 수에 지금 단계의 비율을 더해 세 칸으로 나눈다', () => {
  assert.equal(overallRatio({ step: 1, ratio: null }), 0);
  assert.equal(overallRatio({ step: 2, ratio: 1 / 2 }), 0.5);
  assert.equal(overallRatio({ step: 4, ratio: null }), 1);
});

test('완료 요약: 함께 쓴 돈, 내 몫, 송금 횟수와 지출마다 보냈을 때의 횟수, 비서가 대신 처리한 일', () => {
  const lunch = dinner({ id: 'e3', title: '점심', payer: 'cs', amount: 20000 });
  const invoices = [
    { ...invoice('cs', 'accepted'), decidedBy: 'agent' },
    { ...invoice('yh', 'accepted'), decidedBy: 'human' },
    { ...invoice('ms', 'disputed') },
  ];
  const disputes = [{ id: 'd1', expenseId: 'e1', by: 'ms', status: 'resolved', agreedBy: ['me', 'ms'] }];
  const transfers = [
    { id: 't1', from: 'yh', to: 'me', amount: 15000, version: 2, status: 'confirmed' },
    { id: 't2', from: 'ms', to: 'me', amount: 15000, version: 2, status: 'confirmed' },
  ];
  const s = doneSummary({ room: room({ status: 'done' }), expenses: [dinner(), lunch], invoices, disputes, transfers }, 'me');
  assert.equal(s.total, 60000);
  assert.equal(s.mine, 15000);
  assert.equal(s.transfers, 2);
  assert.equal(s.naive, 6); // 지출마다 낸 사람에게 나머지 셋이 보내면 3 + 3번
  assert.equal(s.autoAccepted, 1);
  assert.equal(s.mediated, 1);
});

// ---------- 화면 ----------

const sending = { step: 3, label: '보내기', summary: '송금 3번 중 1번 받음', remaining: ['나 → 민수 보내기', '영희의 받음 확인(철수 → 영희)', '민수 → 철수 보내기'], ratio: 1 / 3, book: { count: 3, total: 120000 }, extra: null };

test('단계 막대: 지금 단계만 aria-current, 끝난 단계는 ✓와 함께 "끝남"으로 읽히고, 남은 단계는 번호만', () => {
  const html = stepperHtml(sending);
  assert.match(html, /<section class="settle-steps" aria-label="정산 단계">/);
  assert.doesNotMatch(html, /class="steps"/, '타임라인 안내의 번호 목록(.steps)과 클래스가 겹치면 그 규칙이 칸을 깨뜨린다');
  assert.equal(html.match(/aria-current="step"/g).length, 1);
  assert.match(html, /<li class="now" aria-current="step"><span class="step-dot">3<\/span><span class="step-label">보내기<\/span><\/li>/);
  assert.equal(html.match(/<li class="done">/g).length, 2);
  assert.equal(html.match(/<span class="sr-only">끝남<\/span>/g).length, 2, '색과 ✓를 못 봐도 끝난 단계를 안다');
  assert.match(html, /<li><span class="step-dot">4<\/span><span class="step-label">끝<\/span><\/li>/);
  assert.match(html, /3\/4 보내기<\/b> · 송금 3번 중 1번 받음/);
  assert.match(html, /남은 일: 나 → 민수 보내기 · 영희의 받음 확인\(철수 → 영희\) 외 1개/, '남은 일은 둘까지 보이고 나머지는 개수로');
  assert.match(html, /<div class="meter" aria-hidden="true"><i style="width:33%"><\/i><\/div>/, '막대는 글로 쓴 요약을 따라 그리기만 한다');
  assert.doesNotMatch(html, /step-extra/, '추가 정산이 아니면 이미 오간 돈 줄이 없다');
});

test('단계 막대 위의 장부 줄: 지출 수·합계와 언제든 지출을 더하는 버튼(정산 단계와 따로 늘 열려 있다)', () => {
  const html = stepperHtml(sending);
  assert.match(html, /<div class="book"><span class="book-label">장부<\/span><span class="book-sum">지출 3건 · ₩120,000<\/span><button type="button" class="text-btn" data-action="add-expense">지출 추가<\/button><\/div><ol class="stepper">/);
});

test('단계 막대: 추가 정산이면 이미 오간 돈은 그대로 두고 바뀐 만큼만 주고받는다고 요약 바로 아래에 적는다', () => {
  const html = stepperHtml({ ...sending, extra: { moved: 15000, count: 1 } });
  assert.match(html, /송금 3번 중 1번 받음<\/p><p class="step-extra">추가 정산 · 이미 오간 ₩15,000은 그대로 두고 바뀐 만큼만 주고받아요<\/p>/);
});

test('단계 막대: 셀 비율이 없으면 막대를, 남은 일이 없으면 그 줄을 그리지 않는다', () => {
  const html = stepperHtml({ step: 1, label: '청구', summary: '청구서를 보내면 비서들이 확인해요', remaining: [], ratio: null, book: { count: 1, total: 1000 }, extra: null });
  assert.doesNotMatch(html, /class="meter"/);
  assert.doesNotMatch(html, /남은 일/);
});

test('단계 막대: 남은 일에 들어가는 지출 이름은 이스케이프한다', () => {
  const html = stepperHtml({ step: 1, label: '청구', summary: '메뉴별로 나누지 않은 지출 1건', remaining: ['‘<img src=x>’ 나누기'], ratio: null, book: { count: 1, total: 1000 }, extra: null });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('단계 막대: 끝난 방은 네 단계 모두 ✓이고 요약 상자 대신 완료 카드가 말한다. 장부는 그대로 열려 있다', () => {
  const html = stepperHtml({ step: 4, label: '끝', summary: '정산이 끝났어요', remaining: [], ratio: null, book: { count: 2, total: 50000 }, extra: null });
  assert.equal(html.match(/<li class="done">/g).length, 4);
  assert.doesNotMatch(html, /aria-current/);
  assert.doesNotMatch(html, /class="step-note"/);
  assert.match(html, /data-action="add-expense">지출 추가</);
});

test('저장 전 알림(D): 청구서가 나간 방에서 지출을 더하거나 고치면 무엇을 다시 해야 하는지 미리 말한다', () => {
  const r = room({ status: 'settling', version: 3 });
  const invoices = [invoice('cs', 'accepted', 3), invoice('yh', 'asked', 3), invoice('ms', 'accepted', 3)];
  const moved = [{ id: 't1', from: 'cs', to: 'me', amount: 15000, version: 2, status: 'confirmed' }];
  const view = { room: r, expenses: [dinner()], invoices, transfers: moved };
  assert.equal(changeNotice(view, 'add'), '저장하면 보낸 청구서 3개를 다시 보내야 해요. 이미 오간 ₩15,000은 그대로 두고 바뀐 만큼만 주고받아요.');
  assert.equal(changeNotice({ ...view, transfers: [] }, 'add'), '저장하면 보낸 청구서 3개를 다시 보내야 해요.');
  assert.equal(changeNotice({ ...view, transfers: [] }, 'edit'), '금액이나 사람·날짜를 바꾸면 보낸 청구서 3개를 다시 보내야 해요. 제목·결제 수단만 고치면 그대로예요.');
  assert.equal(changeNotice({ ...view, transfers: [] }, 'expense'), '이 지출을 지우거나 몫을 바꾸면 보낸 청구서 3개를 다시 보내야 해요.');
});

test('저장 전 알림(D): 끝난 방에서는 추가 정산이 열린다고, 청구서를 보내기 전에는 아무 말도 하지 않는다', () => {
  const moved = [{ id: 't1', from: 'cs', to: 'me', amount: 15000, version: 1, status: 'confirmed' }];
  const done = { room: room({ status: 'done', version: 1 }), expenses: [dinner()], invoices: [invoice('cs', 'accepted', 1)], transfers: moved };
  assert.equal(changeNotice(done, 'add'), '정산이 끝난 방이에요. 저장하면 추가 정산이 열려요. 이미 오간 ₩15,000은 그대로 두고 바뀐 만큼만 주고받아요.');
  assert.equal(changeNotice(done, 'edit'), '정산이 끝난 방이에요. 금액이나 사람·날짜를 바꾸면 추가 정산이 열려요. 이미 오간 ₩15,000은 그대로 두고 바뀐 만큼만 주고받아요. 제목·결제 수단만 고치면 그대로예요.');
  assert.equal(changeNotice({ room: room(), expenses: [dinner()] }, 'add'), null, '청구서를 보내기 전에는 바뀌는 게 없다');
  assert.equal(changeNotice({ room: room({ status: 'settling', version: 3 }), expenses: [dinner()], invoices: [invoice('cs', 'accepted', 2)] }, 'add'), null, '이미 다시 보내야 하는 상태면 더 알릴 게 없다');
});

test('방 화면: 단계 막대를 다음 할 일 카드 바로 위에 두고, 저장·고치기 버튼 바로 위에 저장 전 알림을 둔다', () => {
  const src = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');
  assert.match(src, /stepsSection\(\), nextCard\(\)/);
  assert.match(src, /\$\{noticeHtml\(state\.editing \? 'edit' : 'add'\)\}\s*<button class="btn" style="width:100%" data-action="save-expense"/);
  assert.match(src, /\$\{noticeHtml\('expense'\)\}\s*<div style="display:grid;gap:8px">\s*<button class="btn plain" data-action="edit-exp"/);
  assert.doesNotMatch(src, /정산이 끝난 방이라 지출을 고치거나 지울 수 없어요/, '끝난 방도 지출을 받는다(추가 정산)');
  assert.doesNotMatch(src, /room\.status === 'done' \? '' : '<button class="text-btn" data-action="add-expense"/);
  assert.doesNotMatch(src, /\$\('#nav-add'\)\.hidden = state\.data\.room\.status === 'done'/);
});

test('내 방 목록: 진행 중인 방은 이름 아래에 단계와 내 할 일, 진행 막대를 보인다', () => {
  const html = roomRowsHtml([
    { id: 'r', name: '오사카', progress: { step: 3, label: '보내기', summary: '송금 3번 중 1번 받음', ratio: 0.9, mine: 1 } },
    { id: 'q', name: 'MT', progress: { step: 2, label: '응답', summary: '청구서 3개 중 2개 응답', ratio: 0.7, mine: 0, extra: true } },
    { id: 'old', name: '회식' },
  ]);
  assert.match(html, /<span class="room-step">3\/4 보내기 · 내 할 일 1개<\/span>/, '내 차례인 방은 할 일 수를 먼저');
  assert.match(html, /<span class="room-step">추가 정산 · 2\/4 응답 · 청구서 3개 중 2개 응답<\/span>/, '추가 정산 중인 방은 그렇다고 먼저 말한다');
  assert.match(html, /<span class="meter mine" aria-hidden="true"><i style="width:90%"><\/i><\/span>/, '내 할 일이 있는 방의 막대만 강조색');
  assert.match(html, /<span class="meter" aria-hidden="true"><i style="width:70%"><\/i><\/span>/);
  assert.match(html, /id="room-name-2">회식<\/span><\/span>/, '진행 정보가 없는 방은 이름만');
});

test('완료 카드: 요약을 받으면 함께 쓴 돈·내 몫·송금 횟수·비서가 대신 처리한 일과 옮겨 간 곳을 보인다', () => {
  const html = doneCardHtml({ total: 482300, mine: 120575, transfers: 3, naive: 21, autoAccepted: 5, mediated: 1 });
  assert.match(html, /<p class="eyebrow">정산 완료<\/p><h2>정산이 끝났어요<\/h2>/);
  assert.match(html, /<dt>함께 쓴 돈<\/dt><dd class="num">₩482,300<\/dd>/);
  assert.match(html, /<dt>내 몫<\/dt><dd class="num">₩120,575<\/dd>/);
  assert.match(html, /<dt>송금<\/dt><dd>3번 <span class="meta">지출마다 보냈다면 21번<\/span><\/dd>/);
  assert.match(html, /<dt>비서가 대신 처리<\/dt><dd>자동 수락 5 · 중재 1<\/dd>/);
  assert.match(html, /내 방 목록의 ‘끝남’으로 옮겨졌어요/, '방을 나간 게 아니라 끝남으로 옮겨졌음을 그 자리에서 알린다');
  assert.match(html, /늦게 찾은 영수증이 있으면 장부에 지출을 추가해요\. 바뀐 만큼만 추가로 정산해요/, '끝난 방도 지출을 받는다(추가 정산)');
  assert.doesNotMatch(html, /지출을 더 남기거나 고칠 수 없어요/);
  assert.match(doneCardHtml({ total: 10000, mine: 5000, transfers: 1, naive: 1, autoAccepted: 0, mediated: 0 }), /<dt>송금<\/dt><dd>1번<\/dd>/, '줄지 않았으면 비교하지 않는다');
  assert.doesNotMatch(doneCardHtml({ total: 10000, mine: 5000, transfers: 1, naive: 1, autoAccepted: 0, mediated: 0 }), /비서가 대신 처리/);
});

test('완료 요약의 송금 횟수는 추가 정산 전에 오간 송금까지 센다(대체된 송금은 빼고)', () => {
  const transfers = [
    { id: 't0', from: 'cs', to: 'me', amount: 15000, version: 1, status: 'confirmed' },
    { id: 'tx', from: 'ms', to: 'me', amount: 9000, version: 1, status: 'superseded' },
    { id: 't1', from: 'me', to: 'cs', amount: 5000, version: 2, status: 'confirmed' },
  ];
  assert.equal(doneSummary({ room: room({ status: 'done' }), expenses: [dinner()], transfers }, 'me').transfers, 2);
});

test('/api/rooms는 방마다 진행 단계와 내 할 일 수를 함께 준다', async () => {
  const store = new MemoryStore();
  const server = createApp({ store, gemini: null, clock: () => new Date('2026-11-06T10:00:00Z'), env: { DEV_SEED: '1' } });
  await new Promise((r) => server.listen(0, r));
  try {
    const two = [{ uid: 'me', name: '재윤' }, { uid: 'cs', name: '철수' }];
    await store.put('rooms', { id: 'r-live', name: '오사카', members: two, version: 2, status: 'settling' });
    await store.put('rooms', { id: 'r-done', name: '회식', members: two, version: 1, status: 'done' });
    await store.put('expenses', { id: 'r-live:e1', roomId: 'r-live', title: '저녁', payer: 'cs', present: ['me', 'cs'], currency: 'KRW', split: 'equal', amount: 20000, date: '2026-11-05', time: '19:00', createdBy: 'cs' });
    await store.put('invoices', { id: 'r-live:i1', roomId: 'r-live', to: 'me', status: 'accepted', version: 2, net: -10000 });
    await store.put('transfers', { id: 'r-live:t1', roomId: 'r-live', from: 'me', to: 'cs', amount: 10000, version: 2, status: 'due', link: 'toss://x' });
    const res = await fetch(`http://localhost:${server.address().port}/api/rooms`, { headers: { 'x-demo-user': 'me' } });
    const { rooms } = await res.json();
    const live = rooms.find((r) => r.id === 'r-live');
    assert.deepEqual(live.progress, { step: 3, label: '보내기', summary: '송금 1번 중 0번 받음', ratio: 2 / 3, mine: 1, extra: false });
    assert.deepEqual(rooms.find((r) => r.id === 'r-done').progress, { step: 4, label: '끝', summary: '정산이 끝났어요', ratio: 1, mine: 0, extra: false });
  } finally {
    server.close();
  }
});
