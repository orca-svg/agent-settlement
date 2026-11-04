// 체험용 데모의 이야기. 방문자는 '나'이고, 철수·영희·민수는 데모 진행자(director.js)가 대신 움직인다.
// 넷이 다녀온 오사카 여행에서 '나'는 이자카야를 냈고, 철수가 낸 2차 바에서는 22:55쯤 먼저 숙소로 돌아갔다.
// 금액·환율·계좌·위치는 모두 가상의 값이다. 실제 돈은 움직이지 않는다.
import { DEMO_EXPENSES, DEMO_MEMORY } from '../data.js';

export const ME = 'me';
export const ME_PROFILE = { id: ME, name: '나', color: '#007aff' };

// 가상 계좌다. 실제 계좌가 아니다
export const FRIENDS = [
  {
    uid: 'cs', name: '철수', color: '#248a3d',
    memory: DEMO_MEMORY.철수,
    // 낸 돈이 가장 많다. 이의가 오면 중재 비서에게 맡긴다
    rules: { autoAccept: 150_000, sendWhen: 'now', onDispute: 'mediator', notify: 'actions' },
    payout: { bank: '토스뱅크', accountNo: '100000000002', holder: '철수' },
  },
  {
    uid: 'yh', name: '영희', color: '#af52de',
    memory: DEMO_MEMORY.영희,
    rules: { autoAccept: 100_000, sendWhen: 'now', onDispute: 'ask', notify: 'actions' },
    payout: { bank: '카카오뱅크', accountNo: '333300000003', holder: '영희' },
  },
  {
    uid: 'ms', name: '민수', color: '#c93400',
    memory: DEMO_MEMORY.민수,
    // 한도가 작아서 청구서가 오면 비서가 민수에게 묻는다(진행자가 민수 대신 받는다)
    rules: { autoAccept: 50_000, sendWhen: 'now', onDispute: 'ask', notify: 'actions' },
    payout: { bank: '국민은행', accountNo: '940200000004', holder: '민수' },
  },
];
export const friendOf = (uid) => FRIENDS.find((f) => f.uid === uid);

// 데모의 환율(원/100). 실제 고시 값이 아니라 날짜마다 조금씩 움직이는 가상의 값이다
const BASE = { JPY: 905, USD: 1380, EUR: 1490, CNY: 19000, TWD: 4300, THB: 3900, VND: 5.4, PHP: 2400 };
export function fakeRate(currency, date) {
  const base = BASE[currency] ?? 1000;
  const day = Number(String(date).replaceAll('-', '')) || 0;
  const wobble = ((day * 7919) % 41) - 20; // −20 ~ +20, 날짜마다 같다
  return Math.round(base * (1 + wobble / 2000) * 100) / 100;
}

// '11월 7일 – 9일'·'2026년 12월 30일 – 2027년 1월 1일' 같은 방 기간 글에서 여행 첫 사흘을 읽는다(당일·1박이면 마지막 날에 멈춘다).
// 못 읽으면 오늘부터 사흘
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DAY_RE = /(?:(\d{4})년 )?(?:(\d{1,2})월 )?(\d{1,2})일/g;
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
export function tripDays(label, today) {
  const [y0, m0] = today.split('-').map(Number);
  const found = [...String(label ?? '').matchAll(DAY_RE)];
  if (!found.length || !found[0][2]) return [0, 1, 2].map((n) => addDays(today, n));
  const [, sy, sm, sd] = found[0];
  const start = iso(Number(sy || y0), Number(sm), Number(sd));
  let end = found[1] ? iso(Number(found[1][1] || sy || y0), Number(found[1][2] || sm), Number(found[1][3])) : start;
  if (end < start) end = iso(Number(end.slice(0, 4)) + 1, Number(end.slice(5, 7)), Number(end.slice(8))); // 12월 31일 – 1월 1일
  const nights = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000));
  return [0, 1, 2].map((n) => addDays(start, Math.min(n, nights)));
}

// 엔화 금액을 원으로(가상 환율, 100원 단위)
const wonOf = (yen, date) => Math.round((yen * fakeRate('JPY', date)) / 100 / 100) * 100;

// 엔화 금액을 이 방에서 쓰는 통화로 바꾼다. 엔화 방은 그대로, 다른 외화 방은 가상 환율로, 원화 방은 원으로
function amountIn(yen, room, date) {
  const currency = room.fx?.currency ?? 'KRW';
  if (currency === 'JPY') return { currency, amount: yen };
  const krw = wonOf(yen, date);
  if (currency === 'KRW') return { currency, amount: krw };
  return { currency, amount: Math.round((krw / fakeRate(currency, date)) * 100 * 100) / 100 };
}

// 친구들의 비서가 남기는 지출. 큰돈은 철수가 냈다(그래서 '나'의 송금은 철수에게 한 번이다).
// 2차 바도 철수가 카드로 냈고, 주문 시각이 적힌 영수증 줄이 있다(이의·중재의 근거)
const PAYER = { hotel: 'cs', usj: 'cs', bar: 'cs', limo: 'cs', snack: 'yh', lunch: 'ms' };
const SCENARIO_DAYS = ['2026-11-07', '2026-11-08', '2026-11-09'];
export function friendExpenses(room, members, today) {
  const days = tripDays(room.dates, today);
  return DEMO_EXPENSES.filter((e) => PAYER[e.id]).map((e) => {
    const date = days[SCENARIO_DAYS.indexOf(e.date)] ?? days[0];
    const { currency } = amountIn(1, room, date);
    const price = (yen) => amountIn(yen, room, date).amount;
    const input = {
      title: e.title, kind: e.kind, date, time: e.time, payer: PAYER[e.id], method: e.method, currency, present: members, source: 'manual',
      ...(e.items ? { items: e.items.map((it) => ({ ...it, unit: price(it.unit) })) } : { amount: price(e.amount) }),
    };
    return { key: e.id, by: PAYER[e.id], input };
  });
}

// 샘플 영수증(이자카야)을 읽은 결과. 브라우저 데모의 '사진 읽기'는 어떤 사진을 골라도 이 값을 돌려준다.
// 엔화 방이면 일본 가게의 엔화 영수증, 아니면(원화만 쓰는 방, 다른 외화 방) 같은 메뉴의 원화 영수증이다. 원화는 어느 방에서나 쓴다.
// 샘플 영수증 그림(receipt.js)도 이 값으로 그린다
const IZAKAYA = DEMO_EXPENSES.find((e) => e.id === 'izakaya');
export function sampleReceipt(room, today) {
  const date = tripDays(room.dates, today)[0];
  const yen = room.fx?.currency === 'JPY';
  const items = IZAKAYA.items.map(({ id, name, qty, unit, tags }) => ({ id, name, qty, unit: yen ? unit : wonOf(unit, date), tags }));
  return {
    merchant: '이자카야 나니와',
    currency: yen ? 'JPY' : 'KRW',
    date,
    time: IZAKAYA.time,
    total: items.reduce((s, it) => s + it.qty * it.unit, 0),
    items,
    notes: ['체험용 데모라 고른 사진 대신 샘플 영수증(이자카야 나니와)을 읽은 결과예요'],
  };
}
