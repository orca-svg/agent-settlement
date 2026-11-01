// 실제 방 화면. 지금은 방 불러오기, (개발용) 신원 고르기, 지출, 누가 누구에게, 비서끼리 기록까지 보여 준다.
// 지출 추가(#6)와 비서 처리(#9) 화면은 이 파일에 이어 붙인다.
import { won, money, dayLabel, amountOf, toKrw, settle } from './core.js';
import { esc, chip, avatarHtml, tile, logItemHtml, mountSegs, resetSegs, segArrowKeys } from './ui.js';
import { api, subscribeRoom, currentUid, setCurrentUid } from './room-api.js';
import { API_BASE } from './api.js';

const $ = (s, el = document) => el.querySelector(s);
const roomId = new URLSearchParams(location.search).get('room');
const state = { data: null, events: [], error: null, renderedLog: 0 };
let unsubscribe = () => {};

const members = () => state.data?.room.members ?? [];
const nameOf = (uid) => ({ system: '시스템', mediator: '중재 비서', all: '모두' })[uid] ?? members().find((m) => m.uid === uid)?.name ?? uid;
const agentName = (uid) => (uid === 'system' || uid === 'mediator' ? nameOf(uid) : `${nameOf(uid)}의 비서`);
const colorOf = (uid) => {
  const i = members().findIndex((m) => m.uid === uid);
  return i < 0 ? '#8e8e93' : `var(--p${i % 4})`;
};
const avatar = (uid, cls = '') => avatarHtml(nameOf(uid)[0], colorOf(uid), cls);
const timeOf = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

// ---------------------------------------------------------------- 데이터
async function load() {
  try {
    state.data = await api(`/api/rooms/${encodeURIComponent(roomId)}`);
    state.error = null;
  } catch (e) {
    state.error = e;
  }
  render();
}

function watch() {
  unsubscribe();
  state.events = [];
  state.renderedLog = 0;
  unsubscribe = subscribeRoom(roomId, (events) => {
    state.events.push(...events);
    renderChannel();
    load(); // 기록이 생기면 방 상태도 바뀌었을 수 있다
  });
}

async function act(name, d) {
  if (name === 'who') {
    setCurrentUid(d.id);
    await load();
    watch();
  } else if (name === 'seed') {
    try {
      const { roomId: id } = await api('/api/dev/seed', { method: 'POST' });
      location.search = `?room=${encodeURIComponent(id)}`;
    } catch {
      state.error = { status: 'seed' };
      render();
    }
  }
}

// ---------------------------------------------------------------- 화면
function noRoom() {
  const failed = state.error?.status === 'seed';
  return `<section class="hero"><h1>열 방이 없어요</h1>
    <p class="sub">실제 방 만들기·참가하기는 #4에서 생겨요. 그전까지는 개발용 데모 방으로 확인해요.</p></section>
    <section class="next"><p class="eyebrow">개발용</p><h2>데모 방 만들기</h2>
      <p>${failed ? '서버가 개발용 시드를 막았어요. <code>DEV_SEED=1 npm start</code>로 서버를 다시 켜 주세요.' : '오사카 2박 3일 지출 7건과 4명의 비서 설정이 들어간 방을 만들어요.'}</p>
      <div class="actions"><button class="btn" data-action="seed">데모 방 만들기</button></div></section>`;
}

function whoPicker() {
  const me = currentUid();
  return `<section class="group"><h2 class="group-label"><span>누구로 볼까요?</span><span>개발용 · 로그인(#2)이 생기면 사라져요</span></h2>
    <div class="seg" role="radiogroup" aria-label="보는 사람" data-seg="who"><span class="seg-thumb"></span>
      ${members().map((m) => `<button type="button" role="radio" aria-checked="${m.uid === me}" data-action="who" data-id="${esc(m.uid)}">${esc(m.name)}</button>`).join('')}
    </div></section>`;
}

function hero() {
  const { room } = state.data;
  return `<section class="hero"><h1>${esc(room.name)}</h1>
    <p class="sub">${esc(room.dates || '')}${room.dates ? ' · ' : ''}${room.members.length}명 · 돈 얘기는 각자의 비서끼리 해요</p>
    <div class="people">${room.members.map((m) => `<span class="person">${avatar(m.uid)}${esc(m.name)}</span>`).join('')}</div></section>`;
}

function nextCard() {
  const mine = state.events.filter((e) => e.action?.for === state.data.me.uid);
  if (!mine.length) {
    return `<section class="next"><p class="eyebrow">${esc(state.data.me.name)}의 할 일</p><h2>지금은 할 일이 없어요</h2>
      <p>비서가 처리하다가 확인이 필요하면 여기에 올라와요.</p></section>`;
  }
  const last = mine.at(-1);
  return `<section class="next warn"><p class="eyebrow">${esc(state.data.me.name)}의 할 일 ${mine.length}개</p><h2>${esc(last.text)}</h2></section>`;
}

