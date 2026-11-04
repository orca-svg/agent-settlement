// 브라우저 안의 데모 서버. 실제 서버 라우트(src/api.mjs)를 메모리 저장소로 그대로 돌리고, 저장소는 sessionStorage에 남겨
// 내 방 ↔ 방 화면을 오가도 이어진다(탭을 닫으면 사라진다). 실제 서버·Firestore·Gemini·환율 API에는 연결하지 않는다.
// 데모만 다른 곳: 신원은 늘 '나'(친구들은 진행자가 그 신원으로 부른다), 환율은 가상의 값, 영수증 읽기는 샘플 영수증,
// 송금 링크는 토스 대신 데모 안내(#demo-toss)
import { createApi } from '#src/api.mjs';
import { MemoryStore } from '#src/store/memory.mjs';
import { extractReceipt } from '#src/expenses/receipt.mjs';
import { kstDay } from '#src/rooms/fx.mjs';
import { ME, ME_PROFILE, FRIENDS, fakeRate, sampleReceipt } from './scenario.js';
import { createDirector } from './director.js';

const KEY = 'agent-settlement.demo.v1';
const ROOM_KEY = 'agent-settlement.demo.room'; // 방문자가 마지막으로 만든 방(task 안내가 따라가는 방)
// 화면(auth.js·room.js·account.js)이 데모임을 아는 유일한 곳. Firebase 없이 '나'로 로그인한 것처럼 둔다
export const DEMO_CONFIG = { mode: 'gemini', model: null, demo: true, auth: { firebase: null, dev: false, demo: true } };

const reply = (status, body) => ({ status, body });
const TICK_MS = 3000;

// http.ServerResponse 대신. 라우트가 send(res, …)로 직접 답한 경우(201 등)만 쓴다
function fakeRes() {
  const res = { status: 200, body: undefined, writableEnded: false };
  res.setHeader = () => {};
  res.writeHead = (status) => { res.status = status; };
  res.end = (text = '') => {
    res.body = text ? JSON.parse(text) : {};
    res.writableEnded = true;
  };
  return res;
}

function save(store, storage) {
  const dump = (dropPhotos) => JSON.stringify({
    v: 1,
    cols: [...store.cols].map(([name, docs]) => [name, dropPhotos && name === 'receipts' ? [] : [...docs.values()]]),
    events: [...store.events],
  });
  try {
    storage?.setItem(KEY, dump(false));
  } catch {
    try { storage?.setItem(KEY, dump(true)); } catch {} // 사진이 커서 한도를 넘으면 사진만 빼고 남긴다
  }
}

function load(store, storage) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) ?? 'null');
    if (saved?.v !== 1) return false;
    store.cols = new Map(saved.cols.map(([name, docs]) => [name, new Map(docs.map((d) => [d.id, d]))]));
    store.events = new Map(saved.events);
    return true;
  } catch {
    return false;
  }
}

// 처음 열면 나와 친구 셋의 프로필, 친구들의 비서 설정만 있다. 방은 방문자가 만든다(task 1). 내 비서는 방문자가 정한다(task 3)
async function seed(store, clock) {
  await store.put('users', ME_PROFILE);
  for (const f of FRIENDS) {
    await store.put('users', { id: f.uid, name: f.name, color: f.color });
    await store.put('agents', { id: f.uid, uid: f.uid, memory: [...f.memory], rules: { ...f.rules }, payout: { ...f.payout }, onboardedAt: clock().toISOString() });
  }
}

