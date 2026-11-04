// '내 계정'의 내 비서 기본 설정(public/agent-defaults.js): 받을 계좌와 자동 수락 한도·보낼 시기·이의 처리·알림을 정하면
// 모든 방에 이 설정으로 들어간다. 방마다 다른 값은 그 방의 내 비서에서 '이 방에서만'으로 정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultsHtml, defaultsBody, defaultsChanges, sampleFill } from '../public/agent-defaults.js';
import { readFileSync } from 'node:fs';
import { payoutFieldsHtml, payoutDraftFrom } from '../public/payout-form.js';
import { draftFromRules } from '../public/agent-panel.js';

const rules = { autoAccept: 30_000, sendWhen: { payday: 25 }, onDispute: 'mediator', notify: 'actions' };
const view = (payout = null) => ({ rules, payout, ruleHistory: [] });
const ui = (v, extra = {}) => ({ draft: draftFromRules(v.rules), payout: payoutDraftFrom(v.payout, '재윤'), editPayout: !v.payout, ...extra });

test('기본 설정 화면: 계좌·한도·보낼 시기·이의 처리·알림이 한 화면에 있고, 방마다 다르게 하는 길을 알린다', () => {
  const v = view();
  const html = defaultsHtml(v, ui(v));
  for (const label of ['받을 계좌', '자동 수락 한도', '보낼 시기', '이의 처리', '알림']) assert.ok(html.includes(label), label);
  assert.match(html, /data-ag="autoAccept"[^>]*value="30000"/);
  assert.match(html, /aria-checked="true"[^>]*data-field="mode"[^>]*data-id="payday"/);
  assert.match(html, /aria-checked="true"[^>]*data-field="onDispute"[^>]*data-id="mediator"/);
  assert.match(html, /이 방에서만/, '방마다 다른 값은 그 방에서 정한다고 알린다');
});

test('계좌가 없으면 바로 입력칸을, 있으면 끝 4자리와 바꾸기를 보여 준다(계좌번호 전체는 다시 받지 않는다)', () => {
  const none = view();
  const empty = defaultsHtml(none, ui(none));
  assert.match(empty, /select data-bank-pick/);
  assert.match(empty, /data-pf="accountNo"/);
  const saved = view({ bank: '토스뱅크', holder: '재윤', last4: '3000' });
  const shown = defaultsHtml(saved, ui(saved));
  assert.match(shown, /토스뱅크 •••• 3000/);
  assert.match(shown, /data-action="payout-edit"/);
  assert.ok(!shown.includes('data-pf="accountNo"'), '바꾸기를 누르기 전에는 입력칸을 열지 않는다');
});

test('저장할 것: 바꾼 규칙만 보내고, 계좌는 새 번호를 적었을 때만 보낸다', () => {
  const v = view({ bank: '토스뱅크', holder: '재윤', last4: '3000' });
  const same = ui(v);
  assert.deepEqual(defaultsBody(v, same), { rules: null, payout: null }, '바꾼 것이 없으면 보낼 것도 없다');
  const changed = ui(v, { editPayout: true });
  changed.draft.autoAccept = '50000';
  changed.payout.accountNo = '1000-2000-4000';
  const body = defaultsBody(v, changed);
  assert.equal(body.rules.autoAccept, 50_000);
  assert.deepEqual(body.payout, { bank: '토스뱅크', accountNo: '1000-2000-4000', holder: '재윤' });
});

test('목차가 가리키는 칸: 내 비서 기본 설정(#agent) 아래에 받을 계좌·비서 규칙·알림이 각자 id를 갖는다', () => {
  const v = view();
  const html = defaultsHtml(v, ui(v));
  for (const id of ['agent', 'payout', 'rules', 'notify']) assert.match(html, new RegExp(`id="${id}"`), id);
  assert.ok(html.indexOf('id="payout"') < html.indexOf('id="rules"') && html.indexOf('id="rules"') < html.indexOf('id="notify"'));
  assert.match(html, /<label class="set-name" for="set-auto-accept">자동 수락 한도<\/label>/, '한도 이름을 누르면 금액 칸으로 간다');
});

