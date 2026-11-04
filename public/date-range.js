// 방 기간 고르기(#4). '기간' 한 줄을 누르면 그 아래로 한 달 달력이 펼쳐지고, 여행 길이 빠른 선택이 붙는다.
// 날짜는 'YYYY-MM-DD' 글자로만 다룬다. 계산은 UTC 자정으로 해서 기기의 시간대 때문에 하루가 밀리지 않게 한다
import { esc, CHEVRON } from './ui.js';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_MS = 86400000;
const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => iso.split('-').map(Number);
const nightsOf = (start, end) => Math.round((toDate(end) - toDate(start)) / DAY_MS);
const daysIn = (month) => { const [y, m] = parts(month); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

export const addDays = (iso, n) => toIso(new Date(toDate(iso).getTime() + n * DAY_MS));
export const weekday = (iso) => toDate(iso).getUTCDay();
export const shiftMonth = (month, n) => { const [y, m] = parts(month); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return toIso(d).slice(0, 7); };
// 오늘은 이 기기의 날짜다(여행 날짜는 사람이 보는 달력 그대로라 시간대를 바꾸지 않는다)
export const todayIso = (now = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// 고른 기간을 짧은 글자로: 같은 달이면 '11월 7일 – 9일', 해가 다르면 연도까지. 방에 저장되는 기간 글자다
export function datesLabel(start, end) {
  if (!start) return '';
  const day = (iso, withYear) => { const [y, m, d] = parts(iso); return `${withYear ? `${y}년 ` : ''}${m}월 ${d}일`; };
  if (!end || end === start) return day(start, false);
  const [ay, am] = parts(start);
  const [by, bm, bd] = parts(end);
  if (ay !== by) return `${day(start, true)} – ${day(end, true)}`;
  return am === bm ? `${day(start, false)} – ${bd}일` : `${day(start, false)} – ${day(end, false)}`;
}

export function stayLabel(start, end) {
  if (!start) return '';
  const n = end ? nightsOf(start, end) : 0;
  return n > 0 ? `${n}박 ${n + 1}일` : '당일';
}

// 두 번 눌러 고른다. 시작보다 앞을 누르면 거기서 다시 시작하고, 다 고른 뒤 누르면 새 기간을 시작한다
export function pickDay({ start, end }, iso) {
  if (!start || end || iso < start) return { start: iso, end: '' };
  return { start, end: iso };
}

// 빠른 선택: 언제(다가오는 주말)와 며칠(고른 시작일부터, 없으면 오늘부터)
export const PRESETS = [
  { id: 'this-weekend', label: '이번 주말' },
  { id: 'next-weekend', label: '다음 주말' },
  { id: 'day', label: '당일', nights: 0 },
  { id: 'n1', label: '1박 2일', nights: 1 },
  { id: 'n2', label: '2박 3일', nights: 2 },
  { id: 'n3', label: '3박 4일', nights: 3 },
];
export function presetRange(id, { start } = {}, today) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return null;
  if (p.nights === undefined) {
    const sat = addDays(today, ((6 - weekday(today) + 7) % 7) + (id === 'next-weekend' ? 7 : 0));
    return { start: sat, end: addDays(sat, 1) };
  }
  const from = start || today;
  return { start: from, end: addDays(from, p.nights) };
}
const presetOn = (p, { start, end }, today) => {
  if (!start || !end) return false;
  if (p.nights !== undefined) return nightsOf(start, end) === p.nights;
  const r = presetRange(p.id, {}, today);
  return r.start === start && r.end === end;
};

// 달력 안의 방향키(WAI-ARIA 날짜 고르기와 같은 약속). 다른 키면 null(버튼이 그대로 처리한다)
export function nextFocus(iso, key) {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[key];
  if (step) return addDays(iso, step);
  if (key === 'Home') return addDays(iso, -weekday(iso));
  if (key === 'End') return addDays(iso, 6 - weekday(iso));
  if (key === 'PageUp' || key === 'PageDown') {
    const month = shiftMonth(iso.slice(0, 7), key === 'PageUp' ? -1 : 1);
    return `${month}-${pad(Math.min(parts(iso)[2], daysIn(month)))}`;
  }
  return null;
}

function daysHtml(month, { start, end }, today, focus) {
  const first = `${month}-01`;
  const count = daysIn(month);
  const inMonth = (iso) => iso && iso.slice(0, 7) === month;
  const tabDay = [focus, start, today].find(inMonth) || first; // Tab으로 들어오는 날은 하나. 나머지는 방향키로
  const cells = Array.from({ length: weekday(first) }, () => '<span aria-hidden="true"></span>');
  for (let d = 1; d <= count; d++) {
    const iso = `${month}-${pad(d)}`;
    const isStart = iso === start;
    const isEnd = !!end && iso === end;
    const band = start && end && start !== end && iso >= start && iso <= end;
    const cls = ['day', isStart && 'is-start', band && 'in-range', isEnd && 'is-end', iso === today && 'is-today'].filter(Boolean).join(' ');
    const role = isStart ? ', 시작' : isEnd ? ', 끝' : iso === today ? ', 오늘' : '';
    const [, m] = parts(iso);
    cells.push(`<button type="button" class="${cls}" aria-pressed="${isStart || isEnd}" data-action="range-day" data-date="${iso}" tabindex="${iso === tabDay ? 0 : -1}" aria-label="${m}월 ${d}일 ${WEEK[weekday(iso)]}요일${role}"><span>${d}</span></button>`);
  }
  return cells.join('');
}

function hint({ start, end }) {
  if (!start) return '시작하는 날을 눌러 주세요';
  if (!end) return '끝나는 날을 눌러 주세요. 하루짜리면 그대로 두세요';
  return '다른 날을 누르면 처음부터 다시 골라요';
}

// 기간 한 줄 + (펼치면) 빠른 선택과 한 달 달력. 상태(open·month·focus)는 room.js가 들고 있다
export function rangePickerHtml(range, { open = false, month, today, focus = '', entering = false } = {}) {
  const { start = '', end = '' } = range;
  const value = start ? `${datesLabel(start, end)} · ${stayLabel(start, end)}` : '날짜 고르기';
  const row = `<button type="button" class="row range-toggle" data-action="range-toggle" aria-expanded="${open}" aria-controls="range-panel">
      <span class="grow">기간</span><span class="range-value${start ? '' : ' empty'}">${esc(value)}</span>${CHEVRON}</button>`;
  if (!open) return row;
  const shown = month || (start || today).slice(0, 7);
  const [y, m] = parts(shown);
  const presets = PRESETS.map((p) => `<button type="button" class="pick" aria-pressed="${presetOn(p, range, today)}" data-action="range-preset" data-id="${p.id}">${esc(p.label)}</button>`).join('');
  const nav = (step, label, flip) => `<button type="button" class="range-nav" data-action="range-month" data-step="${step}" aria-label="${label}">${flip ? CHEVRON.replace('class="chev"', 'class="chev flip"') : CHEVRON}</button>`;
  return `${row}
    <div class="range-panel${entering ? ' entering' : ''}" id="range-panel">
      <div class="range-presets" role="group" aria-label="빠른 선택">${presets}</div>
      <div class="range-cal">
        <div class="range-head">${nav(-1, '이전 달', true)}<h3 aria-live="polite">${y}년 ${m}월</h3>${nav(1, '다음 달', false)}</div>
        <div class="range-week" aria-hidden="true">${WEEK.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="range-days">${daysHtml(shown, { start, end }, today, focus)}</div>
        <div class="range-foot"><span class="range-hint" role="status">${hint({ start, end })}</span>
          ${start ? '<button type="button" class="text-btn" data-action="range-clear">지우기</button>' : ''}
          <button type="button" class="text-btn done" data-action="range-toggle">완료</button></div>
      </div>
    </div>`;
}
