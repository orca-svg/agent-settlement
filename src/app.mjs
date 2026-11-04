// 서버 조립. 의존성(store, gemini, clock, evidenceFor, env)을 주입받아 http.Server를 만든다. listen은 호출하는 쪽이 한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DEMO_ROOM, DEMO_EXPENSES, DEMO_DISPUTE, MEMORY_LIMIT } from '../public/data.js';
import { ledger } from '../public/core.js';
import { router, readJson, readBody, send, allowCors, createRateLimiter, clientIp, HttpError, MAX_RECEIPT } from './http.mjs';
import { createStateLocks } from './state-locks.mjs';
import { createIdentity } from './identity.mjs';
import { firebaseConfig } from './firebase.mjs';
import { registerAccountRoutes } from './accounts.mjs';
import { createLocationService } from './location.mjs';
import { seedDemoRoom } from './dev/seed.mjs';
import { registerExpenseRoutes } from './expenses/routes.mjs';
import { registerRoomRoutes } from './rooms/routes.mjs';
import { pendingActions } from './actions.mjs';
import { createOrchestrator } from './agents/orchestrator.mjs';
import { createAgentSettings, registerAgentSettingsRoutes } from './agents/settings.mjs';
import { registerAgentRoutes } from './agents/routes.mjs';
import { allocateWithGemini } from './agents/allocate.mjs';
import { createCache } from './agents/cache.mjs';
import { createEvidenceProvider, counterFor } from './agents/evidence.mjs';
import { agentsOf, memoryOf, memoryKey } from './agents/memory.mjs';
import { mediateWithGemini } from './agents/mediate.mjs';
import { verifyQrToken } from './payments/qr.mjs';

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

// 계좌·송금 링크는 송금 당사자에게만 보여 준다
export const redactTransfer = (t, uid) => (t.from === uid || t.to === uid ? t : { ...t, link: null, fallback: null });

// 위치 요약은 이의 당사자(이의를 낸 사람과 지출을 낸 사람)와 중재 비서만 본다(#7). 다른 멤버에게는 근거가 붙었다는
// 사실만 남기고, 요약이 옮겨 적혔을 수 있는 중재안 요약과 줄별 이유도 가린다. 저장본은 그대로다
export function redactDispute(d, uid, payer) {
  if (!(d.evidence ?? []).some((e) => e.locationId) || uid === d.by || uid === payer) return d;
  const evidence = d.evidence.map((e) => (e.locationId ? { kind: 'text', summary: '위치 요약 첨부 · 이의 당사자만 볼 수 있어요' } : e));
  if (!d.proposal) return { ...d, evidence };
  const alloc = Object.fromEntries(Object.entries(d.proposal.alloc ?? {}).map(([id, a]) => [id, { ...a, reason: '위치 요약을 참고한 배분' }]));
  return { ...d, evidence, proposal: { ...d.proposal, summary: '위치 요약을 참고한 중재안이에요. 당사자가 확인해 주세요.', alloc } };
}

