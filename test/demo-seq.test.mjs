// 체험 데모의 SEQ(팀 요청 11/5): task를 끝낼 때마다 '얼마나 쉬웠나'(1 매우 어려움 ~ 7 매우 쉬움)를 익명으로 받아
// Cloud Run 서버에 모으고, 다섯 task를 모두 끝낸 화면에 task별·전체 평균과 내가 낸 점수를 보여 준다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { SEQ_TASKS, SEQ_TITLES, seqSummary, seqSvg } from '../src/demo-seq.mjs';
import { readFileSync } from 'node:fs';
import { createSeq, seqCardHtml, seqRowHtml, seqTotalHtml } from '../public/demo/seq.js';
import { tasks } from '../public/demo/guide.js';

let server;
let base;
let store;
before(async () => {
  store = new MemoryStore();
  server = createApp({ store, env: {} });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const send = (body, headers = {}) =>
  fetch(`${base}/api/demo/seq`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// ---------------------------------------------------------------- 서버
test('SEQ 받기: 익명 체험 id·task 이름표·1~7 정수만 남기고, 같은 체험의 같은 task는 한 번만 센다', async () => {
  assert.equal((await send({ sid: 'visitor-aaaa1111', task: 'room', score: 5 })).status, 200);
  await send({ sid: 'visitor-aaaa1111', task: 'room', score: 7 }); // 다시 고르면 덮어쓴다
  await send({ sid: 'visitor-bbbb2222', task: 'room', score: 4 });
  const out = await (await send({ sid: 'visitor-bbbb2222', task: 'agent', score: 3 })).json();
  assert.deepEqual(out.tasks.room, { n: 2, avg: 5.5 });
  assert.deepEqual(out.tasks.agent, { n: 1, avg: 3 });
  assert.deepEqual(out.tasks.expense, { n: 0, avg: null }, '아무도 답하지 않은 task는 평균이 없다');
  assert.deepEqual(out.overall, { n: 3, avg: (7 + 4 + 3) / 3 });
  assert.deepEqual(await (await fetch(`${base}/api/demo/seq`)).json(), out, 'GET도 같은 평균을 돌려준다');
  const saved = await store.list('demoSeq');
  assert.deepEqual(Object.keys(saved[0]).sort(), ['at', 'id', 'score', 'sid', 'task'], '이름·계정·IP는 남기지 않는다');
});

test('SEQ 받기: 정해진 task와 1~7 정수가 아니면 400', async () => {
  const ok = { sid: 'visitor-cccc3333', task: 'room', score: 5 };
  for (const bad of [{ ...ok, sid: 'x' }, { ...ok, sid: 'a/b-cccc3333' }, { ...ok, task: 'task3' }, { ...ok, score: 0 }, { ...ok, score: 8 }, { ...ok, score: 4.5 }, { ...ok, score: '5' }, {}]) {
    assert.equal((await send(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await store.list('demoSeq', { sid: 'visitor-cccc3333' })).length, 0);
});

test('SEQ 받기: 체험 화면(GitHub Pages)에서 보낼 수 있다(CORS)', async () => {
  const res = await fetch(`${base}/api/demo/seq`, { method: 'OPTIONS', headers: { origin: 'https://orca-svg.github.io', 'access-control-request-method': 'POST' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://orca-svg.github.io');
});

// 현장(Demo Market)은 같은 와이파이라 여러 사람이 IP 하나를 쓸 수 있다. 그래서 한도는 넉넉히, 도배만 막는다
test('SEQ 받기: 한 IP에서 10분에 300번이 넘으면 429', async () => {
  const from = { 'x-forwarded-for': '203.0.113.9' };
  for (let i = 0; i < 300; i += 1) assert.equal((await send({ sid: `flood-${String(i).padStart(8, '0')}`, task: 'send', score: 1 }, from)).status, 200);
  assert.equal((await send({ sid: 'flood-99999999', task: 'send', score: 1 }, from)).status, 429);
  assert.equal((await send({ sid: 'visitor-dddd4444', task: 'send', score: 6 }, { 'x-forwarded-for': '203.0.113.10' })).status, 200, '다른 IP는 그대로 받는다');
});

test('SEQ 평균: 모르는 task 이름표는 세지 않는다', () => {
  const out = seqSummary([{ task: 'room', score: 6 }, { task: 'old-task', score: 1 }]);
  assert.deepEqual(out.tasks.room, { n: 1, avg: 6 });
  assert.deepEqual(out.overall, { n: 1, avg: 6 });
});

// README에 띄우는 표 이미지(팀 요청 11/5): 서버가 그때그때 그리는 SVG. GitHub 테마에 맞춰 밝은·어두운 판을 따로 낸다
const summary5 = { tasks: { room: { n: 5, avg: 6 }, agent: { n: 4, avg: 3.75 }, expense: { n: 4, avg: 5.25 }, dispute: { n: 3, avg: 3 }, send: { n: 3, avg: 7 } }, overall: { n: 19, avg: 97 / 19 } };
const NOW_KST = new Date('2026-11-06T05:05:00Z'); // 11월 6일 14:05(KST)

test('SEQ 표 이미지: task 순서대로 이름·막대·평균·사람 수, 맨 아래 전체 평균과 응답 수', () => {
  const svg = seqSvg(summary5, { now: NOW_KST });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="560" height="\d+" viewBox="0 0 560 \d+" role="img" aria-labelledby="seq-t seq-d">/);
  const order = SEQ_TITLES.map((t) => svg.indexOf(t));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), '다섯 task가 순서대로 있다');
  for (const v of ['6.0', '3.8', '5.3', '3.0', '7.0']) assert.match(svg, new RegExp(`>${v.replace('.', '\\.')}</text>`));
  assert.match(svg, />5명</);
  assert.match(svg, />전체</);
  assert.match(svg, />5\.1</);
  assert.match(svg, />19개</);
  assert.match(svg, /1 매우 어려움 ~ 7 매우 쉬움 · 11월 6일 14:05 기준/);
  assert.match(svg, /<desc id="seq-d">[^<]*여행 방 만들고 친구 초대하기 6\.0점\(5명\)/, '화면 읽기에도 숫자를 알린다');
});

test('SEQ 표 이미지: 막대 길이는 1~7 눈금(1이면 0, 7이면 꽉 참), 아무도 답하지 않은 task는 막대 없이 –', () => {
  const svg = seqSvg({ tasks: { room: { n: 1, avg: 7 }, agent: { n: 1, avg: 1 }, expense: { n: 1, avg: 4 }, dispute: { n: 0, avg: null }, send: { n: 0, avg: null } }, overall: { n: 3, avg: 4 } }, { now: NOW_KST });
  const bars = [...svg.matchAll(/<rect class="bar" x="330" y="\d+" width="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(bars, [130, 0, 65]);
  assert.equal((svg.match(/>–<\/text>/g) ?? []).length, 2);
  assert.match(svg, />0명</);
});

test('SEQ 표 이미지: 밝은·어두운 테마 색을 따로 쓰고, 모르는 테마는 밝은 판', () => {
  assert.match(seqSvg(summary5, { now: NOW_KST, theme: 'dark' }), /fill="#151b23"/);
  assert.match(seqSvg(summary5, { now: NOW_KST, theme: 'light' }), /fill="#ffffff"/);
  assert.match(seqSvg(summary5, { now: NOW_KST, theme: '<x>' }), /fill="#ffffff"/);
});

test('SEQ 표 이미지 주소: 이미지로 돌려주고 캐시하지 말라고 알린다', async () => {
  const res = await fetch(`${base}/api/demo/seq.svg?theme=dark`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^image\/svg\+xml/);
  assert.match(res.headers.get('cache-control'), /no-cache/);
  assert.match(await res.text(), /^<svg [\s\S]*fill="#151b23"[\s\S]*<\/svg>$/);
});

test('README는 GitHub 테마에 맞는 SEQ 표 이미지를 띄우고, 이름은 체험 데모의 task 이름과 같다', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const cloudRun = readFileSync(new URL('../public/api.js', import.meta.url), 'utf8').match(/CLOUD_RUN_URL = '([^']+)'/)[1];
  assert.match(readme, new RegExp(`<source media="\\(prefers-color-scheme: dark\\)" srcset="${cloudRun.replaceAll('.', '\\.')}/api/demo/seq\\.svg\\?theme=dark">`));
  assert.match(readme, new RegExp(`<img src="${cloudRun.replaceAll('.', '\\.')}/api/demo/seq\\.svg\\?theme=light" width="560" alt="[^"]+">`));
  const s = { room: null, invite: null, expenses: [], invoices: [], disputes: [], transfers: [], location: [], agent: null };
  assert.deepEqual(SEQ_TITLES, tasks(s).map((t) => t.title));
});

// ---------------------------------------------------------------- 화면
test('데모 task마다 SEQ 이름표가 있고, 서버가 받는 목록과 같은 순서다', () => {
  const s = { room: null, invite: null, expenses: [], invoices: [], disputes: [], transfers: [], location: [], agent: null };
  assert.deepEqual(tasks(s).map((t) => t.id), SEQ_TASKS);
});

test('SEQ 묻기: 끝낸 task 중 아직 답하지 않은 첫 task를 묻고, 점수는 브라우저에 남기고 서버로 보낸다', async () => {
  const storage = memoryStorage();
  const calls = [];
  const summary = { tasks: Object.fromEntries(SEQ_TASKS.map((t) => [t, { n: 0, avg: null }])), overall: { n: 0, avg: null } };
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(summary), { status: 200 });
  };
  const seq = createSeq({ fetch, base: 'https://api.example', storage });
  assert.equal(storage.getItem('agent-settlement.demo.seq'), null, '답하기 전에는 브라우저에 아무것도 남기지 않는다(첫 화면만 연 사람)');
  const list = [{ id: 'room', n: 1, done: true }, { id: 'agent', n: 2, done: true }, { id: 'expense', n: 3, done: false }];
  assert.equal(seq.pending(list).id, 'room');
  await seq.rate('room', 6);
  assert.equal(seq.pending(list).id, 'agent', '답한 task는 다시 묻지 않는다');
  seq.skip('agent');
  assert.equal(seq.pending(list), null, '건너뛴 task도 다시 묻지 않는다');
  assert.deepEqual(seq.mine(), { room: 6 });
  assert.deepEqual(calls, [{ url: 'https://api.example/api/demo/seq', method: 'POST', body: { sid: calls[0].body.sid, task: 'room', score: 6 } }]);
  assert.match(calls[0].body.sid, /^[A-Za-z0-9_-]{8,64}$/);
  assert.deepEqual(seq.summary(), summary, '보낸 응답의 평균을 그대로 쓴다');
  assert.equal(seq.complete(['room', 'agent']), true, '답하거나 건너뛰었으면 끝낸 것');
  assert.equal(seq.complete(SEQ_TASKS), false);

  // '처음부터 다시'는 데모 기록만 지운다. 이미 답한 사람에게 SEQ를 다시 묻지 않는다
  const again = createSeq({ fetch, base: 'https://api.example', storage });
  assert.deepEqual(again.mine(), { room: 6 }, '새로 고치거나 다시 해도 남아 있다');
  assert.equal(again.pending(list), null);
  assert.equal(again.pending([...list.slice(0, 2), { id: 'expense', n: 3, done: true }]).id, 'expense', '아직 답하지 않은 task만 묻는다');
  await again.rate('expense', 2);
  assert.equal(calls.at(-1).body.sid, calls[0].body.sid, '같은 체험 id라 서버는 한 사람을 두 번 세지 않는다');
});

test('SEQ 묻기: 서버에 보내지 못해도 내 점수는 남고, 평균은 못 불러왔다고 알린다', async () => {
  const seq = createSeq({ fetch: async () => { throw new TypeError('Failed to fetch'); }, base: '', storage: memoryStorage() });
  await seq.rate('room', 5);
  assert.deepEqual(seq.mine(), { room: 5 });
  assert.equal(seq.status(), 'error');
  assert.equal(seq.summary(), null);
});

test('SEQ 완료 카드: 화면 가운데 대화상자로 방금 끝낸 task를 묻고, 1~7 버튼 양 끝에 뜻을 적는다', () => {
  const t = { id: 'agent', n: 2, title: '내 계좌와 비서에게 맡길 범위 정하기' };
  const html = seqCardHtml(t);
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="seq-card-title"/);
  assert.match(html, /id="seq-card-title">Task 2를 끝냈어요</);
  assert.match(html, /내 계좌와 비서에게 맡길 범위 정하기/);
  assert.match(html, /얼마나 쉬웠나요/);
  assert.equal((html.match(/data-seq="rate" data-task="agent" data-score="[1-7]"/g) ?? []).length, 7);
  assert.match(html, /aria-label="1점 · 매우 어려움"/);
  assert.match(html, /aria-label="7점 · 매우 쉬움"/);
  assert.match(html, />매우 어려움<[\s\S]*>매우 쉬움</, '숫자만이 아니라 양 끝의 뜻도 글로 보인다');
  assert.match(html, /data-seq="skip" data-task="agent"[^>]*>건너뛰기</);
  const chosen = seqCardHtml(t, 6);
  assert.match(chosen, /aria-pressed="true"[^>]*data-score="6"|data-score="6"[^>]*aria-pressed="true"/, '고른 칸이 눌린 채로 보인다');
  assert.match(chosen, /role="status"[^>]*>6점을 남겼어요</);
});

test('첫 화면 결과: task 줄마다 모두의 평균과 내 점수, 아래에 전체 평균', () => {
  const summary = { tasks: { room: { n: 4, avg: 6 }, agent: { n: 1, avg: 3 }, expense: { n: 0, avg: null }, dispute: { n: 0, avg: null }, send: { n: 0, avg: null } }, overall: { n: 5, avg: 27 / 5 } };
  assert.match(seqRowHtml('room', { room: 6 }, summary), /class="seq-res"[\s\S]*평균 6\.0[\s\S]*나 6 · 4명/);
  assert.match(seqRowHtml('expense', {}, summary), /평균 –[\s\S]*나 – · 0명/, '아무도 답하지 않았으면 빈칸');
  assert.match(seqRowHtml('agent', { agent: 4 }, null), /평균 …[\s\S]*나 4/, '평균을 불러오기 전에도 내 점수는 보인다');
  assert.match(seqTotalHtml(SEQ_TASKS, { room: 6, agent: 4 }, summary, 'ready'), /전체 평균 5\.4[\s\S]*내 평균 5\.0[\s\S]*응답 5개/);
  assert.match(seqTotalHtml(SEQ_TASKS, {}, null, 'loading'), /평균을 불러오는 중이에요/);
  assert.match(seqTotalHtml(SEQ_TASKS, { room: 6 }, null, 'error'), /data-seq="retry"[^>]*>다시 불러오기</);
});

test('첫 화면은 SEQ를 다 끝낸 사람에게만 평균을 보이고, 데모는 마지막 답 뒤 첫 화면으로 돌아간다', () => {
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  const index = read('index.html');
  const ids = [...index.match(/<ol class="list intro-tasks">([\s\S]*?)<\/ol>/)[1].matchAll(/data-task="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, SEQ_TASKS, '줄마다 task 이름표가 있다');
  assert.match(index, /seq\.complete\(IDS\)/, '끝내지 않은 사람에게는 평균을 미리 보이지 않는다(먼저 본 숫자에 끌리지 않게)');
  assert.match(index, /storage: \(\(\) => \{ try \{ return localStorage/, '답한 기록은 이 브라우저에 남는다');
  assert.match(read('demo/boot.js'), /storage: \(\(\) => \{ try \{ return localStorage/, '데모도 같은 브라우저 저장소를 쓴다');
  assert.doesNotMatch(read('demo/boot.js'), /seq\.clear\(\)/, '처음부터 다시 해도 SEQ 답은 지우지 않는다');
  assert.match(read('demo/guide.js'), /location\.href = '\.\.\/'/, '마지막 답 뒤 첫 화면으로');
});

// 고르면 카드를 새로 그리지 않는다. 새로 그리면 여는 애니메이션이 다시 돌아 '새 카드가 뜬' 것처럼 보인다(11/5).
// 고른 칸만 그 자리에서 눌린 색이 되고, 잠시 뒤 닫히는 애니메이션으로 사라진다
test('SEQ 완료 카드: 고른 칸은 그 자리에서 눌린 채로 바뀌고, 잠시 뒤 닫히는 애니메이션으로 사라진다', () => {
  const guide = readFileSync(new URL('../public/demo/guide.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/demo/demo.css', import.meta.url), 'utf8');
  assert.doesNotMatch(guide, /renderCard\(null\)/, '고른 뒤 카드를 다시 그리지 않는다');
  assert.match(guide, /markChosen\(/);
  assert.match(guide, /classList\.add\('closing'\)/);
  assert.match(css, /\.seq-root\.closing \.seq-card \{[^}]*animation: seq-out/);
  assert.match(css, /@keyframes seq-out/);
});
