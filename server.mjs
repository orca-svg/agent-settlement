// 정산은 비서끼리 — 서버 진입점(로컬·Cloud Run). 환경변수를 읽고 src/app.mjs로 앱을 만들어 연다.
// 구조와 확장 지점은 ARCHITECTURE.md를 본다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.mjs';
import { createGemini, resolveModel } from './src/gemini.mjs';
import { MemoryStore } from './src/store/memory.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// .env가 있으면 읽는다(이미 설정된 환경변수가 우선)
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const KEY = process.env.GEMINI_API_KEY || '';
const PORT = Number(process.env.PORT || 4500);
const MODEL = KEY ? await resolveModel(KEY, process.env.GEMINI_MODEL) : null;

const app = createApp({
  store: new MemoryStore(),
  gemini: createGemini({ key: KEY, model: MODEL }),
  env: process.env,
});

// 때가 된 송금 알림을 30초마다 확인한다. 배포에서는 Cloud Scheduler가 /api/cron/tick을 부른다
setInterval(async () => {
  try {
    const { due, reminded } = await app.tick();
    if (due || reminded) console.log(`[tick] 송금 알림 ${due}건, 받았나요 ${reminded}건`);
  } catch (e) {
    console.warn('[tick] 실패:', e.message);
  }
}, 30_000).unref();

app.listen(PORT, () => {
  console.log(`정산은 비서끼리: http://localhost:${PORT}`);
  console.log(KEY ? `Gemini 모드 — 모델 ${MODEL}` : '규칙 모드 — GEMINI_API_KEY가 없어 규칙으로 배분·중재합니다');
});
