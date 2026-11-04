// 외화 방(#55)의 환율. 방의 fx 표에 원/100 단위로 둔다. 지출을 남길 때 그 결제일 환율을(fx.base), 청구서를 처음 보낼 때 정산일 환율을(fx.settle) 받는다.
// 먼저 Frankfurter v1(유럽중앙은행 기준 환율, 키 없음)에 묻고, 실패하면 한국수출입은행 매매기준율(data.go.kr, KOREAEXIM_API_KEY)로 대신한다.
// 둘 다 영업일에만 고시해서 주말·공휴일·고시 전 날짜는 그 전 영업일 값을 쓴다. 오늘보다 뒤 날짜는 아직 없어서 최신 값을 쓴다.
import { HttpError } from '../http.mjs';
import { isForeign } from '../../public/core.js';

const ECB = 'https://api.frankfurter.dev/v1';
const EXIM = 'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON';
const EXIM_CODE = { CNY: 'CNH' }; // 수출입은행은 위안을 역외 위안(CNH)으로 고시한다. 필리핀 페소는 고시하지 않는다
const ECB_PAUSE_MS = 10 * 60_000; // Frankfurter가 실패하면 이 동안은 묻지 않고 바로 수출입은행으로 간다(요청마다 시간 초과를 기다리지 않게)
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const kstDay = (now) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const dayBefore = (day) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
const per100 = (krwPerUnit) => Math.round(krwPerUnit * 100 * 100) / 100;

// rateOn(통화, 'YYYY-MM-DD') → 원/100(소수 둘째 자리). 지난 날짜의 고시 값은 바뀌지 않아서 서버가 켜져 있는 동안 다시 묻지 않는다.
// 오류 문구에는 요청 주소를 넣지 않는다(수출입은행 인증키가 주소에 실린다)
export function createFxRates({ fetch = globalThis.fetch, clock = () => new Date(), eximKey = '' } = {}) {
  const cache = new Map();
  let ecbPausedUntil = 0;

  async function fromEcb(currency, ask) {
    const res = await fetch(`${ECB}/${ask}?base=${encodeURIComponent(currency)}&symbols=KRW`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Frankfurter 응답 ${res.status}`);
    const krw = Number((await res.json())?.rates?.KRW);
    if (!(krw > 0)) throw new Error('Frankfurter 응답에 원화 값이 없어요');
    return per100(krw);
  }

  // 주말·공휴일·고시(오전 11시쯤) 전에는 빈 목록이 와서 그 전 영업일까지 7일을 거슬러 찾는다
  async function fromExim(currency, date) {
    const code = EXIM_CODE[currency] ?? currency;
    let day = date;
    for (let i = 0; i < 7; i++, day = dayBefore(day)) {
      const res = await fetch(`${EXIM}?authkey=${encodeURIComponent(eximKey)}&searchdate=${day.replaceAll('-', '')}&data=AP01`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`수출입은행 응답 ${res.status}`);
      const rows = await res.json();
      const failed = rows.find((r) => r.result && r.result !== 1); // 2: 데이터 코드, 3: 인증키, 4: 하루 요청 한도
      if (failed) throw new Error(`수출입은행 결과 코드 ${failed.result}`);
      const row = rows.find((r) => String(r.cur_unit).replace(/\(\d+\)$/, '') === code);
      if (row) return per100(Number(String(row.deal_bas_r).replaceAll(',', '')) / Number(/\((\d+)\)$/.exec(row.cur_unit)?.[1] ?? 1)); // JPY(100)은 100엔당
      if (rows.length) throw new Error(`수출입은행이 고시하지 않는 통화예요: ${currency}`);
    }
    throw new Error('수출입은행에 7일 안의 고시가 없어요');
  }

  async function load(currency, date, today) {
    if (Date.now() >= ecbPausedUntil) {
      try {
        return await fromEcb(currency, date > today ? 'latest' : date);
      } catch (e) {
        if (!eximKey) throw e;
        ecbPausedUntil = Date.now() + ECB_PAUSE_MS;
        console.warn('[fx] Frankfurter 실패, 수출입은행으로 대신해요:', e.message);
      }
    }
    if (!eximKey) throw new Error('Frankfurter를 잠시 쉬는 중이고 수출입은행 인증키가 없어요');
    return fromExim(currency, date > today ? today : date);
  }

  return {
    async rateOn(currency, date) {
      const today = kstDay(clock());
      const key = `${currency}:${date > today ? `latest:${today}` : date}`; // 최신 값은 하루만 쓴다
      if (!cache.has(key)) cache.set(key, load(currency, date, today).catch((e) => { cache.delete(key); throw e; }));
      return cache.get(key);
    },
  };
}

const unavailable = (e) => {
  console.error('[fx]', e.message);
  return new HttpError(503, '환율을 받아 오지 못했어요. 잠시 뒤에 다시 시도해 주세요');
};

// 외화 지출의 결제일 환율이 방 표에 없으면 받아 넣은 방을 돌려준다. 저장은 부르는 쪽이 방 version을 올리며 함께 한다
export async function withDayRate(fx, room, input) {
  const date = String(input?.date ?? '');
  if (!isForeign(room) || input?.currency !== room.fx.currency || !DAY.test(date) || room.fx.base?.[date]) return room;
  const rate = await fx.rateOn(room.fx.currency, date).catch((e) => { throw unavailable(e); });
  return { ...room, fx: { ...room.fx, base: { ...room.fx.base, [date]: rate } } };
}

// '정산일 기준율' 정책의 방은 청구서를 처음 보낼 때 그날 환율을 정산일 환율로 정해 둔다. 이미 정했으면 그대로 둔다
export async function withSettleRate(fx, room, now) {
  if (!isForeign(room) || room.policy !== 'settle' || room.fx.settle) return room;
  const date = kstDay(now);
  const rate = await fx.rateOn(room.fx.currency, date).catch((e) => { throw unavailable(e); });
  return { ...room, fx: { ...room.fx, settle: { date, rate } } };
}
