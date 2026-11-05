// 청구서 시트: 사람에게는 금액과 까닭만 보인다. 방 version 같은 내부 값은 화면에 두지 않는다(사용자 테스트 11/5: "불필요한 정보")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');

test('청구서 시트에 방 version을 보이지 않는다', () => {
  const sheet = src.slice(src.indexOf('function invoiceSheet()'), src.indexOf('function invoiceSheet()') + 2000);
  assert.match(sheet, /낸 돈 \$\{won\(inv\.paid\)\} · 내 몫 \$\{won\(inv\.owed\)\}/);
  assert.doesNotMatch(sheet, /방 version|\$\{inv\.version\}/, 'version은 화면 글자로 내보내지 않는다(비교에만 쓴다)');
});

import { invoiceRows } from '../public/ui.js';
import { ledger } from '../public/core.js';

test('청구서의 지출별 내 몫: 내가 함께한 지출만, 합은 청구서의 내 몫과 같다', () => {
  const room = { currency: 'KRW', policy: 'actual', members: [{ uid: 'a' }, { uid: 'b' }, { uid: 'c' }] };
  const expenses = [
    { id: 'e1', title: '저녁', currency: 'KRW', amount: 30000, payer: 'b', present: ['a', 'b', 'c'], split: 'equal' },
    { id: 'e2', title: '2차', currency: 'KRW', amount: 10000, payer: 'b', present: ['b', 'c'], split: 'equal' },
    { id: 'e3', title: '간식', currency: 'KRW', amount: 10001, payer: 'a', present: ['a', 'c'], split: 'equal' },
  ];
  const rows = invoiceRows({ to: 'a' }, room, expenses);
  assert.deepEqual(rows.map((r) => r.exp.id), ['e1', 'e3'], '함께하지 않은 2차는 빠진다');
  assert.equal(rows.reduce((s, r) => s + r.mine, 0), ledger(room, expenses, room.policy).a.owed);
});

test('청구서 시트는 받기 전에 지출별 내 몫을 보여 준다(사용자 테스트: "무엇이 들었는지 몰라 맞는지 모르겠다")', () => {
  const rows = src.slice(src.indexOf('const currentRows'), src.indexOf('const currentRows') + 300);
  assert.match(rows, /invoiceRows\(inv, state\.data\.room, state\.data\.expenses\)/);
  assert.match(rows, /inv\.version === state\.data\.room\.version/, '지난 청구서에는 지금 지출로 셈한 몫을 붙이지 않는다');
  const sheet = src.slice(src.indexOf('function invoiceSheet()'), src.indexOf('function invoiceSheet()') + 2500);
  assert.match(sheet, /invoiceLinesHtml\(inv, /, '청구서 시트가 그 목록을 그린다');
});

test('이의는 따로 된 목록 없이 청구서의 내 몫 목록 그 자리에서 고른다(사용자 테스트 11/5: 같은 지출이 두 번 보였다)', () => {
  const lines = src.slice(src.indexOf('function invoiceLinesHtml('), src.indexOf('function invoiceSheet()'));
  const form = src.slice(src.indexOf('function disputeForm('), src.indexOf('function scanDispute('));
  assert.ok(lines.length > 0, '내 몫 목록을 그리는 함수가 있다');
  assert.match(lines, /data-action="dispute-toggle"/, '이의를 쓰는 동안 내 몫 목록의 줄을 눌러 고른다');
  assert.match(lines, /on \? ICON_DONE : '<span class="choice-empty"><\/span>'/, '고르지 않은 줄도 빈 동그라미로 고를 수 있어 보인다');
  assert.match(lines, /고른 지출은 중재 비서가 양쪽 근거로 다시 나눠요\. 떠난 시각이 있으면 그 뒤에 시킨 메뉴는 내 몫에서 빠져요\./, '고르면 어떻게 되는지 목록 바로 아래에 알린다');
  assert.doesNotMatch(form, /dispute-toggle|<span>맞지 않는 지출<\/span>/, '이의 폼에 같은 지출 목록을 또 두지 않는다');
  assert.match(form, /위에서 눌러 빼요/, '타임라인이 골라 둔 지출은 위 목록에 있다');
  assert.match(form, /data-action="cancel-dispute"/, '고르다가 그만둘 수 있다');
  assert.match(src, /'cancel-dispute'/, '그만두기 처리가 있다');
});

test('이의를 낼 수 있는 지출은 청구서에 내 몫이 들어간 지출이다(지난 청구서면 함께한 지출)', () => {
  const fn = src.slice(src.indexOf('function disputable('), src.indexOf('function disputable(') + 400);
  assert.match(fn, /currentRows\(inv\)/);
  assert.match(fn, /present\.includes\(inv\.to\)/, '몫을 셀 수 없을 때만 함께한 지출로');
});
