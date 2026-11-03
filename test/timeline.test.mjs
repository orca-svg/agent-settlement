// Google 지도 타임라인 내보내기 파일에서 정산 시간대의 방문만 읽는다(#7). 좌표·장소 이름은 꺼내지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVisits, expenseWindow, departure, timelineSummary, keepForSettlement } from '../public/timeline.js';

const seg = (start, end, extra = {}) => ({ startTime: start, endTime: end, startTimeTimezoneUtcOffsetMinutes: 540, endTimeTimezoneUtcOffsetMinutes: 540, ...extra });
const visit = (start, end, { placeId = 'ChIJbar', probability = 0.9, semanticType = 'UNKNOWN', level = 0 } = {}) =>
  seg(start, end, { visit: { hierarchyLevel: level, probability, topCandidate: { placeId, semanticType, probability: 0.8, placeLocation: { latLng: '34.66°, 135.50°' } } } });

// 민수의 2차 바 밤: 22:10~22:55 바, 걸어서 이동, 23:08부터 숙소
const minsu = {
  semanticSegments: [
    visit('2026-11-08T22:10:00.000+09:00', '2026-11-08T22:55:00.000+09:00'),
    visit('2026-11-08T22:20:00.000+09:00', '2026-11-08T22:40:00.000+09:00', { placeId: 'ChIJinner', level: 1 }),
    seg('2026-11-08T22:55:00.000+09:00', '2026-11-08T23:08:00.000+09:00', { activity: { topCandidate: { type: 'WALKING' } } }),
    visit('2026-11-08T23:08:00.000+09:00', '2026-11-09T08:30:00.000+09:00', { placeId: 'ChIJhotel' }),
  ],
};
// 2차 바: 첫 주문 22:30, 다음 주문 23:10, 결제 23:40
const bar = { date: '2026-11-08', time: '23:40', items: [{ time: '23:10' }, { time: '22:30' }] };

test('expenseWindow: 첫 주문부터 결제까지, 주문 시각이 없으면 결제 3시간 전부터', () => {
  assert.deepEqual(expenseWindow(bar), { from: Date.parse('2026-11-08T22:30:00+09:00'), until: Date.parse('2026-11-08T23:40:00+09:00') });
  assert.equal(expenseWindow({ date: '2026-11-08', time: '23:40', items: [] }).from, Date.parse('2026-11-08T20:40:00+09:00'));
  // 자정을 넘겨 결제했으면 그 전의 주문은 전날이다
  assert.equal(expenseWindow({ date: '2026-11-09', time: '00:20', items: [{ time: '23:50' }] }).from, Date.parse('2026-11-08T23:50:00+09:00'));
});

test('departure: 결제 전에 그 자리를 떠났으면 떠난 시각과 다음 장소에 도착한 시각', () => {
  assert.deepEqual(departure(readVisits(minsu), bar), { leftAt: '22:55', nextAt: '23:08', nextHome: false });
});

test('departure: 결제 때까지 같은 곳에 있었으면 그대로 알린다', () => {
  const stayed = { semanticSegments: [visit('2026-11-08T22:00:00.000+09:00', '2026-11-08T23:59:00.000+09:00')] };
  assert.deepEqual(departure(readVisits(stayed), bar), { stayedUntil: '23:40' });
});

test('departure: 그 시간대 기록이 없거나 확신이 낮으면 아무것도 넣지 않는다(null)', () => {
  assert.equal(departure([], bar), null);
  const elsewhen = { semanticSegments: [visit('2026-11-07T19:00:00.000+09:00', '2026-11-07T21:00:00.000+09:00')] };
  assert.equal(departure(readVisits(elsewhen), bar), null);
  const unsure = { semanticSegments: [visit('2026-11-08T22:10:00.000+09:00', '2026-11-08T22:55:00.000+09:00', { probability: 0.3 })] };
  assert.equal(departure(readVisits(unsure), bar), null);
});

test('departure: 자정을 넘긴 지출도 같은 규칙', () => {
  const late = { semanticSegments: [visit('2026-11-08T23:30:00.000+09:00', '2026-11-09T00:05:00.000+09:00')] };
  assert.deepEqual(departure(readVisits(late), { date: '2026-11-09', time: '00:20', items: [{ time: '23:50' }] }), { leftAt: '00:05', nextAt: null, nextHome: false });
});

