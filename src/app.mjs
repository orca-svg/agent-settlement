// 서버 조립. 의존성(store, gemini, clock, evidenceFor, env)을 주입받아 http.Server를 만든다. listen은 호출하는 쪽이 한다.
// 라우트는 src/api.mjs가 만든다. 여기서는 CORS·정적 파일·오류 응답만 맡는다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { send, allowCors, HttpError } from './http.mjs';
import { createApi } from './api.mjs';

export { cleanMemory, redactTransfer, redactDispute } from './api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };

// 화면 파일. 브라우저 데모(public/demo/)는 서버 코드(src/)를 그대로 불러 돌리므로, 운영이 아닐 때만 /src/의 모듈도 내준다.
// 배포에서는 GitHub Pages가 src/를 함께 올린다(.github/workflows/pages.yml)
function serveStatic(pathname, res, { withSrc = false } = {}) {
  const [dir, rel] = withSrc && pathname.startsWith('/src/') ? [here, pathname.slice('/src'.length)] : [publicDir, pathname === '/' ? 'index.html' : pathname];
  const file = path.normalize(path.join(dir, rel));
  const allowed = dir === publicDir || /\.m?js$/.test(file);
  if (!allowed || !file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

export function createApp({ env = {}, ...deps }) {
  const api = createApi({ ...deps, env });
  const origins = (env.ALLOWED_ORIGINS || 'https://orca-svg.github.io').split(',');
  const withSrc = env.NODE_ENV !== 'production';

  const server = http.createServer(async (req, res) => {
    req.identityContext = { auth: deps.auth ?? null, dev: api.dev };
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) res.setHeader('cache-control', 'no-store');
    allowCors(req, res, origins);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    try {
      const hit = api.match(req.method, url.pathname);
      if (hit) {
        const out = await api.run(hit, { req, res, url });
        if (!res.writableEnded) send(res, 200, out ?? {});
        return;
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
      return serveStatic(url.pathname, res, { withSrc });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('[error]', e.message);
      return send(res, 500, { error: e.message });
    }
  });
  server.tick = api.tick;
  return server;
}
