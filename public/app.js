// 화면 로직. 사람은 '확인·승인'만 하고, 돈 얘기는 비서들이 오른쪽 채널에서 주고받는다.
import { DEMO_ROOM as ROOM, POLICIES, DEMO_EXPENSES as EXPENSES, DEMO_MEMORY as MEMORY, MEMORY_LIMIT, DEMO_RULES as RULES, DEMO_DISPUTE as DISPUTE } from './data.js';
import { won, yen, dayLabel, amountOf, toKrw, shares, ledger, settle, ruleAllocate, presentAfter } from './core.js';
import { Spring, VelocityTracker, project, rubberband, reduceMotion } from './motion.js';
import { API_BASE } from './api.js';

const PEOPLE = ROOM.members.map((m) => m.uid);
const TRIP = { title: ROOM.name, dates: ROOM.dates, agreedPolicy: ROOM.policy, agreedAt: ROOM.agreedAt };
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const COLOR = Object.fromEntries(PEOPLE.map((p, i) => [p, `var(--p${i})`]));
const avatar = (p, cls = '') => `<span class="avatar ${cls}" style="--c:${COLOR[p] || '#8e8e93'}" aria-hidden="true">${esc(p[0])}</span>`;
const agentOf = (p) => (p === '중재' ? '중재 비서' : p === '나' ? '나의 비서' : `${p}의 비서`);
const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
const byId = (id) => EXPENSES.find((e) => e.id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion.matches ? 0 : ms));
const STAGES = ['collected', 'allocating', 'review', 'ready', 'sending', 'disputed', 'mediating', 'proposal', 'settling', 'done'];
const atLeast = (s) => STAGES.indexOf(state.stage) >= STAGES.indexOf(s);
const policyLabel = (id) => POLICIES.find((p) => p.id === id).label;
const tKey = (t) => `${t.from}>${t.to}`;
const PAYDAY = '25일 월급날';
// 받침 유무로 조사를 고른다(오차즈케는 / 생맥주는 / 하이볼은). '나'가 주어면 '내가'.
const hasBatchim = (w) => {
  const s = w.replace(/[^가-힣]+$/, '');
  const c = s.charCodeAt(s.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
};
const topic = (w) => `${w}${hasBatchim(w) ? '은' : '는'}`;
const subj = (w) => (w === '나' ? '내가' : `${w}${hasBatchim(w) ? '이' : '가'}`);

const ICONS = {
  stay: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="2"/>',
  food: '<path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  drink: '<path d="M5 4h14l-7 8zM12 12v7M8 20h8"/>',
  shop: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 18v2M16 18v2"/>',
};
const tile = (kind) => `<span class="tile ${kind}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind]}</svg></span>`;
const CHEVRON = '<svg class="chev" width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK = '<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// ---------------------------------------------------------------- 상태
const START = Date.UTC(2026, 10, 10, 0, 0, 0); // 11/10 09:00 KST, 정산일 아침
const fresh = () => ({
  stage: 'collected',
  preview: TRIP.agreedPolicy,
  memory: structuredClone(MEMORY),
  memoryDirty: false,
  memEdit: null,
  allocs: {},
  modes: {},
  allocSource: '',
  proposal: null,
  sent: {},
  payWhen: '지금',
  log: [],
  clock: START,
  sheet: null,
});
let state = fresh();
let config = { mode: 'unknown' };
let busy = null;
let renderedLog = 0;

// 중재 전후로 바뀌는 나누기 방식(split)과 배분(alloc)을 지출에 입혀서 계산에 넘긴다
const expenseView = () => EXPENSES.map((e) => ({ ...e, split: state.modes[e.id] ?? e.split, alloc: state.allocs[e.id] }));
const agreedLedger = () => ledger(ROOM, expenseView(), TRIP.agreedPolicy);
const transfers = () => settle(agreedLedger());
const flagged = () => {
  const a = state.allocs.izakaya;
  return a ? byId('izakaya').items.filter((it) => a[it.id].confidence < 0.7 && !a[it.id].confirmed) : [];
};
const needsHuman = (t) => t.amount > RULES[t.from].autoAccept && !state.sent[tKey(t)];

function sourceLabel(out) {
  const sec = out.latencyMs ? ` · ${(out.latencyMs / 1000).toFixed(1)}초` : '';
  if (!out.source || out.source === 'rules') return `규칙${sec}`;
  return `${out.source.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash').replace(/-preview/, ' Preview')}${sec}`;
}

function log(from, to, text, { meta = '', tag = '' } = {}) {
  state.clock += 6000;
  const t = new Date(state.clock + 9 * 3600_000).toISOString().slice(11, 19);
  state.log.push({ from, to, text, meta, tag, t });
  renderChannel();
}

async function post(path, body, signal) {
  if (config.mode === 'offline') throw new Error('offline');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------------------------------------------------------------- 흐름
async function allocate() {
  const izakaya = byId('izakaya');
  const controller = new AbortController();
  busy = controller;
  state.stage = 'allocating';
  if (!state.log.length) {
    const kinds = EXPENSES.reduce((m, e) => ({ ...m, [e.source]: (m[e.source] || 0) + 1 }), {});
    log('나', '모두의 비서', `오사카 여행 지출 ${EXPENSES.length}건을 모았어요. 메뉴가 달랐던 이자카야 영수증은 각자 공유한 기억으로 나눌게요.`, {
      meta: Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' · '),
    });
  }
  render();
  let out;
  try {
    out = await post('/api/allocate', { memory: state.memory }, controller.signal);
  } catch (e) {
    if (e.name === 'AbortError') {
      busy = null;
      state.stage = !state.allocs.izakaya ? 'collected' : flagged().length ? 'review' : 'ready';
      return render();
    }
    await sleep(600);
    out = { lines: ruleAllocate(izakaya, state.memory, ROOM.members), source: 'rules', fallback: e.message };
  }
  busy = null;
  state.allocs.izakaya = out.lines;
  state.allocSource = sourceLabel(out) + (out.fallback ? ' (서버 응답이 없어 규칙으로)' : '');
  state.memoryDirty = false;
  const used = PEOPLE.reduce((n, p) => n + state.memory[p].length, 0);
  log('나', '모두의 비서', `이자카야 영수증 ${izakaya.items.length}줄을 비서들이 공유한 기억 ${used}개로 나눴어요.`, { meta: `allocate · ${state.allocSource}` });
  const ask = flagged();
  if (ask.length) {
    log('나', '나', `${topic(ask.map((it) => `‘${it.name}’`).join(', '))} 누가 먹었는지 기억에 없어요. 짐작하지 않고 물어볼게요.`, { tag: chip('사람 확인', 'warn') });
  }
  state.stage = ask.length ? 'review' : 'ready';
  render();
}

function maybeReady() {
  if (state.stage === 'review' && !flagged().length) {
    state.stage = 'ready';
    log('나', '나', '확인이 필요한 줄을 모두 정했어요. 청구서를 보낼 준비가 됐어요.', { tag: chip('확인 완료', 'ok') });
  }
}

async function sendInvoices() {
  state.stage = 'sending';
  closeSheet();
  render();
  const rows = agreedLedger();
  for (const p of PEOPLE.filter((x) => x !== '나')) {
    await sleep(450);
    log('나', agentOf(p), `${p}의 몫을 담은 청구서를 보냈어요. 단톡방에는 아무것도 올리지 않아요.`, {
      meta: `invoice{ owed: ${rows[p].owed}, paid: ${rows[p].paid}, policy: "${TRIP.agreedPolicy}", lines: ${EXPENSES.length} }`,
    });
  }
  await sleep(700);
  log('철수', '나의 비서', `확인했어요. 철수가 함께 있던 일정이고, 자동 수락 한도 안이에요. ${PAYDAY}에 보낼게요.`, {
    meta: `rule: 참여 일정 ✓ · ≤ ${won(RULES.철수.autoAccept)} ✓ → 수락, 송금 ${RULES.철수.sendWhen}`,
    tag: chip('자동 수락', 'ok'),
  });
  await sleep(500);
  log('영희', '나의 비서', '확인했어요. 영희는 받을 돈이 있어서 보낼 건 없어요.', { meta: 'rule: 참여 일정 ✓ → 수락', tag: chip('자동 수락', 'ok') });
  await sleep(700);
  log('민수', '나의 비서', `‘2차 바’에 이의가 있어요. 민수는 ${DISPUTE.leftAt}에 먼저 숙소로 돌아갔어요.`, {
    meta: `evidence: ${DISPUTE.evidence.join(' / ')} (원본 대신 요약만 공유)`,
    tag: chip('이의 제기', 'warn'),
  });
  state.stage = 'disputed';
  render();
}

async function mediate() {
  const bar = byId(DISPUTE.expense);
  const controller = new AbortController();
  busy = controller;
  state.stage = 'mediating';
  log('나', '중재 비서', '내 규칙대로 이의를 중재 비서에게 맡겨요. 영수증의 주문 시각을 함께 보낼게요.', { meta: `rule: 이의 제기 → ${RULES.나.onDispute}` });
  render();
  let out;
  try {
    out = await post('/api/mediate', { memory: state.memory }, controller.signal);
  } catch (e) {
    if (e.name === 'AbortError') {
      busy = null;
      state.stage = 'disputed';
      return render();
    }
    await sleep(600);
    out = {
      summary: `${DISPUTE.leftAt} 이전 주문은 넷이, 이후 주문은 ${DISPUTE.by}를 뺀 셋이 나눠요. 술을 마시지 않는 사람은 술값에서 빠져요.`,
      lines: ruleAllocate(bar, state.memory, ROOM.members, presentAfter(bar, DISPUTE.by, DISPUTE.leftAt)),
      source: 'rules',
      fallback: e.message,
    };
  }
  busy = null;
  state.proposal = { ...out, label: sourceLabel(out) + (out.fallback ? ' (서버 응답이 없어 규칙으로)' : '') };
  log('중재', '나·민수의 비서', out.summary, { meta: `mediate · ${state.proposal.label}` });
  state.stage = 'proposal';
  render();
}

async function acceptProposal() {
  const before = agreedLedger();
  state.allocs[DISPUTE.expense] = state.proposal.lines;
  state.modes[DISPUTE.expense] = 'items';
  state.stage = 'settling';
  closeSheet();
  const after = agreedLedger();
  log('나', '중재 비서', '중재안에 동의했어요.', { tag: chip('동의', 'ok') });
  await sleep(500);
  log('민수', '중재 비서', '민수의 근거가 반영돼서 규칙대로 동의했어요.', { meta: 'rule: 근거와 일치 → 동의', tag: chip('동의', 'ok') });
  await sleep(500);
  const d = after.철수.owed - before.철수.owed;
  log('철수', '나의 비서', `바뀐 몫(${d >= 0 ? '+' : '−'}${won(Math.abs(d))})도 한도 안이라 그대로 수락해요.`, { meta: `rule: ≤ ${won(RULES.철수.autoAccept)} ✓`, tag: chip('자동 수락', 'ok') });
  for (const t of transfers().filter(needsHuman)) {
    await sleep(500);
    log(t.from, t.from, `보낼 돈 ${won(t.amount)}이 자동 수락 한도(${won(RULES[t.from].autoAccept)})를 넘어서 ${t.from}에게 물었어요.`, { tag: chip('사람 확인', 'warn') });
  }
  if (!transfers().some(needsHuman)) state.stage = 'done';
  render();
}

async function pay(person) {
  const mine = transfers().filter((t) => t.from === person);
  const now = state.payWhen === '지금';
  for (const t of mine) state.sent[tKey(t)] = now ? 'sent' : 'scheduled';
  const total = mine.reduce((s, t) => s + t.amount, 0);
  render();
  await sleep(400);
  log(person, mine.map((t) => agentOf(t.to)).join(', '), now ? `${person}가 승인해서 ${won(total)}을 보냈어요.` : `${person}가 승인했어요. ${PAYDAY}에 ${won(total)}을 보낼게요.`, {
    meta: `transfer{ amount: ${total}, when: "${state.payWhen}", mock: true }`,
    tag: chip(now ? '송금' : '송금 예약', 'ok'),
  });
  if (!transfers().some(needsHuman)) {
    await sleep(500);
    log('나', '나', '받을 돈을 모두 확인했어요. 오사카 정산이 끝났어요.', { tag: chip('정산 완료', 'ok') });
    state.stage = 'done';
  }
  render();
}

function act(name, d) {
  switch (name) {
    case 'allocate': return allocate();
    case 'cancel': busy?.abort(); return undefined;
    case 'send': return sendInvoices();
    case 'mediate': return mediate();
    case 'accept': return acceptProposal();
    case 'pay': return pay(d.p);
    case 'open-exp': return openSheet('expense', d.id);
    case 'open-dispute': return openSheet('dispute');
    case 'open-payer': return openSheet('payer', d.p);
    case 'close-sheet': return closeSheet();
    case 'policy': state.preview = d.id; return render();
    case 'policy-reset': state.preview = TRIP.agreedPolicy; return render();
    case 'when': state.payWhen = d.id; return render();
    case 'toggle-pick': {
      const it = byId(d.exp).items.find((x) => x.id === d.line);
      const a = state.allocs[d.exp][d.line];
      const set = new Set(a.consumers);
      if (set.has(d.p)) set.delete(d.p); else set.add(d.p);
      if (!set.size) return undefined; // 적어도 한 명은 먹었다
      // 물어본 줄은 '이대로 확인'을 눌러야 확정된다. 고르는 도중의 상태가 청구서로 새지 않게.
      const asked = a.confidence < 0.7 && !a.confirmed;
      Object.assign(a, { consumers: PEOPLE.filter((p) => set.has(p)), reason: '직접 고쳤어요.', edited: true, confirmed: !asked });
      return render();
    }
    case 'confirm-line': {
      const a = state.allocs[d.exp][d.line];
      a.confirmed = true;
      const it = byId(d.exp).items.find((x) => x.id === d.line);
      log('나', '모두의 비서', `${topic(`‘${it.name}’`)} ${subj(a.consumers.join('·'))} 먹은 걸로 확인했어요.`, { meta: `human: 확인${a.edited ? ' (직접 고침)' : ''}` });
      maybeReady();
      return render();
    }
    case 'mem-del':
      state.memory[d.p].splice(Number(d.i), 1);
      state.memoryDirty = Boolean(state.allocs.izakaya);
      return render();
    case 'mem-open': state.memEdit = d.p; return render();
    case 'mem-cancel': state.memEdit = null; return render();
    case 'reset':
      busy?.abort();
      state = fresh();
      renderedLog = 0;
      closeSheet();
      window.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      return render();
    default: return undefined;
  }
}

// ---------------------------------------------------------------- 메인 화면
function hero() {
  return `<section class="hero">
    <h1>${esc(TRIP.title)}</h1>
    <p class="sub">${esc(TRIP.dates)} · 4명 · 돈 얘기는 각자의 비서끼리 해요</p>
    <div class="people">${PEOPLE.map((p) => `<span class="person">${avatar(p)}${esc(p)}</span>`).join('')}</div>
  </section>`;
}

function nextCard() {
  const progress = (title, text) => `<section class="next" aria-busy="true">
    <p class="eyebrow">비서가 일하는 중</p><h2>${title}</h2><p>${text}</p>
    <div class="progress"><i></i></div>
    <div class="actions"><button class="btn plain sm" data-action="cancel">취소</button></div></section>`;
  const card = (cls, eyebrow, title, text, actions) => `<section class="next ${cls}">
    <p class="eyebrow">${eyebrow}</p><h2>${title}</h2><p>${text}</p>
    ${actions ? `<div class="actions">${actions}</div>` : ''}</section>`;
  switch (state.stage) {
    case 'collected':
      return card('', '할 일 1개', `비서가 여행 지출 ${EXPENSES.length}건을 모았어요`,
        '카드 승인 알림, 영수증 사진, 비서에게 한 말에서 모았어요. 메뉴가 달랐던 영수증은 각자의 비서가 공유한 기억으로 나눠요.',
        '<button class="btn" data-action="allocate">비서에게 나누기 맡기기</button>');
    case 'allocating':
      return progress('비서들이 영수증을 나누는 중이에요', '이자카야 영수증 7줄을 4명의 비서가 공유한 기억과 맞춰 보고 있어요. 보통 10초 안팎이에요.');
    case 'review': {
      const names = flagged().map((it) => `‘${esc(it.name)}’`).join(', ');
      return card('warn', '확인이 필요해요', `${topic(names)} 누가 먹었나요?`,
        '비서들의 기억에 근거가 없는 줄이에요. 그래서 비서가 짐작으로 청구하지 않고 먼저 물어봐요.',
        '<button class="btn" data-action="open-exp" data-id="izakaya">이자카야 영수증 확인하기</button>');
    }
    case 'ready':
      return card('', '내 승인이 필요해요', '이대로 청구서를 보낼까요?',
        '보내면 각자의 비서가 자기 규칙대로 확인해요. 단톡방에는 아무것도 올라가지 않아요.',
        '<button class="btn" data-action="send">비서들에게 청구서 보내기</button><button class="btn secondary" data-action="open-exp" data-id="izakaya">영수증 다시 보기</button>');
    case 'sending':
      return `<section class="next" aria-busy="true"><p class="eyebrow">비서가 일하는 중</p><h2>비서들이 청구서를 확인하는 중이에요</h2>
        <p>각자 맡긴 규칙(자동 수락 한도, 보낼 시기)대로 처리해요.</p><div class="progress"><i></i></div></section>`;
    case 'disputed':
      return card('warn', '이의 제기', '민수의 비서가 ‘2차 바’에 이의를 제기했어요',
        `민수는 ${DISPUTE.leftAt}에 먼저 들어갔다고 해요. 내 규칙은 ‘${esc(RULES.나.onDispute)}’예요.`,
        '<button class="btn" data-action="open-dispute">이의 내용 보기</button>');
    case 'mediating':
      return progress('중재 비서가 양쪽 근거를 맞춰 보는 중이에요', '민수의 근거와 영수증의 주문 시각을 비교하고 있어요.');
    case 'proposal':
      return card('', '중재안 도착', '중재 비서가 나누는 방법을 제안했어요', esc(state.proposal.summary),
        '<button class="btn" data-action="open-dispute">중재안 보기</button>');
    case 'settling': {
      const p = transfers().filter(needsHuman)[0]?.from;
      if (!p) return '';
      return card('', '거의 끝났어요', `${esc(p)}의 확인만 남았어요`,
        `${esc(p)}가 보낼 돈이 ${esc(p)} 비서의 자동 수락 한도(${won(RULES[p].autoAccept)})를 넘어서, 비서가 ${esc(p)}에게 물었어요. 나는 기다리기만 하면 돼요.`,
        `<button class="btn" data-action="open-payer" data-p="${p}">${esc(p)}의 화면 보기</button>`);
    }
    case 'done':
      return card('done', '정산 완료', '정산이 끝났어요',
        '아무도 단톡방에서 돈 얘기를 꺼내지 않았어요. 남은 건 비서끼리 주고받은 기록뿐이에요.',
        '<button class="btn secondary" data-action="reset">처음부터 다시 보기</button>');
    default:
      return '';
  }
}

function expenseStatus(e) {
  if (e.id === 'izakaya') {
    if (!state.allocs.izakaya) return chip('메뉴별로 나누기 전');
    const n = flagged().length;
    return n ? chip(`확인 필요 ${n}`, 'warn') : chip('메뉴별로 나눔', 'ok');
  }
  if (e.id === DISPUTE.expense) {
    if (state.modes[e.id] === 'items') return chip('중재로 다시 나눔', 'ok');
    if (atLeast('disputed')) return chip('이의 제기됨', 'warn');
    return chip('합계만 있어 1/N');
  }
  return chip('1/N');
}

function expensesSection() {
  const rows = EXPENSES.map((e) => {
    const { krw } = toKrw(e, ROOM, TRIP.agreedPolicy);
    return `<button class="row" data-action="open-exp" data-id="${e.id}">
      ${tile(e.kind)}
      <span class="grow"><span class="title">${esc(e.title)}</span>
        <span class="meta" style="display:block">${esc(e.payer)} · ${e.method === 'card' ? '카드' : '현금'} ${yen(amountOf(e))} · ${dayLabel(e.date)} ${e.time}</span>
        <span style="display:block;margin-top:4px">${expenseStatus(e)}</span></span>
      <span class="end"><span class="amount">${won(krw)}</span></span>
      ${CHEVRON}
    </button>`;
  }).join('');
  return `<section class="group">
    <h2 class="group-label"><span>비서가 모은 지출 ${EXPENSES.length}건</span><span>${esc(policyLabel(TRIP.agreedPolicy))} 기준</span></h2>
    <div class="list">${rows}</div>
    <p class="group-note">정산을 올리는 걸 잊어도 괜찮아요. 비서가 카드 알림과 영수증에서 먼저 챙겨요.</p>
  </section>`;
}

function policySection() {
  const agreed = agreedLedger();
  const preview = ledger(ROOM, expenseView(), state.preview);
  const isPreview = state.preview !== TRIP.agreedPolicy;
  const netText = (n) => (n >= 0 ? `받을 돈 ${won(n)}` : `보낼 돈 ${won(-n)}`);
  const rows = PEOPLE.map((p) => {
    const diff = preview[p].net - agreed[p].net;
    const receiver = agreed[p].net >= 0;
    const word = diff > 0 ? (receiver ? '더 받아요' : '덜 내요') : (receiver ? '덜 받아요' : '더 내요');
    const note = isPreview && diff !== 0 ? `<span class="meta num" style="display:block">합의 정책보다 ${won(Math.abs(diff))} ${word}</span>` : '';
    return `<div class="row" style="--inset:52px">${avatar(p)}<span class="grow">${esc(p)}</span>
      <span class="end"><span class="amount num ${preview[p].net >= 0 ? 'pos' : 'neg'}">${netText(preview[p].net)}</span>${note}</span></div>`;
  }).join('');
  const seg = `<div class="seg" role="radiogroup" aria-label="환율 정책" data-seg="policy"><span class="seg-thumb"></span>
    ${POLICIES.map((p) => `<button type="button" role="radio" aria-checked="${p.id === state.preview}" data-action="policy" data-id="${p.id}">${esc(p.label)}</button>`).join('')}</div>`;
  return `<section class="group">
    <h2 class="group-label"><span>환율 정책</span><span>${esc(TRIP.agreedAt)}, 여행 전에 4명의 비서가 합의</span></h2>
    <div class="list">
      <div class="policy">${seg}
        <p class="policy-desc">${esc(POLICIES.find((p) => p.id === state.preview).desc)}</p>
        ${isPreview ? '<p class="preview-note">미리보기예요. 정책을 바꾸려면 4명의 비서가 모두 다시 동의해야 해요. <button class="text-btn" data-action="policy-reset">합의한 정책으로 보기</button></p>' : ''}
      </div>
      ${rows}
    </div>
    <p class="group-note">여행 중에는 환율을 따지지 않아요. 정해 둔 정책대로 비서가 계산하고, 지출마다 근거를 보여 줘요.</p>
  </section>`;
}

function transferStatus(t) {
  if (!atLeast('sending')) return { label: '청구서 보내기 전' };
  if (t.from === DISPUTE.by && !atLeast('settling')) return { label: '이의 제기 중', cls: 'warn' };
  const sent = state.sent[tKey(t)];
  if (sent === 'sent') return { label: '보냄', cls: 'ok' };
  if (sent === 'scheduled') return { label: `예약 · ${PAYDAY}`, cls: 'tint' };
  const r = RULES[t.from];
  if (t.amount > r.autoAccept) return { label: `${t.from} 확인 대기`, cls: 'warn', action: true };
  if (r.sendWhen === '바로') return { label: '자동 수락 · 보냄', cls: 'ok' };
  return { label: `자동 수락 · ${r.sendWhen} 예약`, cls: 'tint' };
}

function transfersSection() {
  const list = transfers();
  const naive = EXPENSES.reduce((n, e) => n + e.present.filter((p) => p !== e.payer).length, 0);
  const rows = list.map((t) => {
    const s = transferStatus(t);
    return `<div class="row" style="--inset:76px">
      <span style="display:flex;gap:2px">${avatar(t.from)}${avatar(t.to)}</span>
      <span class="grow"><span class="title">${esc(t.from)} → ${esc(t.to)}</span><span style="display:block;margin-top:3px">${chip(s.label, s.cls)}</span></span>
      <span class="end"><span class="amount num" style="display:block">${won(t.amount)}</span>
      ${s.action ? `<button class="text-btn" data-action="open-payer" data-p="${t.from}">${esc(t.from)}의 화면</button>` : ''}</span>
    </div>`;
  }).join('');
  return `<section class="group">
    <h2 class="group-label"><span>누가 누구에게</span><span>송금 ${list.length}번이면 끝나요</span></h2>
    <div class="list">${rows}</div>
    <p class="group-note">지출마다 따로 보내면 ${naive}번 오갈 송금을, 받을 사람과 보낼 사람을 묶어 ${list.length}번으로 줄였어요.</p>
  </section>`;
}

function memorySection() {
  const editable = !atLeast('sending');
  const rows = PEOPLE.map((p) => {
    const mems = state.memory[p].map((m, i) => `<span class="mem">${esc(m)}${editable ? `<button type="button" aria-label="${esc(m)} 지우기" data-action="mem-del" data-p="${p}" data-i="${i}">×</button>` : ''}</span>`).join('');
    const full = state.memory[p].length >= MEMORY_LIMIT;
    const form = state.memEdit === p
      ? `<form class="mem-add" data-p="${p}"><input id="mem-input" maxlength="60" placeholder="예: 매운 음식을 못 먹어요" aria-label="${esc(p)}의 비서가 기억할 것"><button class="btn sm">추가</button><button type="button" class="btn plain sm" data-action="mem-cancel">취소</button></form>`
      : '';
    return `<div class="row" style="--inset:52px;align-items:flex-start">${avatar(p)}
      <span class="grow"><span class="title">${esc(agentOf(p))}</span> <span class="quota">${state.memory[p].length}/${MEMORY_LIMIT}</span>
        <span class="memory">${mems || '<span class="meta">공유한 기억이 없어요</span>'}</span>${form}</span>
      ${editable && !full && state.memEdit !== p ? `<button class="text-btn" data-action="mem-open" data-p="${p}" aria-label="${esc(p)}의 기억 추가">추가</button>` : ''}
    </div>`;
  }).join('');
  const dirty = state.memoryDirty && editable
    ? '<div class="row"><span class="grow meta">기억이 바뀌었어요. 이 기억으로 영수증을 다시 나눌까요?</span><button class="btn sm" data-action="allocate">다시 나누기</button></div>'
    : '';
  return `<section class="group">
    <h2 class="group-label"><span>비서가 정산에 쓰는 기억</span><span>무료 요금제 · 사람당 ${MEMORY_LIMIT}개</span></h2>
    <div class="list">${rows}${dirty}</div>
    <p class="group-note">각자 공유하기로 한 기억만 정산에 써요. 기억을 고치고 다시 나누면 메뉴 배분이 어떻게 바뀌는지 바로 볼 수 있어요.</p>
  </section>`;
}

// ---------------------------------------------------------------- 비서끼리 채널
function renderChannel() {
  const el = $('#channel');
  const waiting = atLeast('settling') ? transfers().filter(needsHuman)[0] : null;
  const notif = waiting
    ? `<button class="notif" style="display:block;width:calc(100% - 32px);text-align:left;cursor:pointer" data-action="open-payer" data-p="${waiting.from}">
        <b>${esc(waiting.from)}의 휴대폰 · ${esc(agentOf(waiting.from))}</b>오사카 여행 정산 ${won(waiting.amount)}. 확인하면 보낼게요.</button>`
    : '';
  const items = state.log.map((l, i) => `<li class="${i >= renderedLog ? 'enter' : ''}">
      ${avatar(l.from, 'agent')}
      <div><div class="who"><span>${esc(agentOf(l.from))} → ${esc(l.to)}</span><time>${l.t}</time></div>
        <p class="text">${esc(l.text)}</p>
        ${l.meta ? `<div class="meta">${esc(l.meta)}</div>` : ''}
        ${l.tag ? `<div class="tag">${l.tag}</div>` : ''}</div>
    </li>`).join('');
  el.innerHTML = `<h2>비서끼리</h2><p class="lead">단톡방 대신 비서들이 주고받은 기록이에요. 사람에게는 확인할 일만 올라와요.</p>
    ${notif}
    ${state.log.length ? `<ol class="log">${items}</ol>` : '<p class="empty">비서에게 나누기를 맡기면 여기에 기록이 쌓여요.</p>'}`;
  renderedLog = state.log.length;
  el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------- 시트 내용
function linesHtml(exp, alloc, { editable, timed }) {
  return exp.items.map((it) => {
    const a = alloc?.[it.id];
    const flag = a && exp.id === 'izakaya' && a.confidence < 0.7 && !a.confirmed;
    const present = timed ? presentAfter(exp, DISPUTE.by, DISPUTE.leftAt)(it) : exp.present;
    const picks = present.map((p) => `<button type="button" class="pick" aria-pressed="${Boolean(a?.consumers.includes(p))}" ${editable && a ? '' : 'disabled'}
        data-action="toggle-pick" data-exp="${exp.id}" data-line="${it.id}" data-p="${p}">${avatar(p)}${esc(p)}</button>`).join('');
    return `<div class="line ${flag ? 'flag' : ''}">
      <div class="line-top"><span class="line-name">${timed ? `<small style="margin:0 6px 0 0">${it.time}</small>` : ''}${esc(it.name)}<small>×${it.qty}</small></span><span class="num">${yen(it.qty * it.unit)}</span></div>
      <div class="picks">${picks}</div>
      <p class="reason">${a ? esc(a.reason) : '아직 나누지 않았어요.'}</p>
      ${flag && editable ? `<div><button class="btn sm secondary" data-action="confirm-line" data-exp="${exp.id}" data-line="${it.id}">${a.edited ? '이대로 확인' : '비서가 짐작한 대로 확인'}</button></div>` : ''}
    </div>`;
  }).join('');
}

function sharesHtml(exp, mode, alloc) {
  const s = shares({ ...exp, split: mode }, ROOM, TRIP.agreedPolicy, alloc);
  return PEOPLE.filter((p) => s.krwShare[p] !== undefined).map((p) => `<div class="row" style="--inset:52px">${avatar(p)}
      <span class="grow">${esc(p)}${p === exp.payer ? ' <span class="meta">· 낸 사람, 끝전 포함</span>' : ''}</span>
      <span class="amount num">${won(s.krwShare[p])}</span></div>`).join('');
}

function expenseSheet(id) {
  const e = byId(id);
  const { krw, how } = toKrw(e, ROOM, TRIP.agreedPolicy);
  const mode = state.modes[e.id] ?? e.split ?? 'equal';
  const alloc = state.allocs[e.id];
  let detail = '';
  if (e.id === 'izakaya') {
    const editable = ['review', 'ready'].includes(state.stage);
    const note = editable ? '이름을 눌러 고칠 수 있어요. 청구서를 보내기 전까지는 언제든 바꿀 수 있어요.'
      : alloc ? '청구서를 보낸 뒤라 고칠 수 없어요.' : '‘비서에게 나누기 맡기기’를 누르면 비서들이 기억으로 나눠요.';
    detail = `<section class="group"><h3 class="group-label"><span>영수증 ${e.items.length}줄 · 누가 먹었나</span><span>${esc(state.allocSource || '나누기 전')}</span></h3>
      <div class="list">${linesHtml(e, alloc, { editable })}</div>
      <p class="group-note">${note}</p></section>`;
  } else if (e.id === DISPUTE.expense && mode === 'items') {
    detail = `<section class="group"><h3 class="group-label"><span>중재로 다시 나눔 · 주문 시각 기준</span><span>${esc(state.proposal?.label || '')}</span></h3>
      <div class="list">${linesHtml(e, alloc, { editable: false, timed: true })}</div></section>`;
  } else if (e.id === DISPUTE.expense) {
    detail = `<p class="how">카드 승인 알림에는 합계만 있어서, 함께 있던 4명이 똑같이 나눴어요.${atLeast('disputed') ? ' 민수의 비서가 이 지출에 이의를 제기했어요.' : ''}</p>
      ${atLeast('disputed') ? '<p style="margin:-8px 0 20px"><button class="btn secondary" data-action="open-dispute">이의 내용 보기</button></p>' : ''}`;
  }
  return {
    title: e.title,
    html: `<div class="big"><div class="amt">${won(krw)}</div>
        <p class="sub">${yen(amountOf(e))} · ${esc(subj(e.payer))} ${e.method === 'card' ? '카드로' : '현금으로'} 냄 · ${dayLabel(e.date)} ${e.time} · ${esc(e.source)}에서</p></div>
      <p class="how">${esc(policyLabel(TRIP.agreedPolicy))} 정책: ${esc(how)}</p>
      ${detail}
      <section class="group"><h3 class="group-label"><span>사람별 몫</span><span>${mode === 'items' ? '먹은 만큼' : '1/N'}</span></h3>
        <div class="list">${sharesHtml(e, mode, alloc)}</div></section>
      ${state.stage === 'ready' && id === 'izakaya' ? '<button class="btn" style="width:100%" data-action="send">비서들에게 청구서 보내기</button>' : ''}`,
  };
}

function disputeSheet() {
  const e = byId(DISPUTE.expense);
  const receipt = e.items.map((it) => `<div class="row" style="--inset:16px"><span class="meta num" style="width:44px">${it.time}</span><span class="grow">${esc(it.name)} ×${it.qty}</span><span class="num">${yen(it.qty * it.unit)}</span></div>`).join('');
  let action = '';
  if (state.stage === 'disputed') {
    action = `<button class="btn" style="width:100%" data-action="mediate">중재 비서에게 맡기기</button>
      <p class="group-note" style="text-align:center">내 비서의 규칙: 이의가 오면 ${esc(RULES.나.onDispute)}</p>`;
  } else if (state.stage === 'mediating') {
    action = '<div class="next" aria-busy="true" style="margin:0"><h2 style="font-size:1.0625rem">중재 비서가 근거를 맞춰 보는 중이에요</h2><div class="progress"><i></i></div><div class="actions"><button class="btn plain sm" data-action="cancel">취소</button></div></div>';
  } else if (state.proposal) {
    const before = shares({ ...e, split: 'equal' }, ROOM, TRIP.agreedPolicy).krwShare;
    const after = shares({ ...e, split: 'items' }, ROOM, TRIP.agreedPolicy, state.proposal.lines).krwShare;
    const changes = PEOPLE.map((p) => {
      const d = (after[p] || 0) - (before[p] || 0);
      return `<div class="row" style="--inset:52px">${avatar(p)}<span class="grow">${esc(p)}</span>
        <span class="end num"><span class="meta">${won(before[p] || 0)} →</span> <span class="amount">${won(after[p] || 0)}</span>
        <span class="meta" style="display:block">${d === 0 ? '그대로' : `${d > 0 ? '+' : '−'}${won(Math.abs(d))}`}</span></span></div>`;
    }).join('');
    action = `<section class="group"><h3 class="group-label"><span>중재안</span><span>${esc(state.proposal.label)}</span></h3>
        <div class="list"><p style="padding:14px 16px">${esc(state.proposal.summary)}</p>${linesHtml(e, state.proposal.lines, { editable: false, timed: true })}</div></section>
      <section class="group"><h3 class="group-label"><span>이 지출의 몫이 이렇게 바뀌어요</span><span>1/N → 중재안</span></h3><div class="list">${changes}</div></section>
      ${state.stage === 'proposal'
        ? `<button class="btn" style="width:100%" data-action="accept">이 중재안에 동의</button>
           <p class="group-note" style="text-align:center">동의하면 민수의 비서에게도 보내요. 민수의 규칙은 ‘근거와 맞으면 동의’예요.</p>`
        : '<p class="group-note" style="text-align:center">양쪽 비서가 동의해서 이 지출은 중재안대로 나눴어요.</p>'}`;
  }
  return {
    title: '이의 제기 · 2차 바',
    html: `<div class="big"><div class="amt">${yen(amountOf(e))}</div>
        <p class="sub">${esc(subj(e.payer))} 카드로 냄 · ${dayLabel(e.date)} ${e.time} 결제</p></div>
      <div class="split" style="margin-bottom:20px">
        <div class="claim"><h3>${avatar('민수', 'agent')}민수의 비서 주장</h3><p>${esc(DISPUTE.claim)}</p><ul>${DISPUTE.evidence.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="privacy">민수의 비서는 위치 기록 원본이 아니라 요약 한 줄만 보냈어요.</p></div>
        <div class="claim"><h3>${avatar('나', 'agent')}나의 비서 기록</h3><ul>${DISPUTE.counter.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="privacy">영수증의 주문 시각을 근거로 함께 보냈어요.</p></div>
      </div>
      <section class="group"><h3 class="group-label"><span>영수증 · 주문 시각</span><span>${esc(DISPUTE.by)} ${DISPUTE.leftAt} 귀가</span></h3><div class="list">${receipt}</div></section>
      ${action}`,
  };
}

function payerSheet(person) {
  const mine = transfers().filter((t) => t.from === person);
  const total = mine.reduce((s, t) => s + t.amount, 0);
  const rows = agreedLedger()[person];
  const sent = mine.length && mine.every((t) => state.sent[tKey(t)]);
  const head = `<p class="phone-label">${avatar(person)}${esc(person)}가 보는 화면이에요. 단톡방이 아니라 ${esc(person)}의 비서가 따로 알려 줘요.</p>`;
  if (sent) {
    const scheduled = mine.some((t) => state.sent[tKey(t)] === 'scheduled');
    return {
      title: `${person}의 비서`,
      html: `${head}<div class="done-mark"><span class="circle">${CHECK}</span>
        <h2 style="font-size:1.375rem">${scheduled ? `${PAYDAY}에 보낼게요` : '보냈어요'}</h2>
        <p class="meta">${won(total)} · ${mine.map((t) => esc(t.to)).join(', ')}에게 · 모의 송금</p></div>`,
    };
  }
  const checks = [
    `지출 ${EXPENSES.length}건 모두 ${person}가 함께 있던 일정이에요.`,
    state.modes[DISPUTE.expense] === 'items' ? `2차 바는 ${DISPUTE.leftAt} 이전 주문만 포함했어요. 중재안에 양쪽이 동의했어요.` : null,
    `환율은 여행 전에 합의한 ‘${policyLabel(TRIP.agreedPolicy)}’로 계산했어요.`,
    `${person}의 몫 ${won(rows.owed)} − 이미 낸 돈 ${won(rows.paid)} = ${won(total)}`,
  ].filter(Boolean);
  const seg = `<div class="seg" role="radiogroup" aria-label="보낼 때" data-seg="when"><span class="seg-thumb"></span>
    ${['지금', PAYDAY].map((w) => `<button type="button" role="radio" aria-checked="${w === state.payWhen}" data-action="when" data-id="${w}">${w === '지금' ? '지금 보내기' : w}</button>`).join('')}</div>`;
  const label = state.payWhen === '지금' ? `밀어서 ${won(total)} 보내기` : `밀어서 ${PAYDAY}에 예약`;
  return {
    title: `${person}의 비서`,
    html: `${head}
      <div class="big"><div class="amt">${won(total)}</div><p class="sub">${mine.map((t) => `${esc(t.to)}에게 ${won(t.amount)}`).join(', ')} · 오사카 2박 3일</p></div>
      <section class="group"><h3 class="group-label"><span>비서가 확인한 것</span></h3>
        <div class="list">${checks.map((c) => `<div class="row" style="--inset:16px"><span class="chip ok" aria-hidden="true">✓</span><span class="grow">${esc(c)}</span></div>`).join('')}</div></section>
      <section class="group"><h3 class="group-label"><span>보낼 때</span><span>보낼 시기를 놓치지 않게 비서가 챙겨요</span></h3>${seg}
        <div class="slider" data-commit="pay" data-p="${person}">
          <span class="slider-fill"></span><span class="slider-label">${label}</span>
          <button type="button" class="slider-thumb" aria-label="${label}. Enter 키로도 할 수 있어요">${ARROW}</button>
        </div>
        <p class="slider-hint">모의 송금이에요. 실제 돈은 움직이지 않아요.</p></section>`,
  };
}

function sheetContent({ kind, id }) {
  if (kind === 'expense') return expenseSheet(id);
  if (kind === 'dispute') return disputeSheet();
  return payerSheet(id);
}

// ---------------------------------------------------------------- 시트: 스프링으로 올라오고, 손잡이를 끌어 내린다
const sheetRoot = $('#sheet-root');
const sheetEl = $('#sheet');
const scrim = $('.scrim', sheetRoot);
const handle = $('#sheet-handle');
let sheetH = 0;
let closing = false;
let returnFocus = null;
const sheetY = new Spring(0, (v) => {
  sheetEl.style.transform = `translate3d(0, ${v}px, 0)`;
  scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - v / (sheetH || 1))));
});