// 화면 아래 '저장하지 않은 변경 N개'가 세는 것. 저장할 것(defaultsBody)과 같은 기준이라 세는 수와 저장하는 것이 어긋나지 않는다
test('바꾼 칸 세기: 규칙은 칸마다, 계좌는 새 번호를 적었을 때만 하나로 센다', () => {
  const v = view({ bank: '토스뱅크', holder: '재윤', last4: '3000' });
  assert.deepEqual(defaultsChanges(v, ui(v)), []);
  const u = ui(v, { editPayout: true });
  assert.deepEqual(defaultsChanges(v, u), [], '바꾸기만 누르고 아무것도 안 적었으면 바뀐 것이 아니다');
  u.draft.autoAccept = '50000';
  u.draft.mode = 'now';
  u.draft.notify = 'all';
  u.payout.accountNo = '1000-2000-4000';
  assert.deepEqual(defaultsChanges(v, u), ['autoAccept', 'sendWhen', 'notify', 'payout']);
  u.draft.autoAccept = '30,000';
  assert.ok(!defaultsChanges(v, u).includes('autoAccept'), '같은 금액을 쉼표와 함께 적어도 그대로다');
});

test('계좌 입력칸은 방의 계좌 시트와 같은 모양이다: 은행 목록, 목록에 없으면 직접 쓰기, 저장된 끝 4자리 안내', () => {
  const p = payoutDraftFrom({ bank: '경남은행', holder: '재윤', last4: '1234' }, '재윤');
  assert.equal(p.other, true, '목록에 없는 은행이면 직접 쓰기');
  const html = payoutFieldsHtml(p);
  assert.match(html, /data-pf="bank"[^>]*value="경남은행"/);
  assert.match(html, /지금은 •••• 1234/);
  assert.deepEqual(payoutDraftFrom(null, '재윤'), { bank: '토스뱅크', accountNo: '', holder: '재윤', other: false });
});

test('체험 데모: ‘샘플 계좌·한도로 채우기’ 한 번이면 계좌와 한도가 채워지고, 저장하면 처음 설정을 마친다', () => {
  const v = { rules: { autoAccept: 0, sendWhen: 'now', onDispute: 'ask', notify: 'actions' }, payout: null, ruleHistory: [] };
  assert.doesNotMatch(defaultsHtml(v, ui(v)), /data-action="agent-sample"/, '실제 계정에는 두지 않는다');
  assert.match(defaultsHtml(v, ui(v), { demo: true }), /<button type="button" class="btn sm secondary" data-action="agent-sample">샘플 계좌·한도로 채우기<\/button>/);
  const filled = sampleFill(ui(v), '나');
  assert.equal(filled.editPayout, true);
  assert.equal(filled.payout.holder, '나');
  assert.match(filled.payout.accountNo.replace(/\D/g, ''), /^\d{6,}$/, '서버가 받는 계좌번호 모양');
  assert.equal(filled.draft.autoAccept, '50000', '청구서보다 작게 두어 task 4에서 비서가 먼저 묻는다');
  const body = defaultsBody(v, filled);
  assert.ok(body.payout, '계좌가 저장 대상이 된다');
  assert.equal(body.rules?.autoAccept, 50_000, '규칙이 바뀌어 저장하면 처음 설정을 마친 것으로 친다');
  assert.match(defaultsHtml(v, filled, { demo: true }), /data-pf="accountNo" value="110-555-012345"/, '채운 값이 입력칸에 보인다');
});

test('체험 데모 체크리스트: ‘보여 주기’가 샘플 채우기 버튼과 정산 완료 카드의 나가기 버튼을 짚는다', () => {
  const guide = readFileSync(new URL('../public/demo/guide.js', import.meta.url), 'utf8');
  assert.match(guide, /‘샘플 계좌·한도로 채우기’[^\n]*show: '\[data-action="agent-sample"\]'/);
  assert.match(guide, /정산 완료 카드의 ‘이 방에서 나가기’[^\n]*show: '\.next\.done \[data-action="open-leave"\]'/);
});