export function createDemoServer({ storage = globalThis.sessionStorage, clock = () => new Date(), schedule = (fn, ms) => setTimeout(fn, ms), onChange = () => {} } = {}) {
  const store = new MemoryStore({ now: clock });
  const fxRates = { rateOn: async (currency, date) => fakeRate(currency, date) };
  const api = createApi({ store, gemini: null, clock, fxRates, env: { DEV_SEED: '1' } });
  const ready = load(store, storage) ? Promise.resolve() : seed(store, clock).then(() => save(store, storage));
  const director = createDirector({ store, clock, schedule, call: (method, path, body, as) => handle(method, path, { body, as }) });

  // 실제 라우트 앞에서 데모가 대신 답하는 요청
  async function local(method, url, body, as) {
    if (url.pathname === '/api/config') return reply(200, DEMO_CONFIG);
    if (url.pathname === '/api/dev/seed') return reply(404, { error: 'not found' });
    if (method === 'POST' && url.pathname === '/api/me/delete') return reply(400, { error: '체험용 데모라 계정을 지울 수 없어요. 처음부터 다시 하려면 안내 칸의 ‘처음부터 다시’를 눌러 주세요.' });
    // 사진 읽기: 실제 검증·정리(extractReceipt)는 그대로 쓰고, AI 대신 샘플 영수증을 읽은 값을 넣는다
    const extract = method === 'POST' && /^\/api\/rooms\/([^/]+)\/receipts\/extract$/.exec(url.pathname);
    if (extract) {
      const room = await store.get('rooms', decodeURIComponent(extract[1]));
      if (!room?.members.some((m) => m.uid === as && !m.left)) return reply(403, { error: '이 방의 멤버가 아니에요' });
      if (!body?.image?.data) return reply(400, { error: '사진 파일이 아니에요' });
      const sample = { model: '샘플 영수증', generate: async () => sampleReceipt(room, kstDay(clock())) };
      return reply(200, { draft: await extractReceipt(sample, { image: body.image, room }) });
    }
    return null;
  }

  // 송금 링크는 토스 대신 데모 안내로 연다(boot.js의 #demo-toss). 계좌·금액이 든 진짜 모양의 링크는 화면에 내려가지 않는다
  function demoLinks(path, out) {
    if (!/^\/api\/rooms\/[^/]+$/.test(path) || !out.body?.transfers) return out;
    const transfers = out.body.transfers.map((t) => (t.link ? { ...t, link: `#demo-toss=${encodeURIComponent(t.id)}` } : t));
    return reply(out.status, { ...out.body, transfers });
  }

  // 실제 서버는 30초마다 때가 된 송금을 알린다(server.mjs의 tick). 데모는 화면이 부를 때(2초마다 기록을 가져온다) 몇 초에 한 번 같은 일을 한다
  let tickedAt = 0;
  async function tick() {
    if (clock().getTime() - tickedAt < TICK_MS) return;
    tickedAt = clock().getTime();
    const { due, reminded } = await api.tick();
    if (due || reminded) save(store, storage);
  }

  async function handle(method, path, { body = null, as = ME } = {}) {
    await ready;
    if (as === ME) await tick().catch((e) => console.warn('[demo] tick:', e.message));
    const url = new URL(path, 'http://demo.local');
    const special = await local(method, url, body, as);
    if (special) return special;
    const hit = api.match(method, url.pathname);
    if (!hit) return reply(404, { error: 'not found' });
    const res = fakeRes();
    const req = { method, url: url.pathname + url.search, headers: { 'x-demo-user': as }, rawBody: body == null ? '' : JSON.stringify(body), socket: { remoteAddress: 'demo' } };
    let out;
    try {
      const value = await api.run(hit, { req, res, url });
      out = res.writableEnded ? reply(res.status, res.body) : reply(200, value ?? {});
    } catch (e) {
      out = e?.status ? reply(e.status, { error: e.message }) : reply(500, { error: e?.message ?? String(e) });
      if (!e?.status) console.error('[demo]', e);
    }
    if (method !== 'GET') {
      save(store, storage);
      onChange();
    }
    if (as === ME && method === 'POST' && url.pathname === '/api/rooms' && out.status === 201) {
      try { storage?.setItem(ROOM_KEY, out.body.room.id); } catch {}
    }
    if (as === ME) await director.nudge(); // 예약만 하고 바로 돌아온다(친구들은 조금 뒤에 움직인다)
    return demoLinks(url.pathname, out);
  }

  return {
    handle,
    store,
    ready: ready.then(() => director.nudge()),
    idle: () => director.idle(),
    // task 안내가 따라가는 방: 마지막으로 만든 방. 없으면 null
    focusRoom: async () => {
      await ready;
      let id = null;
      try { id = storage?.getItem(ROOM_KEY); } catch {}
      return (id && (await store.get('rooms', id))) || null;
    },
    // 처음부터 다시: 저장한 데모를 지운다. 부르는 쪽이 페이지를 다시 연다
    reset: () => { try { storage?.removeItem(KEY); storage?.removeItem(ROOM_KEY); } catch {} },
  };
}