function openSheet(kind, id) {
  state.sheet = { kind, id };
  if (!sheetRoot.hidden && !closing) return render();
  if (closing) {
    closing = false;
    render();
    return sheetY.to(0, { damping: 1, response: 0.35 });
  }
  returnFocus = document.activeElement;
  sheetRoot.hidden = false;
  document.body.classList.add('sheet-open');
  render();
  sheetH = sheetEl.offsetHeight;
  if (reduceMotion.matches) {
    sheetY.set(0);
    requestAnimationFrame(() => sheetRoot.classList.add('shown'));
  } else {
    sheetY.set(sheetH);
    sheetY.to(0, { damping: 1, response: 0.35 });
  }
  sheetEl.focus({ preventScroll: true });
}

function closeSheet(velocity = 0) {
  if (sheetRoot.hidden || closing) return;
  closing = true;
  const finish = () => {
    if (!closing) return;
    closing = false;
    sheetRoot.hidden = true;
    sheetRoot.classList.remove('shown');
    document.body.classList.remove('sheet-open');
    state.sheet = null;
    returnFocus?.focus?.({ preventScroll: true });
  };
  if (reduceMotion.matches) {
    sheetRoot.classList.remove('shown');
    setTimeout(finish, 200);
    return;
  }
  sheetH = sheetEl.offsetHeight;
  sheetY.to(sheetH + 24, { damping: 1, response: 0.3, velocity, onRest: finish });
}