function expensesSection() {
  const { room, expenses } = state.data;
  const rows = expenses.map((e) => `<div class="row">
      ${tile(e.kind)}
      <span class="grow"><span class="title">${esc(e.title)}</span>
        <span class="meta" style="display:block">${esc(nameOf(e.payer))} · ${e.method === 'card' ? '카드' : '현금'} ${money(amountOf(e), e.currency)} · ${dayLabel(e.date)} ${esc(e.time)}</span></span>
      <span class="end"><span class="amount">${won(toKrw(e, room, room.policy).krw)}</span></span>
    </div>`).join('');
  return `<section class="group"><h2 class="group-label"><span>지출 ${expenses.length}건</span></h2>
    <div class="list">${rows || '<p class="empty">아직 지출이 없어요.</p>'}</div></section>`;
}

function transfersSection() {
  const { transfers, ledger } = state.data;
  const live = transfers.filter((t) => t.status !== 'superseded');
  const list = live.length ? live : settle(ledger).map((t) => ({ ...t, status: 'preview' }));
  const label = { preview: '청구서 보내기 전', scheduled: '예약됨', due: '보낼 때가 됐어요', opened: '송금 앱 열림', sent: '보냈어요', confirmed: '받았어요' };
  const rows = list.map((t) => `<div class="row" style="--inset:76px">
      <span style="display:flex;gap:2px">${avatar(t.from)}${avatar(t.to)}</span>
      <span class="grow"><span class="title">${esc(nameOf(t.from))} → ${esc(nameOf(t.to))}</span>
        <span style="display:block;margin-top:3px">${chip(label[t.status] ?? t.status, t.status === 'confirmed' ? 'ok' : '')}</span></span>
      <span class="end"><span class="amount num">${won(t.amount)}</span></span></div>`).join('');
  return `<section class="group"><h2 class="group-label"><span>누가 누구에게</span><span>송금 ${list.length}번</span></h2>
    <div class="list">${rows || '<p class="empty">주고받을 돈이 없어요.</p>'}</div></section>`;
}

function renderChannel() {
  const items = state.events.map((e, i) => logItemHtml({
    avatar: avatar(e.from, 'agent'),
    who: `${agentName(e.from)} → ${nameOf(e.to)}`,
    time: timeOf(e.at),
    text: e.text,
    meta: e.meta,
    tagHtml: e.action ? chip(`${nameOf(e.action.for)}의 확인 필요`, 'warn') : '',
    enter: i >= state.renderedLog,
  })).join('');
  const el = $('#channel');
  el.innerHTML = `<h2>비서끼리</h2><p class="lead">단톡방 대신 비서들이 주고받은 기록이에요. 사람에게는 확인할 일만 올라와요.</p>
    ${state.events.length ? `<ol class="log">${items}</ol>` : `<p class="empty">${state.data ? '아직 기록이 없어요.' : '방을 열면 비서들의 기록이 여기에 보여요.'}</p>`}`;
  state.renderedLog = state.events.length;
  el.scrollTop = el.scrollHeight;
}

function render() {
  const main = $('#main');
  if (!state.data) renderChannel();
  if (!roomId || state.error?.status === 'seed') {
    main.innerHTML = noRoom();
    return;
  }
  if (state.error?.status === 404) {
    main.innerHTML = `<section class="hero"><h1>방을 찾을 수 없어요</h1>
      <p class="sub">서버를 다시 켜면 메모리에 있던 방이 사라져요. 개발용 데모 방을 다시 만들어 주세요.</p></section>
      <section class="next"><div class="actions"><button class="btn" data-action="seed">데모 방 만들기</button></div></section>`;
    return;
  }
  if (!state.data) {
    // 아직 누구인지 모르거나(401) 이 방 멤버가 아니면(403) 방 정보 없이 멤버 목록도 모른다.
    // 개발용 시드 방의 uid로 고르게 한다.
    const seedMembers = [['me', '나'], ['cs', '철수'], ['yh', '영희'], ['ms', '민수']];
    main.innerHTML = `<section class="hero"><h1>누구로 볼까요?</h1>
      <p class="sub">개발용 데모 방의 멤버 중 한 명을 골라 주세요. 로그인(#2)이 생기면 이 단계는 사라져요.</p></section>
      <section class="group"><div class="list">${seedMembers.map(([uid, name]) => `<button class="row" data-action="who" data-id="${uid}">
        ${avatarHtml(name[0], '#8e8e93')}<span class="grow">${name}</span></button>`).join('')}</div></section>`;
    return;
  }
  $('#nav-title').textContent = state.data.room.name;
  main.innerHTML = [hero(), whoPicker(), nextCard(), expensesSection(), transfersSection()].join('');
  mountSegs(main);
}

// ---------------------------------------------------------------- 이벤트
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  act(el.dataset.action, el.dataset);
});
document.addEventListener('keydown', (e) => segArrowKeys(e, (btn) => act(btn.dataset.action, btn.dataset)));
const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 56), { passive: true });
addEventListener('resize', () => {
  resetSegs();
  mountSegs(document);
});

async function loadConfig() {
  const mode = $('#mode');
  try {
    const config = await (await fetch(`${API_BASE}/api/config`, { signal: AbortSignal.timeout(8000) })).json();
    mode.textContent = config.mode === 'gemini' ? 'Gemini 연결됨' : '규칙 모드';
    mode.classList.toggle('live', config.mode === 'gemini');
  } catch {
    mode.textContent = '서버 연결 안 됨';
  }
}

loadConfig();
if (roomId) {
  load();
  if (currentUid()) watch(); // 누구인지 정해진 뒤에만 기록을 받아 온다
} else {
  render();
}
