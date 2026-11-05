// 체험 데모에서 영수증 줄이 없는 1/N 지출(난바 호텔 2박)에 이의를 내면, 중재 비서가 줄마다 나눌 수 없어 '아직 중재 전'에서 멈췄다(11/5).
// 그래서 이의는 영수증 줄이 있는 지출에서만 고르고, 줄이 없는 지출을 누르면 그 줄을 흔들고 바로 아래 노란 안내로 '지출 고치기'를 권한다.
// 데모와 실제 방이 같은 화면 코드라 둘 다 같다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');
const src = read('room.js');
const lines = src.slice(src.indexOf('function invoiceLinesHtml('), src.indexOf('function invoiceSheet()'));

test('이의를 낼 수 있는 지출은 영수증 줄이 있는 지출뿐이다(타임라인이 골라 두는 것도 같다)', () => {
  const fn = src.slice(src.indexOf('function disputable('), src.indexOf('function disputable(') + 500);
  assert.match(fn, /\.filter\(mediatable\)/);
  assert.match(src, /const mediatable = \(exp\) => Boolean\(exp\.items\?\.length\)/);
});

test('줄 없는 지출은 흐리게 두고 누를 수 없다고 알리며, 누르면 고르지 않고 안내를 연다', () => {
  assert.match(lines, /aria-disabled="true" data-action="dispute-no-lines"/);
  assert.match(lines, /영수증 줄 없음/, '줄마다 글로도 알린다(색·흐림에만 기대지 않는다)');
  assert.match(lines, /영수증 줄이 있는 지출을 골라 중재를 맡겨요\./, '무엇을 고르면 되는지 목록 바로 아래에서 알린다');
});

test("누른 줄 바로 아래의 노란 안내는 이의 대신 '지출 고치기'를 권하고, 그 버튼은 지출 고치기 화면을 연다", () => {
  assert.match(lines, /class="row lines-hint" role="alert"/);
  assert.match(lines, /영수증 줄이 없어 중재할 수 없어요/);
  assert.match(lines, /data-action="edit-exp" data-id="\$\{esc\(exp\.id\)\}">지출 고치기<\/button>/);
});

test('줄 없는 지출을 누르면 그 줄을 흔든다(움직임 줄이기면 흔들지 않고 표시만)', () => {
  const handler = src.slice(src.indexOf("name === 'dispute-no-lines'"), src.indexOf("name === 'dispute-no-lines'") + 600);
  assert.match(handler, /state\.noLinesHint = d\.id/);
  assert.match(handler, /nudge\(/);
  assert.match(src.match(/const AGENT_ACTIONS = new Set\(\[([^\]]*)\]\)/)[1], /'dispute-no-lines'/);
});

test('체험 데모 task 4 안내도 영수증 줄이 있는 지출을 고르라고 말한다', () => {
  const guide = read('demo/guide.js');
  assert.match(guide, /영수증 줄이 있는 지출만 골라 중재를 맡길 수 있어요/);
});
