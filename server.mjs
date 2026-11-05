// Bill:ION — 서버 진입점(로컬·Cloud Run). 환경변수를 읽고 src/app.mjs로 앱을 만들어 연다.
// 구조와 확장 지점은 ARCHITECTURE.md를 본다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.mjs';
import { createGemini, resolveModel, withMonthlyBudget } from './src/gemini.mjs';
import { MemoryStore } from './src/store/memory.mjs';
import { createFirestoreStore } from './src/store/firestore.mjs';
import { cachedStore } from './src/store/cached.mjs';
import { firebaseAuth } from './src/firebase.mjs';
import { encryptedStore } from './src/store/encrypted.mjs';
import { resolvePayoutKey } from './src/security/seal.mjs';

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
// 계좌·위치 요약이 들어가는 칸은 저장소에 넣을 때 잠근다(#8, #10). 배포에서 PAYOUT_ENC_KEY가 없으면 여기서 멈춘다
const PAYOUT_KEY = resolvePayoutKey(process.env);
const MODEL = KEY ? await resolveModel(KEY, process.env.GEMINI_MODEL) : null;

// 요금이 갑자기 느는 걸 막는 안전장치. 한도를 넘으면 그 달은 규칙 모드로만 동작한다(#10)
const GEMINI_MONTHLY_LIMIT = Number(process.env.GEMINI_MONTHLY_LIMIT || 2000);

// STORE=firestore면 Firestore(#3, docs/firestore-setup.md), 아니면 서버 메모리(재시작하면 사라짐). 어느 쪽이든 계좌 칸은 잠가서 넣는다.
// Firestore 앞에는 읽기 캐시를 둔다(src/store/cached.mjs). 인스턴스가 하나(--max-instances 1)라서 맞는 캐시다
const baseStore = process.env.STORE === 'firestore' ? cachedStore(await createFirestoreStore(process.env)) : new MemoryStore();

const app = createApp({
  store: encryptedStore(baseStore, PAYOUT_KEY),
  auth: await firebaseAuth(process.env),
  gemini: withMonthlyBudget(createGemini({ key: KEY, model: MODEL }), { maxCalls: GEMINI_MONTHLY_LIMIT }),
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
  console.log(`Bill:ION — http://localhost:${PORT}`);
  console.log(KEY ? `Gemini 모드 — 모델 ${MODEL}` : '규칙 모드 — GEMINI_API_KEY가 없어 규칙으로 배분·중재합니다');
});
