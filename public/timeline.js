// Google 지도 타임라인 내보내기 파일(#7)에서 방문만 꺼내, 지출 시간대에 그 사람이 언제 자리를 떠났는지 찾는다.
// 파일은 브라우저 안에서만 읽고 좌표·장소 이름은 꺼내지 않는다. 서버로는 시각만 간다(서버도 이 모듈로 요약을 다시 만든다).
// 휴대폰 내보내기(semanticSegments)와 예전 Takeout(timelineObjects) 두 형식을 읽는다. 형식은 Google 공식 문서가 아니라
// 공개된 분석으로 확인한 것이라, 필요한 키가 없는 방문은 건너뛴다.

const KST = 9 * 60; // 방의 시각은 한국(=일본) 시각이다
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MIN_PROBABILITY = 0.5; // 이보다 확신이 낮은 방문은 근거로 쓰지 않는다
const CONFIDENCE = { USER_CONFIRMED: 1, HIGH_CONFIDENCE: 0.9, MEDIUM_CONFIDENCE: 0.6, LOW_CONFIDENCE: 0.3 };

const valid = (v) => Number.isFinite(v.start) && Number.isFinite(v.end) && v.end > v.start;

/** 방문만 시각 순으로. { start, end, probability, home } (ms, 0~1, 집인지) */
export function readVisits(json) {
  if (Array.isArray(json?.semanticSegments)) {
    const homes = new Set((json.userLocationProfile?.frequentPlaces ?? []).filter((p) => p.label === 'HOME').map((p) => p.placeId));
    return json.semanticSegments
      .filter((s) => s.visit && (s.visit.hierarchyLevel ?? 0) === 0) // 안쪽 계층(같은 장소의 세부 위치)은 겹치므로 뺀다
      .map((s) => {
        const top = s.visit.topCandidate ?? {};
        return { start: Date.parse(s.startTime), end: Date.parse(s.endTime), probability: Number(s.visit.probability ?? top.probability ?? 0), home: /HOME/.test(top.semanticType ?? '') || homes.has(top.placeId) };
      })
      .filter(valid)
      .sort((a, b) => a.start - b.start);
  }
  if (Array.isArray(json?.timelineObjects)) {
    const at = (iso, ms) => (iso ? Date.parse(iso) : Number(ms));
    return json.timelineObjects
      .filter((o) => o.placeVisit)
      .map(({ placeVisit: v }) => ({
        start: at(v.duration?.startTimestamp, v.duration?.startTimestampMs),
        end: at(v.duration?.endTimestamp, v.duration?.endTimestampMs),
        probability: CONFIDENCE[v.placeConfidence] ?? 0,
        home: v.location?.semanticType === 'TYPE_HOME',
      }))
      .filter(valid)
      .sort((a, b) => a.start - b.start);
  }
  throw new Error('Google 지도 타임라인 파일이 아니에요. 휴대폰 Google 지도에서 내보낸 타임라인 파일(.json)을 골라 주세요.');
}

const atKst = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+09:00`);
const hhmm = (ms) => new Date(ms + KST * MIN).toISOString().slice(11, 16);
/** ms → 한국 시각 'HH:MM'. 서버가 받은 시각이 지출 시간대 안인지 확인할 때도 쓴다 */
export const kstTime = hhmm;

/** 지출 시간대: 첫 주문부터 결제까지(ms). 주문 시각이 없으면 결제 3시간 전부터 */
export function expenseWindow({ date, time, items = [] }) {
  const until = atKst(date, time);
  const first = items.map((it) => it.time).filter(Boolean).sort()[0];
  let from = first ? atKst(date, first) : until - 3 * 60 * MIN;
  if (from > until) from -= DAY; // 자정을 넘겨 결제했으면 그 전의 주문은 전날이다
  return { from, until };
}

/**
 * 첫 주문 때 머물던 곳을 결제 전에 떠났는지. 떠났으면 { leftAt, nextAt, nextHome }, 결제 때까지 있었으면 { stayedUntil },
 * 그 시간대 기록이 없거나 확신이 낮으면 null(근거를 넣지 않고 사람이 직접 다룬다).
 * 장소 좌표를 쓰지 않으므로 '첫 주문 때 머물던 곳'을 그 지출의 장소로 본다.
 */
export function departure(visits, expense) {
  const { from, until } = expenseWindow(expense);
  const sure = visits.filter((v) => v.probability >= MIN_PROBABILITY);
  // 첫 주문 뒤 30분 안에 도착했어도 그 자리로 본다
  const there = sure.find((v) => v.start <= from + 30 * MIN && v.end > from);
  if (!there) return null;
  if (there.end >= until - 5 * MIN) return { stayedUntil: hhmm(until) };
  const next = sure.find((v) => v.start >= there.end && v.start <= until + 3 * 60 * MIN);
  return { leftAt: hhmm(there.end), nextAt: next ? hhmm(next.start) : null, nextHome: Boolean(next?.home) };
}

/** 정산당 한 번 올린 파일에서 이 기기에 남길 방문. 지출 시간대(첫 주문~결제 3시간 뒤)에 걸친 방문의 시각만 남긴다 */
export function keepForSettlement(visits, expenses) {
  if (!expenses.length) return [];
  const windows = expenses.map(expenseWindow);
  const lo = Math.min(...windows.map((w) => w.from));
  const hi = Math.max(...windows.map((w) => w.until)) + 3 * 60 * MIN;
  return visits.filter((v) => v.end > lo && v.start < hi).map(({ start, end, probability, home }) => ({ start, end, probability, home }));
}

/** 이의 상대와 중재 비서에게 보내는 한 줄. 화면 미리보기와 서버 저장이 같은 글을 쓴다 */
export function timelineSummary(result, expense) {
  const { from, until } = expenseWindow(expense);
  const source = 'Google 지도 타임라인(본인 제출)';
  if (result.stayedUntil) return `첫 주문(${hhmm(from)})부터 결제(${hhmm(until)})까지 같은 곳에 있었어요 · ${source}`;
  const arrived = result.nextAt ? ` · ${result.nextAt} ${result.nextHome ? '집' : '다른 장소'}에 도착` : '';
  return `첫 주문(${hhmm(from)}) 때 머물던 곳을 ${result.leftAt}에 떠났어요${arrived} · ${source}`;
}
