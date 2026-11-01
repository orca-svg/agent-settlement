// 정산은 비서끼리 — 로컬/Cloud Run 서버 (의존성 없음). 정적 파일 + Gemini 호출 두 가지.
//   POST /api/allocate  영수증 줄을 비서들이 공유한 기억으로 '누가 먹었나' 배분
//   POST /api/mediate   이의 제기를 중립 비서가 중재
// 돈 계산은 하지 않는다. 계산은 public/core.js가 한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PEOPLE, EXPENSES, MEMORY_LIMIT, DISPUTE } from './public/data.js';
import { ruleAllocate, presentAfterLeaving } from './public/core.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');

// .env가 있으면 읽는다(이미 설정된 환경변수가 우선)
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const KEY = process.env.GEMINI_API_KEY || '';
const PORT = Number(process.env.PORT || 4500);
const API = 'https://generativelanguage.googleapis.com/v1beta';

async function resolveModel() {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL;
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': KEY } });
    const names = ((await res.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''));
    const flash = names
      .map((n) => ({ n, m: n.match(/^gemini-(\d+(?:\.\d+)?)-flash(-preview)?$/) }))
      .filter((x) => x.m)
      .sort((a, b) => Number(b.m[1]) - Number(a.m[1]) || (a.m[2] ? 1 : 0) - (b.m[2] ? 1 : 0));
    if (flash.length) return flash[0].n;
  } catch (e) {
    console.warn('모델 목록 조회 실패, 기본 모델 사용:', e.message);
  }
  return 'gemini-flash-latest';
}
const MODEL = KEY ? await resolveModel() : null;

const izakaya = EXPENSES.find((e) => e.id === 'izakaya');
const bar = EXPENSES.find((e) => e.id === DISPUTE.expense);

