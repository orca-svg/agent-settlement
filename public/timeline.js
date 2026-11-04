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
  // HH:MM 문자열을 정렬하면 00:05가 전날 23:50보다 먼저 와요.
  // 각 주문을 결제 이전의 날짜에 놓은 뒤 실제 시각으로 비교해요.
  const orders = items.map(it => it.time).filter(Boolean).map(time => {
    const at = atKst(date, time);
    return at > until ? at - DAY : at;
  });
  const from = orders.length ? Math.min(...orders) : until - 3 * 60 * MIN;
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

/**
 * 이의를 낼 때 타임라인으로 맞지 않는 지출을 찾는다. 결제 전에 자리를 떠난 지출만 고르고, 끝까지 있었거나 그 시간대 기록이 없는
 * 지출은 고르지 않는다(사람이 직접 고른다). 각 지출에 상대에게 갈 요약과 '맞지 않는 점'에 채울 글을 붙여 돌려준다
 */
export function findMismatches(visits, expenses) {
  return expenses.flatMap((exp) => {
    const result = departure(visits, exp);
    return result?.leftAt ? [{ expenseId: exp.id, result, summary: timelineSummary(result, exp), claim: timelineClaim(result, exp) }] : [];
  });
}

/**
 * '맞지 않는 점'에 미리 채울 내 말. 떠난 뒤에 시킨 줄이 있으면 그 이름을(셋까지) 적는다. 사람이 고칠 수 있다.
 * 이의 내용은 방 사람 모두가 보고 위치 요약처럼 암호화·7일 삭제를 하지 않으므로, 떠난 시각·도착한 곳은 넣지 않는다
 * (그건 당사자만 보는 위치 요약에 있다. PRIVACY.md)
 */
export function timelineClaim(result, expense) {
  const { from, until } = expenseWindow(expense);
  // 자정을 넘긴 지출이면 떠난 시각·주문 시각이 결제일의 전날일 수 있다(expenseWindow와 같은 규칙)
  const left = [0, -DAY].map((d) => atKst(expense.date, result.leftAt) + d).find((ms) => ms > from && ms < until) ?? until;
  const after = (expense.items ?? []).filter((it) => it.time).filter((it) => {
    const at = atKst(expense.date, it.time);
    return (at > until ? at - DAY : at) > left;
  });
  const names = [...new Set(after.map((it) => it.name))];
  const list = names.length > 3 ? `${names.slice(0, 3).join('·')} 외 ${names.length - 3}개` : names.join('·');
  const text = names.length
    ? `제가 자리를 뜬 뒤에 시킨 것(${list})은 제 몫이 아니에요.`
    : '결제 전에 자리를 떴어요. 끝까지 함께 있지 않았는데 똑같이 나누는 건 맞지 않아요.';
  return text.slice(0, 200);
}

/** 이의 상대와 중재 비서에게 보내는 한 줄. 화면 미리보기와 서버 저장이 같은 글을 쓴다 */
export function timelineSummary(result, expense) {
  const { from, until } = expenseWindow(expense);
  const source = 'Google 지도 타임라인(본인 제출)';
  if (result.stayedUntil) return `첫 주문(${hhmm(from)})부터 결제(${hhmm(until)})까지 같은 곳에 있었어요 · ${source}`;
  const arrived = result.nextAt ? ` · ${result.nextAt} ${result.nextHome ? '집' : '다른 장소'}에 도착` : '';
  return `첫 주문(${hhmm(from)}) 때 머물던 곳을 ${result.leftAt}에 떠났어요${arrived} · ${source}`;
}
