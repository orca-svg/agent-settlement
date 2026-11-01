// 서버 조립. 의존성(store, gemini, clock, evidenceFor, env)을 주입받아 http.Server를 만든다. listen은 호출하는 쪽이 한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ROOM, DEMO_EXPENSES, DEMO_DISPUTE, MEMORY_LIMIT } from '../public/data.js';
import { router, readJson, send, allowCors, createRateLimiter, clientIp, HttpError } from './http.mjs';
import { allocateWithGemini } from './agents/allocate.mjs';
import { mediateWithGemini } from './agents/mediate.mjs';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

// 화면에서 고친 기억만 받는다. 이름(uid)은 방 멤버만, 사람당 limit개, 한 줄 60자까지.
export function cleanMemory(input, members, limit = MEMORY_LIMIT) {
  const out = {};
  for (const { uid } of members) {
    const list = Array.isArray(input?.[uid]) ? input[uid] : [];
    out[uid] = list.slice(0, limit).map((s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
  }
  return out;
}

// 데모 화면의 이의 제기를 도메인 Dispute 모양으로 바꾼다
const demoIzakaya = DEMO_EXPENSES.find((e) => e.id === 'izakaya');
const demoBar = DEMO_EXPENSES.find((e) => e.id === DEMO_DISPUTE.expense);
const demoDispute = {
  by: DEMO_DISPUTE.by,
  claim: DEMO_DISPUTE.claim,
  evidence: [
    { kind: 'left_at', time: DEMO_DISPUTE.leftAt, summary: DEMO_DISPUTE.evidence[0] },
    ...DEMO_DISPUTE.evidence.slice(1).map((summary) => ({ kind: 'text', summary })),
  ],
};

function serveStatic(pathname, res) {
  const file = path.normalize(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

export function createApp({ store, gemini = null, clock = () => new Date(), evidenceFor = async () => [], env = {} }) {
  const origins = (env.ALLOWED_ORIGINS || 'https://orca-svg.github.io').split(',');
  const overLimit = createRateLimiter({ max: 30, windowMs: 600_000 });
  const ctx = { store, gemini, clock, evidenceFor, env, overLimit };
  const routes = router();

  const limitGemini = (key) => {
    if (overLimit(key)) throw new HttpError(429, '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.');
  };

  routes.get('/api/config', async () => ({ mode: gemini ? 'gemini' : 'rules', model: gemini?.model ?? null }));

  // 데모 화면용: 응답 모양은 { lines, source, latencyMs }로 유지한다
  routes.post('/api/allocate', async ({ req }) => {
    limitGemini(clientIp(req));
    const memory = cleanMemory((await readJson(req)).memory, DEMO_ROOM.members);
    const started = Date.now();
    const out = await allocateWithGemini(gemini, demoIzakaya, DEMO_ROOM, memory);
    const latencyMs = Date.now() - started;
    console.log(`[/api/allocate] ${out.source} ${latencyMs}ms`);
    return { lines: out.alloc, source: out.source, latencyMs };
  });

  routes.post('/api/mediate', async ({ req }) => {
    limitGemini(clientIp(req));
    const memory = cleanMemory((await readJson(req)).memory, DEMO_ROOM.members);
    const started = Date.now();
    const out = await mediateWithGemini(gemini, { exp: demoBar, room: DEMO_ROOM, dispute: demoDispute, counter: DEMO_DISPUTE.counter, memoryByUid: memory });
    const latencyMs = Date.now() - started;
    console.log(`[/api/mediate] ${out.source} ${latencyMs}ms`);
    return { summary: out.summary, lines: out.alloc, source: out.source, latencyMs };
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    allowCors(req, res, origins);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    try {
      const hit = routes.match(req.method, url.pathname);
      if (hit) {
        const out = await hit.handler({ req, res, url, params: hit.params, ...ctx });
        if (!res.writableEnded) send(res, 200, out ?? {});
        return;
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      return serveStatic(url.pathname, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('[error]', e.message);
      return send(res, 500, { error: e.message });
    }
  });
  return server;
}