// 화면에서 고친 기억만 받는다. 이름은 정해진 4명, 사람당 MEMORY_LIMIT개, 한 줄 60자까지.
function cleanMemory(input) {
  const out = {};
  for (const p of PEOPLE) {
    const list = Array.isArray(input?.[p]) ? input[p] : [];
    out[p] = list.slice(0, MEMORY_LIMIT).map((s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean);
  }
  return out;
}

const memoryText = (memory) => PEOPLE.map((p) => `- ${p}의 비서: ${memory[p].length ? memory[p].map((m) => `“${m}”`).join(', ') : '(공유한 기억 없음)'}`).join('\n');
const receiptTable = (exp, withTime) => [
  `| id | ${withTime ? '주문 시각 | ' : ''}항목 | 수량 | 단가(엔) | 태그 |`,
  `| --- |${withTime ? ' --- |' : ''} --- | --- | --- | --- |`,
  ...exp.items.map((it) => `| ${it.id} | ${withTime ? `${it.time} | ` : ''}${it.name} | ${it.qty} | ${it.unit} | ${it.tags.join(', ')} |`),
].join('\n');

const lineSchema = (ids) => ({
  type: 'OBJECT',
  properties: {
    id: { type: 'STRING', enum: ids },
    consumers: { type: 'ARRAY', items: { type: 'STRING', enum: PEOPLE } },
    confidence: { type: 'NUMBER', description: '0~1' },
    reason: { type: 'STRING', description: '한 문장' },
  },
  required: ['id', 'consumers', 'confidence', 'reason'],
  propertyOrdering: ['id', 'consumers', 'confidence', 'reason'],
});

function allocatePrompt(memory) {
  const system = [
    '너는 여행 정산을 돕는 비서들의 공동 작업자다. 영수증의 각 줄을 누가 먹고 마셨는지 추정한다.',
    '근거는 각 사람의 비서가 공유한 기억과 영수증 줄의 정보(항목·수량·태그)뿐이다. 기억에 없는 사실을 지어내지 않는다.',
    '',
    '규칙:',
    '1. 태그가 "나눠 먹는 안주"인 줄은 함께 있던 사람 모두에게 배정한다. 단, 기억상 그 음식을 먹지 않는 사람은 뺀다.',
    '2. 잔·1인분 단위인 줄은 수량만큼의 사람에게 배정한다(수량 2면 2명).',
    '3. 기억상 술을 마시지 않는 사람은 태그가 "술"인 줄에서 뺀다.',
    '4. 기억에 근거가 있으면 confidence를 0.7 이상, 근거 없이 추측했으면 0.5 미만으로 둔다.',
    '5. reason은 해요체 한 문장으로, 어떤 기억(누구의 비서 기억 “…”)을 썼는지 밝힌다. 근거가 없으면 그렇다고 쓴다.',
    '6. 금액은 계산하지 않는다. 계산은 코드가 한다.',
  ].join('\n');
  const user = [
    `함께 있던 사람: ${izakaya.present.join(', ')}`,
    `비서들이 공유한 기억:\n${memoryText(memory)}`,
    `영수증(${izakaya.title}, ${izakaya.payer}가 현금 결제):\n${receiptTable(izakaya, false)}`,
    '영수증의 모든 줄(id)에 대해 배정 결과를 JSON으로 내라.',
  ].join('\n\n');
  const schema = {
    type: 'OBJECT',
    properties: { lines: { type: 'ARRAY', items: lineSchema(izakaya.items.map((i) => i.id)) } },
    required: ['lines'],
  };
  return { system, user, schema };
}

function mediatePrompt(memory) {
  const system = [
    '너는 정산 분쟁을 맡은 중립적인 중재 비서다. 어느 한쪽 편을 들지 않는다.',
    '양쪽 비서가 낸 주장과 근거, 주문 시각이 적힌 영수증, 각자의 비서가 공유한 기억을 보고 영수증 각 줄을 누가 부담할지 제안한다.',
    '',
    '규칙:',
    '1. 근거로 확인되는 사실만 쓴다. 근거끼리 맞지 않으면 confidence를 낮춘다.',
    '2. 결제 시각과 주문 시각을 구분한다. 자리를 떠난 사람은 떠난 뒤의 주문을 부담하지 않는다.',
    '3. "나눠 먹는 안주"는 그 주문 시각에 있던 사람 모두, 잔 단위 항목은 수량만큼의 사람에게 배정한다. 기억상 술을 마시지 않는 사람은 "술" 줄에서 뺀다.',
    '4. summary와 reason은 해요체로 쓴다. summary는 양쪽이 바로 이해할 수 있게 두 문장 이내로 쓴다. 금액은 계산하지 않는다.',
  ].join('\n');
  const user = [
    `지출: ${bar.title} (${bar.payer} 카드 결제 ${bar.time}), 함께 있던 사람: ${bar.present.join(', ')}`,
    '현재 청구 방식: 카드 승인 알림에 합계만 있어 4명이 똑같이 나눔',
    `이의 제기(${DISPUTE.by}의 비서): ${DISPUTE.claim}\n근거: ${DISPUTE.evidence.join(' / ')}`,
    `${bar.payer}의 비서 기록: ${DISPUTE.counter.join(' / ')}`,
    `영수증:\n${receiptTable(bar, true)}`,
    `비서들이 공유한 기억:\n${memoryText(memory)}`,
    '중재안을 JSON으로 내라.',
  ].join('\n\n');
  const schema = {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      lines: { type: 'ARRAY', items: lineSchema(bar.items.map((i) => i.id)) },
    },
    required: ['summary', 'lines'],
    propertyOrdering: ['summary', 'lines'],
  };
  return { system, user, schema };
}

function thinkingConfig(model) {
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  if (/gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return undefined;
}

async function callGemini({ system, user, schema }) {
  const body = (withThinking) => JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.2,
      ...(withThinking && thinkingConfig(MODEL) ? { thinkingConfig: thinkingConfig(MODEL) } : {}),
    },
  });
  const send = (withThinking) => fetch(`${API}/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: body(withThinking),
    signal: AbortSignal.timeout(45000),
  });
  let res = await send(true);
  if (res.status === 400) res = await send(false); // thinkingConfig를 모르는 모델 대비
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Gemini HTTP ${res.status}`);
  const text = (json.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text).join('');
  return JSON.parse(text);
}

