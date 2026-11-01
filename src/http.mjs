// 의존성 없는 작은 HTTP 도구: 라우터, JSON 본문, 응답, CORS, 호출 제한.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// path의 ':name'은 경로 파라미터가 된다. match()는 { handler, params } 또는 null.
export function router() {
  const routes = [];
  const add = (method) => (path, handler) => {
    const keys = [];
    const re = new RegExp(`^${path.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler });
    return api;
  };
  const api = {
    get: add('GET'),
    post: add('POST'),
    match(method, pathname) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = pathname.match(r.re);
        if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    },
  };
  return api;
}

export async function readJson(req, { limit = 20_000 } = {}) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > limit) throw new HttpError(413, '요청이 너무 커요');
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'JSON 형식이 아니에요');
  }
}

export function send(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

export function allowCors(req, res, origins) {
  const origin = req.headers.origin;
  if (!origin || !origins.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, x-demo-user');
}

// 공개 주소라 누구나 부를 수 있으므로 Gemini 호출을 키(신원 또는 IP)당 창 안에서 max회로 막는다.
// overLimit(key)는 이번 호출이 한도를 넘었으면 true.
export function createRateLimiter({ max = 30, windowMs = 600_000, now = () => Date.now() } = {}) {
  const calls = new Map();
  return function overLimit(key) {
    const t = now();
    const recent = (calls.get(key) || []).filter((c) => t - c < windowMs);
    recent.push(t);
    calls.set(key, recent);
    return recent.length > max;
  };
}

export const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
