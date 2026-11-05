// 체험 데모의 SEQ(팀 요청 11/5). task를 끝낼 때마다 '얼마나 쉬웠나'(1 매우 어려움 ~ 7 매우 쉬움)를 받아 모은다.
// 로그인 없이 받으므로 체험마다 화면이 만든 익명 id(sid)와 task 이름표·점수만 남긴다(이름·계정·IP는 남기지 않는다).
// 같은 체험의 같은 task는 문서 하나라 다시 고르면 덮어쓴다. 평균은 task마다와 전체로 돌려준다
import { HttpError, readJson, createRateLimiter, clientIp } from './http.mjs';

// 체험 데모 task의 이름표(public/demo/guide.js의 task id). 순서가 바뀌어도 뜻이 바뀌지 않게 번호가 아니라 이름으로 센다
export const SEQ_TASKS = ['room', 'agent', 'expense', 'dispute', 'send'];
// README 표 이미지에 쓰는 task 이름. 체험 데모의 체크리스트·첫 화면과 같은 단어다(test/demo-seq.test.mjs가 맞춰 본다)
export const SEQ_TITLES = ['여행 방 만들고 친구 초대하기', '내 계좌와 비서에게 맡길 범위 정하기', '지출 남기기', '맞지 않는 몫 바로잡기', '보내고 마무리하기'];
const COL = 'demoSeq';
const SID = /^[A-Za-z0-9_-]{8,64}$/;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// → { tasks: { room: { n, avg }, … }, overall: { n, avg } }. 아무도 답하지 않았으면 avg는 null
export function seqSummary(docs) {
  const known = docs.filter((d) => SEQ_TASKS.includes(d.task));
  const tasks = Object.fromEntries(SEQ_TASKS.map((t) => {
    const scores = known.filter((d) => d.task === t).map((d) => d.score);
    return [t, { n: scores.length, avg: mean(scores) }];
  }));
  const all = known.map((d) => d.score);
  return { tasks, overall: { n: all.length, avg: mean(all) } };
}

// README의 표 이미지(SVG). 카드 안에 task마다 이름·막대·평균·사람 수, 맨 아래 전체 평균과 응답 수를 그린다.
// 막대는 1~7 눈금이라 1이면 0, 7이면 꽉 찬다(양은 길이로). 색은 GitHub(Primer) 색을 빌려 밝은·어두운 판을 따로 낸다
const THEMES = {
  light: { bg: '#ffffff', line: '#d1d9e0', text: '#1f2328', muted: '#59636e', track: '#eff2f5', bar: '#0969da' },
  dark: { bg: '#151b23', line: '#3d444d', text: '#f0f6fc', muted: '#9198a1', track: '#262c36', bar: '#4493f8' },
};
const xml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const one = (x) => (x == null ? '–' : x.toFixed(1));
const kst = (d) => {
  const k = new Date(d.getTime() + 9 * 3_600_000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}`;
};
export function seqSvg(summary, { now = new Date(), theme = 'light' } = {}) {
  const c = THEMES[theme] ?? THEMES.light;
  const W = 560;
  const ROW = 36;
  const top = 48;
  const total = top + SEQ_TASKS.length * ROW;
  const H = total + ROW + 8;
  const BAR = 130;
  const rows = SEQ_TASKS.map((id, i) => {
    const y = top + i * ROW;
    const { n, avg } = summary.tasks[id];
    const width = avg == null ? null : Math.round(((avg - 1) / 6) * BAR * 10) / 10;
    return `<line x1="20" x2="540" y1="${y}" y2="${y}" stroke="${c.line}"/>
  <text x="20" y="${y + 23}" font-size="13" fill="${c.muted}">${i + 1}</text>
  <text x="36" y="${y + 23}" font-size="14" fill="${c.text}">${xml(SEQ_TITLES[i])}</text>
  <rect class="track" x="330" y="${y + 14}" width="${BAR}" height="8" rx="4" fill="${c.track}"/>
  ${width == null ? '' : `<rect class="bar" x="330" y="${y + 14}" width="${width}" height="8" rx="4" fill="${c.bar}"/>`}
  <text x="500" y="${y + 23}" font-size="14" font-weight="600" text-anchor="end" fill="${c.text}">${one(avg)}</text>
  <text x="540" y="${y + 23}" font-size="12" text-anchor="end" fill="${c.muted}">${n}명</text>`;
  }).join('\n  ');
  const o = summary.overall;
  const desc = [...SEQ_TASKS.map((id, i) => `${SEQ_TITLES[i]} ${summary.tasks[id].avg == null ? '아직 응답 없음' : `${one(summary.tasks[id].avg)}점(${summary.tasks[id].n}명)`}`), `전체 ${o.avg == null ? '아직 응답 없음' : `${one(o.avg)}점(응답 ${o.n}개)`}`].join(', ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="seq-t seq-d">
  <title id="seq-t">체험 데모 SEQ</title>
  <desc id="seq-d">얼마나 쉬웠나요(1 매우 어려움 ~ 7 매우 쉬움): ${xml(desc)}</desc>
  <style>text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif; font-variant-numeric: tabular-nums; }</style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${c.bg}" stroke="${c.line}"/>
  <text x="20" y="32" font-size="15" font-weight="600" fill="${c.text}">체험 데모 SEQ</text>
  <text x="540" y="32" font-size="12" text-anchor="end" fill="${c.muted}">1 매우 어려움 ~ 7 매우 쉬움 · ${kst(now)} 기준</text>
  ${rows}
  <line x1="20" x2="540" y1="${total}" y2="${total}" stroke="${c.muted}"/>
  <text x="20" y="${total + 23}" font-size="14" font-weight="600" fill="${c.text}">전체</text>
  <text x="500" y="${total + 23}" font-size="14" font-weight="600" text-anchor="end" fill="${c.text}">${one(o.avg)}</text>
  <text x="540" y="${total + 23}" font-size="12" text-anchor="end" fill="${c.muted}">${o.n}개</text>
</svg>`;
}

// 공개 주소라 누구나 부를 수 있다. 현장은 같은 와이파이라 여러 사람이 IP 하나를 쓸 수 있어, 한도는 넉넉히 두고 도배만 막는다
export function registerDemoSeqRoutes(routes, { store, clock }) {
  const overLimit = createRateLimiter({ max: 300, windowMs: 600_000 });
  routes.get('/api/demo/seq', async () => seqSummary(await store.list(COL)));
  // README의 표 이미지. GitHub 이미지 프록시가 오래 들고 있지 않게 캐시하지 말라고 알린다
  routes.get('/api/demo/seq.svg', async ({ res, url }) => {
    const svg = seqSvg(seqSummary(await store.list(COL)), { now: clock(), theme: url.searchParams.get('theme') });
    res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-cache, max-age=0' });
    res.end(svg);
  });
  routes.post('/api/demo/seq', async ({ req }) => {
    if (overLimit(clientIp(req))) throw new HttpError(429, '잠시 뒤에 다시 보내 주세요');
    const { sid, task, score } = await readJson(req, { limit: 1_000 });
    if (typeof sid !== 'string' || !SID.test(sid)) throw new HttpError(400, '체험 id가 올바르지 않아요');
    if (!SEQ_TASKS.includes(task)) throw new HttpError(400, '모르는 task예요');
    if (!Number.isInteger(score) || score < 1 || score > 7) throw new HttpError(400, '점수는 1~7 사이의 정수예요');
    await store.put(COL, { id: `${sid}_${task}`, sid, task, score, at: clock().toISOString() });
    return seqSummary(await store.list(COL));
  });
}