// 모델 출력을 영수증 줄 단위로 검증한다. 빠진 줄이나 그 자리에 없던 사람은 규칙 배분으로 대신한다.
function cleanLines(exp, raw, fallback, presentAt) {
  const byId = new Map((raw || []).map((l) => [l.id, l]));
  const out = {};
  for (const it of exp.items) {
    const l = byId.get(it.id);
    const present = presentAt(it);
    const consumers = [...new Set((l?.consumers || []).filter((p) => present.includes(p)))];
    if (!l || !consumers.length) {
      out[it.id] = { ...fallback[it.id], filled: true };
      continue;
    }
    out[it.id] = {
      consumers,
      confidence: Math.round(Math.min(1, Math.max(0, Number(l.confidence) || 0)) * 100) / 100,
      reason: String(l.reason || '').slice(0, 160),
    };
  }
  return out;
}

async function allocate(memory) {
  const fallback = ruleAllocate(izakaya, memory);
  if (!KEY) return { lines: fallback, source: 'rules' };
  const raw = await callGemini(allocatePrompt(memory));
  return { lines: cleanLines(izakaya, raw.lines, fallback, () => izakaya.present), source: MODEL };
}

async function mediate(memory) {
  const presentAt = presentAfterLeaving(bar, DISPUTE);
  const fallback = ruleAllocate(bar, memory, presentAt);
  const ruleSummary = `${DISPUTE.leftAt} 이전 주문은 넷이, 이후 주문은 ${DISPUTE.by}를 뺀 셋이 나눠요. 술을 마시지 않는 사람은 술값에서 빠져요.`;
  if (!KEY) return { summary: ruleSummary, lines: fallback, source: 'rules' };
  const raw = await callGemini(mediatePrompt(memory));
  return { summary: String(raw.summary || ruleSummary).slice(0, 300), lines: cleanLines(bar, raw.lines, fallback, presentAt), source: MODEL };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml' };
const send = (res, status, obj) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

// 배포에서는 화면을 GitHub Pages가, Gemini 호출을 이 서버(Cloud Run)가 맡는다. 키는 서버에만 있다.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://orca-svg.github.io').split(',');
function allowCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
}

// 공개 주소라 누구나 부를 수 있으므로, Gemini 호출은 IP당 10분에 30회로 막아 선불 크레딧을 지킨다.
const recentCalls = new Map();
function overLimit(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
  const now = Date.now();
  const calls = (recentCalls.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  calls.push(now);
  recentCalls.set(ip, calls);
  return calls.length > 30;
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 20_000) throw new Error('요청이 너무 커요');
  }
  return body ? JSON.parse(body) : {};
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  allowCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  try {
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, { mode: KEY ? 'gemini' : 'rules', model: MODEL });
    }
    if (req.method === 'POST' && (url.pathname === '/api/allocate' || url.pathname === '/api/mediate')) {
      if (overLimit(req)) return send(res, 429, { error: '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.' });
      const memory = cleanMemory((await readJson(req)).memory);
      const started = Date.now();
      const out = url.pathname === '/api/allocate' ? await allocate(memory) : await mediate(memory);
      out.latencyMs = Date.now() - started;
      console.log(`[${url.pathname}] ${out.source} ${out.latencyMs}ms`);
      return send(res, 200, out);
    }
    const file = path.normalize(path.join(publicDir, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(publicDir) || !fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error('[error]', e.message);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`정산은 비서끼리: http://localhost:${PORT}`);
  console.log(KEY ? `Gemini 모드 — 모델 ${MODEL}` : '규칙 모드 — GEMINI_API_KEY가 없어 규칙으로 배분·중재합니다');
});