const sheetVelocity = new VelocityTracker();
let drag = null;
handle.addEventListener('pointerdown', (e) => {
  if (e.target.closest('button')) return;
  handle.setPointerCapture(e.pointerId);
  sheetY.stop();
  closing = false;
  sheetH = sheetEl.offsetHeight;
  drag = { y0: e.clientY, from: sheetY.value, moved: false };
  sheetVelocity.reset();
  sheetVelocity.add(sheetY.value);
});
handle.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dy) < 4) return;
  drag.moved = true;
  let y = drag.from + dy;
  if (y < 0) y = -rubberband(-y, sheetH);
  sheetY.set(y);
  sheetVelocity.add(y);
});
const endDrag = () => {
  if (!drag) return;
  const { moved } = drag;
  drag = null;
  const v = sheetVelocity.get();
  if (moved && sheetY.value + project(v) > sheetH * 0.5) closeSheet(v);
  else sheetY.to(0, { damping: 0.8, response: 0.35, velocity: v });
};
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------- 분할 컨트롤과 밀어서 보내기
const segPos = new Map();
function mountSegs(scope) {
  scope.querySelectorAll('.seg').forEach((seg) => {
    const thumb = $('.seg-thumb', seg);
    const on = $('[aria-checked="true"]', seg);
    if (!on) return;
    const key = seg.dataset.seg;
    const x = on.offsetLeft;
    thumb.style.width = `${on.offsetWidth}px`;
    const spring = new Spring(0, (v) => {
      thumb.style.transform = `translate3d(${v}px, 0, 0)`;
      segPos.set(key, v);
    });
    spring.set(segPos.get(key) ?? x);
    if (spring.value !== x) spring.to(x, { damping: 1, response: 0.3 });
  });
}

