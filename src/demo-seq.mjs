// 체험 데모의 SEQ(팀 요청 11/5). task를 끝낼 때마다 '얼마나 쉬웠나'(1 매우 어려움 ~ 7 매우 쉬움)를 받아 모은다.
// 로그인 없이 받으므로 체험마다 화면이 만든 익명 id(sid)와 task 이름표·점수만 남긴다(이름·계정·IP는 남기지 않는다).
// 같은 체험의 같은 task는 문서 하나라 다시 고르면 덮어쓴다. 평균은 task마다와 전체로 돌려준다
import { HttpError, readJson, createRateLimiter, clientIp } from './http.mjs';

// 체험 데모 task의 이름표(public/demo/guide.js의 task id). 순서가 바뀌어도 뜻이 바뀌지 않게 번호가 아니라 이름으로 센다
export const SEQ_TASKS = ['room', 'agent', 'expense', 'dispute', 'send'];
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

// 공개 주소라 누구나 부를 수 있다. 현장은 같은 와이파이라 여러 사람이 IP 하나를 쓸 수 있어, 한도는 넉넉히 두고 도배만 막는다
export function registerDemoSeqRoutes(routes, { store, clock }) {
  const overLimit = createRateLimiter({ max: 300, windowMs: 600_000 });
  routes.get('/api/demo/seq', async () => seqSummary(await store.list(COL)));
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