function serveStatic(pathname, res) {
  const file = path.normalize(path.join(publicDir, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

export function createApp({ store, gemini = null, clock = () => new Date(), evidenceFor, auth = null, env = {} }) {
  // 방·계정 API는 저장소를 읽고 고쳐 쓰므로 줄을 세운다. 방의 일은 그 방의 줄에, 탈퇴처럼 여러 방에 걸친 일은
  // 모든 방의 줄에 서서, 탈퇴·철회가 진행 중인 AI 결과와 엉켜 데이터가 되살아나지 않게 한다(src/state-locks.mjs).
  // #3 저장소는 여러 인스턴스에서 같은 보장을 트랜잭션으로 해야 한다.
  const locks = createStateLocks();
  const dev = env.DEV_SEED === '1' && env.NODE_ENV !== 'production' && !env.FIREBASE_PROJECT_ID && !auth;
  const identify = createIdentity({ auth, dev, now: () => clock().getTime() });
  const locationService = createLocationService({ store, clock });
  evidenceFor ??= createEvidenceProvider({ locationService, dev });
  const origins = (env.ALLOWED_ORIGINS || 'https://orca-svg.github.io').split(',');
  const overLimit = createRateLimiter({ max: 30, windowMs: 600_000 });
  const allocCache = createCache(); // 같은 입력의 메뉴 배분은 Gemini에게 다시 묻지 않는다
  const ctx = { store, gemini, clock, evidenceFor, env, overLimit, allocCache };
  const routes = router();

  const limitGemini = (key) => {
    if (overLimit(key)) throw new HttpError(429, '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.');
  };

  routes.get('/api/config', async () => ({ mode: gemini ? 'gemini' : 'rules', model: gemini?.model ?? null, auth: { firebase: auth ? firebaseConfig(env) : null, dev, emulator: env.NODE_ENV !== 'production' ? env.FIREBASE_AUTH_EMULATOR_HOST || null : null },
    // #3: 저장소가 Firestore이고 로그인이 켜져 있으면 화면이 비서 기록을 onSnapshot으로 받는다(아니면 2초 폴링)
    ...(env.STORE === 'firestore' && auth ? { realtime: { firestore: true, emulator: env.NODE_ENV !== 'production' ? env.FIRESTORE_EMULATOR_HOST || null : null } } : {}) }));
  async function authenticate(req, { allowDeleting = false } = {}) {
    const who = await identify(req, store);
    if (!who || (!allowDeleting && await store.get('deletedUsers', who.uid))) throw new HttpError(401, '로그인이 필요해요');
    return who;
  }
  registerAccountRoutes(routes, { store, authenticate, auth, clock, onErased: () => allocCache.clear() });

  // 데스크톱 QR이 가리키는 곳. 계좌·금액이 든 진짜 링크는 여기서만 풀린다(QR 이미지 서비스는 이 토큰만 본다)
  routes.get('/api/qr/:token', async ({ res, params }) => {
    const link = verifyQrToken(params.token);
    if (!link) throw new HttpError(404, '만료되었거나 잘못된 QR이에요');
    res.writeHead(302, { Location: link });
    res.end();
  });

  // 데모 화면용: 응답 모양은 { lines, source, latencyMs }로 유지한다
  routes.post('/api/allocate', async ({ req }) => {
    limitGemini(clientIp(req));
    const memory = cleanMemory((await readJson(req)).memory, DEMO_ROOM.members);
    const started = Date.now();
    const out = await allocateWithGemini(gemini, demoIzakaya, DEMO_ROOM, memory, { cache: allocCache });
    const latencyMs = Date.now() - started;
    console.log(`[/api/allocate] ${out.how} ${out.source} ${latencyMs}ms`);
    return { lines: out.alloc, source: out.source, how: out.how, latencyMs };
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

  // 방 멤버인지 확인한다. 방이 없으면 404, 누구인지 모르면 401, 멤버가 아니면 403
  // 이 방의 끝난 위치 동의를 지운다. 지우기는 쓰기라 방의 줄 안에서 한다. 줄에 서지 않은 읽기 요청은
  // 지울 것이 있을 때만 줄에 선다(2초마다 오는 화면 갱신이 늘 줄을 서지 않게)
  async function expireLocations(req, roomId) {
    if (req.stateLock) return locationService.sweep(roomId);
    if (await locationService.hasExpired(roomId)) await locks.room(roomId, () => locationService.sweep(roomId));
  }

  async function member(req, roomId) {
    const who = await authenticate(req);
    await expireLocations(req, roomId);
    const room = await store.get('rooms', roomId);
    if (!room) throw new HttpError(404, '방을 찾을 수 없어요');
    const me = room.members.find((m) => m.uid === who.uid);
    if (!me || me.deleted) throw new HttpError(403, '이 방의 멤버가 아니에요');
    return { room, me: { uid: me.uid, name: me.name } };
  }

  // 개발용: 데모 방 만들기. #4 방 만들기가 생기기 전까지 실제 방 화면을 열어 보는 용도
  routes.post('/api/dev/seed', async () => {
    if (!dev) throw new HttpError(404, 'not found');
    const id = `demo-${randomUUID().slice(0, 8)}`;
    await seedDemoRoom(store, { id });
    return { roomId: id };
  });

  routes.get('/api/rooms/:id', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    const [expenses, invoices, disputes, transfers] = await Promise.all(
      ['expenses', 'invoices', 'disputes', 'transfers'].map((col) => store.list(col, { roomId: room.id })),
    );
    // 배분이 지금의 비서 기억과 맞는지. 맞으면 다시 나눠도 같은 답이라 화면이 '다시 나누기'를 막는다
    const agents = await agentsOf(store, room);
    const memoryNow = memoryKey(memoryOf(room, agents));
    return {
      room,
      me,
      expenses: expenses.map((e) => ({ ...e, allocFresh: Boolean(e.alloc) && e.allocMemory === memoryNow })),
      invoices,
      disputes: disputes.map((d) => redactDispute(d, me.uid, expenses.find((e) => e.id === d.expenseId)?.payer)),
      transfers: transfers.map((t) => redactTransfer(t, me.uid)),
      myAgent: await agentSettings.summary(me.uid, room.id),
      // 방 사람에게는 누가 비서 설정을 마쳤는지만 보인다(이름 옆 로봇 표시). 규칙·기억은 본인의 myAgent에만 있다(#5)
      agentReady: room.members.filter((m) => !m.deleted && agents[m.uid]?.onboardedAt).map((m) => m.uid),
      ledger: ledger(room, expenses, room.policy),
      actions: pendingActions({ room, expenses, invoices, disputes, transfers }).filter((x) => x.for === me.uid),
    };
  });

  routes.get('/api/rooms/:id/events', async ({ req, params, url }) => {
    await member(req, params.id);
    return { events: await store.listEvents(params.id, Number(url.searchParams.get('after') || 0)) };
  });

  locationService.register(routes, member);
  registerRoomRoutes(routes, { ...ctx, member, authenticate });
  registerExpenseRoutes(routes, { ...ctx, member });
  const orchestrator = createOrchestrator({ store, gemini, clock, evidenceFor, counterFor: dev ? counterFor : async () => [] });
  registerAgentRoutes(routes, { orchestrator, member, store, overLimit });
  const agentSettings = createAgentSettings({ store, clock });
  registerAgentSettingsRoutes(routes, { settings: agentSettings, authenticate, member });

  // 때가 된 송금 알림. 배포에서는 Cloud Scheduler가 x-cron-secret을 붙여 부른다. 비밀값이 설정되지 않았으면 열지 않는다
  routes.post('/api/cron/tick', async ({ req }) => {
    if (!env.CRON_SECRET || req.headers['x-cron-secret'] !== env.CRON_SECRET) throw new HttpError(401, 'unauthorized');
    await locationService.sweep();
    return orchestrator.tick();
  });

  // 방·계정 API만 줄에 선다(데모 화면 API는 저장소를 쓰지 않는다). 그중 읽기만 하는 요청은 줄에 서지 않는다.
  // 위치 화면(GET …/location)은 읽다가 끝난 동의를 지우므로 쓰기처럼 줄에 선다
  const WRITE_FREE = /\/receipts\/extract$/; // POST지만 저장하지 않는다(사진 → 초안)
  // 방 주소지만 사람마다 하나인 비서 문서를 고치고, 계좌는 다른 방의 송금까지 고치므로 모든 방의 줄에 선다(#5)
  const ACROSS_ROOMS = /^\/api\/rooms\/[^/]+\/(payout|agent\/shared|agent\/rule)$/;
  async function withStateLock(req, url, params, invoke) {
    if (!/^\/api\/(rooms|me|dev|cron)(\/|$)/.test(url.pathname)) return invoke();
    if ((req.method === 'GET' && !url.pathname.endsWith('/location')) || WRITE_FREE.test(url.pathname)) return invoke();
    // 본문은 줄에 서기 전에 받는다. 본문을 느리게 보내는 요청이 줄을 붙잡지 못하게(영수증 사진이 실리는 지출 남기기만 큰 한도)
    await readBody(req, { limit: /^\/api\/rooms\/[^/]+\/expenses$/.test(url.pathname) ? MAX_RECEIPT : undefined });
    req.stateLock = true;
    return url.pathname.startsWith('/api/rooms/') && params.id && !ACROSS_ROOMS.test(url.pathname) ? locks.room(params.id, invoke) : locks.global(invoke);
  }

  const server = http.createServer(async (req, res) => {
    req.identityContext = { auth, dev };
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) res.setHeader('cache-control', 'no-store');
    allowCors(req, res, origins);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    try {
      const hit = routes.match(req.method, url.pathname);
      if (hit) {
        const invoke = () => hit.handler({ req, res, url, params: hit.params, ...ctx });
        const out = await withStateLock(req, url, hit.params, invoke);
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
  server.tick = () => locks.global(async () => { await locationService.sweep(); return orchestrator.tick(); });
  return server;
}
