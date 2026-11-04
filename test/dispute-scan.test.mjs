// #7 이의를 낼 때 타임라인 하나로 맞지 않는 지출을 찾는다(public/timeline.js). 결제 전에 자리를 떠난 지출만 골라 두고,
// 각 지출의 '맞지 않는 점'을 떠난 시각과 그 뒤에 시킨 줄로 채운다. 사람이 빼거나 고칠 수 있으니 찾기만 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVisits, findMismatches, timelineClaim, timelineSummary } from '../public/timeline.js';

const seg = (start, end, type = 'UNKNOWN') => ({ startTime: `${start}:00.000+09:00`, endTime: `${end}:00.000+09:00`, visit: { hierarchyLevel: 0, probability: 0.9, topCandidate: { semanticType: type } } });
const visits = readVisits({ semanticSegments: [seg('2026-11-03T12:00', '2026-11-03T14:30'), seg('2026-11-03T17:10', '2026-11-03T19:05'), seg('2026-11-03T19:20', '2026-11-03T23:40', 'HOME')] });

const dinner = { id: 'e-dinner', title: '저녁 · 이자카야', date: '2026-11-03', time: '20:30', items: [
  { id: 'a', name: '닭꼬치', time: '18:00' }, { id: 'b', name: '하이볼', time: '19:30' }, { id: 'c', name: '디저트', time: '20:10' },
] };
const lunch = { id: 'e-lunch', title: '점심', date: '2026-11-03', time: '14:00', items: [] }; // 결제까지 같은 곳(12:00~14:30)
const breakfast = { id: 'e-breakfast', title: '아침', date: '2026-11-03', time: '08:30', items: [] }; // 그 시간대 기록 없음

test('결제 전에 자리를 떠난 지출만 찾고, 끝까지 있었거나 기록이 없는 지출은 고르지 않는다', () => {
  const found = findMismatches(visits, [lunch, dinner, breakfast]);
  assert.deepEqual(found.map((f) => f.expenseId), ['e-dinner']);
  const [f] = found;
  assert.deepEqual(f.result, { leftAt: '19:05', nextAt: '19:20', nextHome: true });
  assert.equal(f.summary, timelineSummary(f.result, dinner), '상대·중재 비서에게 가는 요약 한 줄은 서버와 같은 글');
  assert.equal(f.claim, timelineClaim(f.result, dinner));
});

test('맞지 않는 점: 떠난 시각과 그 뒤에 시킨 줄을 내 말로 채운다', () => {
  const claim = timelineClaim({ leftAt: '19:05', nextAt: '19:20', nextHome: true }, dinner);
  assert.match(claim, /19:05에 자리를 떠났어요/);
  assert.ok(claim.includes('하이볼') && claim.includes('디저트'), '떠난 뒤에 시킨 줄');
  assert.ok(!claim.includes('닭꼬치'), '떠나기 전에 시킨 줄은 내 몫이 맞다');
  assert.ok(claim.length <= 200);
});

test('주문 시각이 없는 지출은 결제 시각과 견주어 쓴다', () => {
  const claim = timelineClaim({ leftAt: '19:05', nextAt: null, nextHome: false }, { ...dinner, items: [] });
  assert.match(claim, /19:05에 자리를 떠났어요/);
  assert.match(claim, /20:30/);
});

test('떠난 뒤 시킨 줄이 많으면 몇 개만 적고 나머지는 수로 줄인다', () => {
  const items = [{ id: 'first', name: '닭꼬치', time: '18:00' }, ...['맥주', '사와', '하이볼', '우롱차', '아이스크림'].map((name, i) => ({ id: `x${i}`, name, time: `19:${10 + i * 5}` }))];
  const claim = timelineClaim({ leftAt: '19:05', nextAt: null, nextHome: false }, { ...dinner, items });
  assert.match(claim, /맥주·사와·하이볼 외 2개/);
});