function mountSliders(scope) {
  scope.querySelectorAll('.slider').forEach((el) => {
    const thumb = $('.slider-thumb', el);
    const fill = $('.slider-fill', el);
    const label = $('.slider-label', el);
    const max = () => el.clientWidth - thumb.offsetWidth - 8;
    const x = new Spring(0, (v) => {
      thumb.style.transform = `translate3d(${v}px, 0, 0)`;
      fill.style.width = `${Math.max(0, v) + 60}px`;
      label.style.opacity = String(Math.max(0, 1 - Math.max(0, v) / (max() * 0.6)));
    });
    const tracker = new VelocityTracker();
    let d = null;
    let done = false;
    const commit = (v) => {
      done = true;
      x.to(max(), {
        damping: 1,
        response: 0.25,
        velocity: Math.max(0, v),
        onRest: () => {
          navigator.vibrate?.(12);
          act(el.dataset.commit, el.dataset);
        },
      });
    };
    thumb.addEventListener('pointerdown', (e) => {
      if (done) return;
      e.preventDefault();
      thumb.setPointerCapture(e.pointerId);
      x.stop();
      d = { x0: e.clientX, from: x.value };
      tracker.reset();
      tracker.add(x.value);
      el.classList.add('pressed');
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!d) return;
      const m = max();
      let v = d.from + e.clientX - d.x0;
      if (v > m) v = m + rubberband(v - m, m);
      if (v < 0) v = -rubberband(-v, m);
      x.set(v);
      tracker.add(v);
    });
    const end = () => {
      if (!d) return;
      d = null;
      el.classList.remove('pressed');
      const v = tracker.get();
      const m = max();
      if (x.value > m * 0.5 && x.value + project(v, 0.99) >= m * 0.95) commit(v);
      else x.to(0, { damping: 0.8, response: 0.35, velocity: v });
    };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    thumb.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !done) {
        e.preventDefault();
        commit(0);
      }
    });
  });
}

