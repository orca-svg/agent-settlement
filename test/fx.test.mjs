// #55 외화 방의 환율 받기(src/rooms/fx.mjs). 바깥 서비스는 부르지 않고 가짜 fetch로 응답을 정해 둔다.
// Frankfurter(유럽중앙은행 기준 환율)가 먼저고, 실패하면 한국수출입은행 매매기준율(KOREAEXIM_API_KEY)로 대신한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFxRates } from '../src/rooms/fx.mjs';

const SECRET = 'exim-test-key-123';
const clock = () => new Date('2026-11-04T03:00:00Z'); // 한국 시각 11/4 12:00
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
// 수출입은행 AP01 한 줄. 엔·루피아는 100단위, 나머지는 1단위이고 금액에 쉼표가 들어 있다
const row = (cur_unit, deal_bas_r) => ({ result: 1, cur_unit, deal_bas_r, cur_nm: cur_unit });

// routes: url → 응답(함수면 url을 받아 부른다). 부른 주소를 차례로 남긴다
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) throw new Error(`예상하지 못한 요청 ${url}`);
    return typeof hit[1] === 'function' ? hit[1](url) : hit[1];
  };
  return { fetch, calls };
}

test('Frankfurter가 주면 그 값을 원/100으로 쓰고, 같은 날짜는 다시 묻지 않는다', async () => {
  const f = fakeFetch({ 'frankfurter.dev/v1/2026-11-02?base=JPY': json({ date: '2026-11-02', rates: { KRW: 9.1234 } }) });
  const fx = createFxRates({ fetch: f.fetch, clock, eximKey: SECRET });
  assert.equal(await fx.rateOn('JPY', '2026-11-02'), 912.34);
  assert.equal(await fx.rateOn('JPY', '2026-11-02'), 912.34);
  assert.equal(f.calls.length, 1);
});

test('오늘보다 뒤 날짜는 최신 값(latest)을 쓴다', async () => {
  const f = fakeFetch({ 'v1/latest?base=USD': json({ date: '2026-11-03', rates: { KRW: 1344.59 } }) });
  assert.equal(await createFxRates({ fetch: f.fetch, clock }).rateOn('USD', '2026-12-25'), 134459);
});

test('Frankfurter가 실패하면 수출입은행 매매기준율로 대신한다(엔은 100엔당, 달러는 쉼표를 지운다)', async () => {
  const f = fakeFetch({
    'frankfurter.dev': json({ message: 'down' }, 522),
    'searchdate=20261102': json([row('JPY(100)', '912.34'), row('USD', '1,344.5'), row('CNH', '187.6')]),
  });
  const fx = createFxRates({ fetch: f.fetch, clock, eximKey: SECRET });
  assert.equal(await fx.rateOn('JPY', '2026-11-02'), 912.34);
  assert.equal(await fx.rateOn('USD', '2026-11-02'), 134450);
  assert.equal(await fx.rateOn('CNY', '2026-11-02'), 18760, '위안은 수출입은행의 CNH');
  assert.equal(f.calls.filter((u) => u.includes('frankfurter')).length, 1, '실패한 뒤에는 한동안 Frankfurter를 기다리지 않는다');
});

test('수출입은행은 주말·공휴일에 빈 목록을 주므로 그 전 영업일까지 거슬러 찾는다', async () => {
  const f = fakeFetch({
    'frankfurter.dev': async () => { throw new Error('timeout'); },
    'searchdate=20261101': json([]), // 일요일
    'searchdate=20261031': json([]), // 토요일
    'searchdate=20261030': json([row('JPY(100)', '849.13')]),
  });
  assert.equal(await createFxRates({ fetch: f.fetch, clock, eximKey: SECRET }).rateOn('JPY', '2026-11-01'), 849.13);
});

test('인증키가 없거나 틀리면 실패하고, 오류에 인증키가 드러나지 않는다', async () => {
  const down = { 'frankfurter.dev': json({}, 522) };
  await assert.rejects(createFxRates({ fetch: fakeFetch(down).fetch, clock }).rateOn('JPY', '2026-11-02'), /Frankfurter 응답 522/);
  const bad = fakeFetch({ ...down, koreaexim: json([{ result: 3, cur_unit: null, deal_bas_r: null }]) });
  await assert.rejects(createFxRates({ fetch: bad.fetch, clock, eximKey: SECRET }).rateOn('JPY', '2026-11-02'), (e) => /결과 코드 3/.test(e.message) && !e.message.includes(SECRET));
  const php = fakeFetch({ ...down, koreaexim: json([row('USD', '1,344.5')]) });
  await assert.rejects(createFxRates({ fetch: php.fetch, clock, eximKey: SECRET }).rateOn('PHP', '2026-11-02'), /고시하지 않는 통화/);
});

test('실패한 결과는 기억하지 않아 다음에 다시 묻는다', async () => {
  let up = false;
  const f = fakeFetch({ 'frankfurter.dev': async () => (up ? json({ rates: { KRW: 9 } }) : json({}, 500)) });
  const fx = createFxRates({ fetch: f.fetch, clock });
  await assert.rejects(fx.rateOn('JPY', '2026-11-02'));
  up = true;
  assert.equal(await fx.rateOn('JPY', '2026-11-02'), 900);
});