test('readVisits: 집으로 표시된 장소면 nextHome', () => {
  const home = structuredClone(minsu);
  home.semanticSegments[3].visit.topCandidate.semanticType = 'INFERRED_HOME';
  assert.equal(departure(readVisits(home), bar).nextHome, true);
  const profile = { ...structuredClone(minsu), userLocationProfile: { frequentPlaces: [{ placeId: 'ChIJhotel', label: 'HOME' }] } };
  assert.equal(departure(readVisits(profile), bar).nextHome, true);
});

test('readVisits: 예전 Takeout 형식(timelineObjects)도 같은 결과', () => {
  const placeVisit = (start, end, placeId, placeConfidence = 'HIGH_CONFIDENCE') => ({ placeVisit: { location: { placeId, latitudeE7: 346600000, longitudeE7: 1355000000, name: '어딘가' }, duration: { startTimestamp: start, endTimestamp: end }, placeConfidence } });
  const legacy = {
    timelineObjects: [
      placeVisit('2026-11-08T13:10:00Z', '2026-11-08T13:55:00Z', 'ChIJbar'),
      { activitySegment: { duration: { startTimestamp: '2026-11-08T13:55:00Z', endTimestamp: '2026-11-08T14:08:00Z' } } },
      placeVisit('2026-11-08T14:08:00Z', '2026-11-08T23:30:00Z', 'ChIJhotel'),
    ],
  };
  assert.deepEqual(departure(readVisits(legacy), bar), { leftAt: '22:55', nextAt: '23:08', nextHome: false });
  const low = { timelineObjects: [placeVisit('2026-11-08T13:10:00Z', '2026-11-08T13:55:00Z', 'ChIJbar', 'LOW_CONFIDENCE')] };
  assert.equal(departure(readVisits(low), bar), null);
});

test('readVisits: 좌표와 장소 이름은 꺼내지 않는다', () => {
  const text = JSON.stringify(readVisits(minsu));
  assert.doesNotMatch(text, /latLng|34\.66|135\.50|ChIJ|어딘가/);
});

test('readVisits: 타임라인 파일이 아니면 알려 준다', () => {
  assert.throws(() => readVisits({ foo: [] }), /타임라인 파일이 아니에요/);
  assert.throws(() => readVisits(null), /타임라인 파일이 아니에요/);
});

test('timelineSummary: 첫 주문 때 머물던 곳 기준으로 한 줄을 만든다', () => {
  assert.equal(timelineSummary({ leftAt: '22:55', nextAt: '23:08', nextHome: false }, bar), '첫 주문(22:30) 때 머물던 곳을 22:55에 떠났어요 · 23:08 다른 장소에 도착 · Google 지도 타임라인(본인 제출)');
  assert.equal(timelineSummary({ leftAt: '22:55', nextAt: null, nextHome: false }, bar), '첫 주문(22:30) 때 머물던 곳을 22:55에 떠났어요 · Google 지도 타임라인(본인 제출)');
  assert.equal(timelineSummary({ leftAt: '22:55', nextAt: '23:08', nextHome: true }, bar), '첫 주문(22:30) 때 머물던 곳을 22:55에 떠났어요 · 23:08 집에 도착 · Google 지도 타임라인(본인 제출)');
  assert.equal(timelineSummary({ stayedUntil: '23:40' }, bar), '첫 주문(22:30)부터 결제(23:40)까지 같은 곳에 있었어요 · Google 지도 타임라인(본인 제출)');
});

// 정산당 한 번 올리기: 파일 전체가 아니라 이 정산의 지출 시간대 근처 방문만 이 기기에 남긴다
test('keepForSettlement: 지출 시간대 근처 방문만 남기고, 남긴 것으로도 같은 답을 낸다', () => {
  const lunch = { date: '2026-11-08', time: '13:30', items: [] };
  const far = [visit('2026-10-01T10:00:00.000+09:00', '2026-10-01T12:00:00.000+09:00'), visit('2026-11-20T10:00:00.000+09:00', '2026-11-20T12:00:00.000+09:00')];
  const all = [...readVisits({ semanticSegments: [...far, ...minsu.semanticSegments] })];
  const kept = keepForSettlement(all, [bar, lunch]);
  assert.equal(kept.length, 2);
  assert.ok(kept.every((v) => Object.keys(v).sort().join() === 'end,home,probability,start'));
  assert.deepEqual(departure(kept, bar), departure(all, bar));
  assert.deepEqual(keepForSettlement(all, []), []);
});