// ---------------------------------------------------------------- 그리기와 이벤트
function render() {
  $('#main').innerHTML = [hero(), nextCard(), expensesSection(), policySection(), transfersSection(), memorySection()].join('');
  mountSegs($('#main'));
  renderChannel();
  if (state.sheet && !sheetRoot.hidden) {
    const body = $('#sheet-body');
    const top = body.scrollTop;
    const { title, html } = sheetContent(state.sheet);
    $('#sheet-title').textContent = title;
    body.innerHTML = html;
    body.scrollTop = top;
    mountSegs(body);
    mountSliders(body);
  }
  if (state.memEdit) $('#mem-input')?.focus();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  act(el.dataset.action, el.dataset);
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('.mem-add');
  if (!form) return;
  e.preventDefault();
  const p = form.dataset.p;
  const text = $('input', form).value.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (text && state.memory[p].length < MEMORY_LIMIT) {
    state.memory[p].push(text);
    state.memoryDirty = Boolean(state.allocs.izakaya);
  }
  state.memEdit = null;
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (state.memEdit) {
      state.memEdit = null;
      render();
    } else closeSheet();
    return;
  }
  const seg = e.target.closest?.('.seg');
  if (seg && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const buttons = [...seg.querySelectorAll('button')];
    const i = buttons.indexOf(e.target);
    const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
    const key = seg.dataset.seg;
    act(next.dataset.action, next.dataset);
    document.querySelector(`.seg[data-seg="${key}"] [data-id="${next.dataset.id}"]`)?.focus();
  }
});

const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 56), { passive: true });
addEventListener('resize', () => {
  segPos.clear();
  mountSegs(document);
});

async function loadConfig() {
  const mode = $('#mode');
  try {
    const res = await fetch(`${API_BASE}/api/config`, { signal: AbortSignal.timeout(8000) });
    config = await res.json();
    if (config.mode === 'gemini') {
      mode.textContent = `${sourceLabel({ source: config.model })} 연결됨`;
      mode.classList.add('live');
    } else {
      mode.textContent = '규칙 모드';
    }
  } catch {
    config = { mode: 'offline' };
    mode.textContent = '규칙 모드';
    mode.title = 'AI 서버에 연결되지 않아 규칙으로 나누고 중재해요';
  }
}

render();
loadConfig();
