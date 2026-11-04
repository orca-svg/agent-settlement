// #4 방 기간 고르기: '기간' 한 줄을 누르면 그 아래로 달력이 펼쳐지고, 여행 길이 빠른 선택이 붙는다(public/date-range.js).
// 날짜는 'YYYY-MM-DD' 글자로만 다뤄 시간대 때문에 하루가 밀리지 않는다. 오늘은 2026-11-04(수)로 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickDay, presetRange, stayLabel, nextFocus, rangePickerHtml, todayIso } from '../public/date-range.js';

const today = '2026-11-04';

test('두 번 눌러 고른다: 시작 → 끝. 시작보다 앞을 누르면 거기서 다시 시작하고, 다 고른 뒤 누르면 새로 시작한다', () => {
  let r = pickDay({ start: '', end: '' }, '2026-11-07');
  assert.deepEqual(r, { start: '2026-11-07', end: '' });
  r = pickDay(r, '2026-11-09');
  assert.deepEqual(r, { start: '2026-11-07', end: '2026-11-09' });
  assert.deepEqual(pickDay({ start: '2026-11-07', end: '' }, '2026-11-05'), { start: '2026-11-05', end: '' });
  assert.deepEqual(pickDay({ start: '2026-11-07', end: '' }, '2026-11-07'), { start: '2026-11-07', end: '2026-11-07' }, '같은 날을 다시 누르면 당일');
  assert.deepEqual(pickDay(r, '2026-11-20'), { start: '2026-11-20', end: '' });
});

test('며칠짜리인지: 당일 / n박 n+1일', () => {
  assert.equal(stayLabel('2026-11-07', ''), '당일');
  assert.equal(stayLabel('2026-11-07', '2026-11-07'), '당일');
  assert.equal(stayLabel('2026-11-07', '2026-11-09'), '2박 3일');
  assert.equal(stayLabel('2026-11-30', '2026-12-01'), '1박 2일', '달이 바뀌어도');
  assert.equal(stayLabel('', ''), '');
});

test('빠른 선택: 주말은 다가오는 토–일, 길이는 고른 시작일(없으면 오늘)부터', () => {
  assert.deepEqual(presetRange('this-weekend', {}, today), { start: '2026-11-07', end: '2026-11-08' });
  assert.deepEqual(presetRange('next-weekend', {}, today), { start: '2026-11-14', end: '2026-11-15' });
  assert.deepEqual(presetRange('this-weekend', {}, '2026-11-07'), { start: '2026-11-07', end: '2026-11-08' }, '토요일이면 오늘부터');
  assert.deepEqual(presetRange('this-weekend', {}, '2026-11-08'), { start: '2026-11-14', end: '2026-11-15' }, '일요일이면 다음 토요일');
  assert.deepEqual(presetRange('n2', { start: '2026-11-20' }, today), { start: '2026-11-20', end: '2026-11-22' });
  assert.deepEqual(presetRange('n1', { start: '' }, today), { start: '2026-11-04', end: '2026-11-05' });
  assert.deepEqual(presetRange('day', { start: '2026-11-20' }, today), { start: '2026-11-20', end: '2026-11-20' });
});

test('방향키: 좌우 하루, 위아래 한 주, Home·End 그 주의 처음·끝, PageUp·Down 한 달(말일은 그 달 끝으로)', () => {
  assert.equal(nextFocus('2026-11-30', 'ArrowRight'), '2026-12-01');
  assert.equal(nextFocus('2026-11-04', 'ArrowUp'), '2026-10-28');
  assert.equal(nextFocus('2026-11-04', 'ArrowDown'), '2026-11-11');
  assert.equal(nextFocus('2026-11-04', 'Home'), '2026-11-01');
  assert.equal(nextFocus('2026-11-04', 'End'), '2026-11-07');
  assert.equal(nextFocus('2026-01-31', 'PageDown'), '2026-02-28');
  assert.equal(nextFocus('2026-03-31', 'PageUp'), '2026-02-28');
  assert.equal(nextFocus('2026-11-04', 'Enter'), null, '다른 키는 버튼이 그대로 처리한다');
});

test('접힌 상태: 기간 한 줄만 있고, 고르기 전에는 무엇을 하는 줄인지 알린다', () => {
  const closed = rangePickerHtml({ start: '', end: '' }, { open: false, today });
  assert.match(closed, /data-action="range-toggle"[^>]*aria-expanded="false"/);
  assert.match(closed, /날짜 고르기/);
  assert.ok(!closed.includes('data-date='), '접혀 있으면 달력이 없다');
  const picked = rangePickerHtml({ start: '2026-11-07', end: '2026-11-09' }, { open: false, today });
  assert.match(picked, /11월 7일 – 9일 · 2박 3일/);
});

test('펼친 상태: 한 달 달력에 고른 기간이 칠해지고, 빠른 선택과 완료가 같은 자리에 있다', () => {
  const html = rangePickerHtml({ start: '2026-11-07', end: '2026-11-09' }, { open: true, month: '2026-11', today });
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /2026년 11월/);
  assert.equal((html.match(/data-action="range-day"/g) ?? []).length, 30, '11월은 30일');
  assert.match(html, /class="day is-start[^"]*"[^>]*aria-pressed="true"[^>]*data-date="2026-11-07"/);
  assert.match(html, /class="day in-range"[^>]*aria-pressed="false"[^>]*data-date="2026-11-08"/);
  assert.match(html, /class="day [^"]*is-end[^"]*"[^>]*aria-pressed="true"[^>]*data-date="2026-11-09"/);
  assert.match(html, /aria-label="11월 7일 토요일, 시작"/);
  assert.match(html, /aria-label="11월 4일 수요일, 오늘"/);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1, '달력 안에서 Tab으로 들어가는 날은 하나뿐(나머지는 방향키)');
  assert.match(html, /aria-pressed="true"[^>]*data-id="n2"[^>]*>2박 3일/, '고른 기간에 맞는 빠른 선택이 켜져 있다');
  assert.match(html, /aria-pressed="false"[^>]*data-id="this-weekend"/);
  assert.match(html, /data-action="range-month" data-step="-1"[^>]*aria-label="이전 달"/);
  assert.match(html, /data-action="range-toggle"[^>]*>완료/);
});

test('오늘은 이 기기의 날짜(시간대 그대로)', () => {
  assert.equal(todayIso(new Date(2026, 10, 4, 23, 59)), '2026-11-04');
  assert.equal(todayIso(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
});
