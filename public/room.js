// 실제 방 화면. 지금은 방 불러오기, (개발용) 신원 고르기, 지출, 누가 누구에게, 비서끼리 기록까지 보여 준다.
// 지출 추가(#6)와 비서 처리(#9) 화면은 이 파일에 이어 붙인다.
import { won, money, dayLabel, amountOf, toKrw, shares, settle } from './core.js';
import { esc, chip, avatarHtml, tile, CHEVRON, logItemHtml, createSheet, mountSegs, resetSegs, segArrowKeys, topic } from './ui.js';
import { api, subscribeRoom, currentUid, setCurrentUid } from './room-api.js';
import { API_BASE } from './api.js';

const $ = (s, el = document) => el.querySelector(s);
const roomId = new URLSearchParams(location.search).get('room');
const state = { data: null, events: [], error: null, renderedLog: 0, sheet: null, draft: null, formError: '', saving: false, addMode: 'manual', reading: null, readNotes: [], aiReady: false, expId: null, edits: {}, allocating: null, allocSource: {} };
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

// ---------------------------------------------------------------- 지출 추가(직접 입력)
const LAST_KEY = `agent-settlement.last-expense.${roomId}`;
const kstNow = () => new Date(Date.now() + 9 * 3600_000).toISOString();
function lastUsed() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY)) || {};
  } catch {
    return {};
  }
}
function remember(d) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ currency: d.currency, payer: d.payer, method: d.method, present: d.present }));
  } catch {}
}
// 외화는 환율이 있는 날짜만 고를 수 있다
const fxDates = () => Object.keys(state.data.room.fx?.base ?? {}).sort();
function fitDate(d) {
  if (d.currency !== 'KRW' && !fxDates().includes(d.date)) d.date = fxDates()[0];
  return d;
}
function newDraft() {
  const { room, me } = state.data;
  const uids = room.members.map((m) => m.uid);
  const last = lastUsed();
  const currencies = ['KRW', room.fx?.currency].filter(Boolean);
  return fitDate({
    title: '',
    amount: '',
    currency: currencies.includes(last.currency) ? last.currency : 'KRW',
    payer: uids.includes(last.payer) ? last.payer : me.uid,
    method: last.method === 'cash' ? 'cash' : 'card',
    present: Array.isArray(last.present) && last.present.every((u) => uids.includes(u)) && last.present.length ? last.present : uids,
    date: kstNow().slice(0, 10),
    time: kstNow().slice(11, 16),
  });
}

async function saveExpense() {
  const d = state.draft;
  state.saving = true;
  state.formError = '';
  renderSheet();
  try {
    await api(`/api/rooms/${encodeURIComponent(roomId)}/expenses`, {
      method: 'POST',
      body: {
        expense: state.addMode === 'photo' && d.items
          ? { ...d, amount: undefined, source: 'receipt' }
          : { ...d, items: undefined, amount: Number(String(d.amount).replace(/[^\d]/g, '')) },
      },
    });
    remember(d);
    sheet.close();
    await load();
  } catch (e) {
    state.formError = e.message;
  }
  state.saving = false;
  renderSheet();
}

// ---------------------------------------------------------------- 영수증 사진
// 긴 변 1600px JPEG(품질 0.8)로 줄여 base64로 만든다. 원본 사진은 서버에 저장하지 않는다.
async function downscale(file, max = 1600, quality = 0.8) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  const url = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
  return { mimeType: 'image/jpeg', data: String(url).split(',')[1] };
}

async function readReceipt(file) {
  const controller = new AbortController();
  state.reading = controller;
  state.formError = '';
  renderSheet();
  try {
    const image = await downscale(file);
    const { draft } = await api(`/api/rooms/${encodeURIComponent(roomId)}/receipts/extract`, { method: 'POST', body: { image }, signal: controller.signal });
    applyReceipt(draft);
  } catch (e) {
    if (e.name !== 'AbortError') state.formError = `영수증을 읽지 못했어요(${e.message}). 직접 입력해 주세요.`;
    if (e.name !== 'AbortError') state.addMode = 'manual';
  }
  state.reading = null;
  renderSheet();
}

// 읽은 초안을 입력 폼에 채운다. 못 읽었으면 직접 입력으로 넘기고, 읽은 만큼만 채운다(금액은 비운다).
function applyReceipt(r) {
  const d = state.draft;
  const currencies = ['KRW', state.data.room.fx?.currency].filter(Boolean);
  if (r.merchant) d.title = r.merchant;
  if (currencies.includes(r.currency)) d.currency = r.currency;
  if (r.time) d.time = r.time;
  const notes = [...(r.warnings || [])];
  if (r.date) {
    d.date = r.date;
    if (d.currency !== 'KRW' && !fxDates().includes(r.date)) notes.push(`영수증 날짜(${dayLabel(r.date)})의 환율이 없어 날짜를 다시 골라야 해요`);
  }
  fitDate(d);
  if (!r.ok) {
    state.addMode = 'manual';
    d.amount = '';
    state.formError = `${r.reason}. 직접 입력해 주세요.`;
    state.readNotes = [];
    return;
  }
  d.items = r.items;
  d.total = r.total;
  state.readNotes = notes;
}

// ---------------------------------------------------------------- 지출 상세: 메뉴 배분과 줄 확인
const isFlagged = (a) => Boolean(a) && a.confidence < 0.7 && !a.confirmed;

async function allocateExpense(eid) {
  state.allocating = eid;
  state.formError = '';
  renderSheet();
  try {
    const out = await api(`/api/rooms/${encodeURIComponent(roomId)}/expenses/${encodeURIComponent(eid)}/allocate`, { method: 'POST', body: {} });
    state.allocSource[eid] = `${out.source === 'rules' ? '규칙' : out.source.replace(/^gemini-/, 'Gemini ').replace('-flash', ' Flash')} · ${(out.latencyMs / 1000).toFixed(1)}초`;
    delete state.edits[eid];
  } catch (e) {
    state.formError = e.message;
  }
  state.allocating = null;
  await load();
}

async function confirmLine(eid, itemId) {
  const exp = state.data.expenses.find((e) => e.id === eid);
  const consumers = state.edits[eid]?.[itemId] ?? exp.alloc?.[itemId]?.consumers;
  try {
    await api(`/api/rooms/${encodeURIComponent(roomId)}/expenses/${encodeURIComponent(eid)}/lines/${encodeURIComponent(itemId)}`, { method: 'POST', body: { consumers, confirm: true } });
    if (state.edits[eid]) delete state.edits[eid][itemId];
    state.formError = '';
  } catch (e) {
    state.formError = e.message;
  }
  await load();
}

function expenseChip(e) {
  if (!e.items?.length) return chip('1/N');
  if (!e.alloc) return chip('메뉴별로 나누기 전');
  const n = e.items.filter((it) => isFlagged(e.alloc[it.id])).length;
  return n ? chip(`확인 필요 ${n}`, 'warn') : chip('메뉴별로 나눔', 'ok');
}

function linesHtml(exp) {
  const edits = state.edits[exp.id] ?? {};
  return exp.items.map((it) => {
    const a = exp.alloc?.[it.id];
    const chosen = edits[it.id] ?? a?.consumers ?? [];
    const edited = Boolean(edits[it.id]);
    const flag = isFlagged(a);
    const picks = exp.present.map((u) => `<button type="button" class="pick" aria-pressed="${chosen.includes(u)}" ${a ? '' : 'disabled'}
        data-action="pick" data-exp="${esc(exp.id)}" data-line="${esc(it.id)}" data-p="${esc(u)}">${avatar(u)}${esc(nameOf(u))}</button>`).join('');
    const confirmBtn = a && (flag || edited)
      ? `<div><button class="btn sm ${flag ? 'secondary' : 'plain'}" data-action="confirm-line" data-exp="${esc(exp.id)}" data-line="${esc(it.id)}">${edited ? '이대로 확인' : '비서가 짐작한 대로 확인'}</button></div>`
      : '';
    return `<div class="line ${flag ? 'flag' : ''}">
      <div class="line-top"><span class="line-name">${it.time ? `<small style="margin:0 6px 0 0">${esc(it.time)}</small>` : ''}${esc(it.name)}<small>×${it.qty}</small></span><span class="num">${money(it.qty * it.unit, exp.currency)}</span></div>
      <div class="picks">${picks}</div>
      <p class="reason">${a ? esc(a.confirmed ? `${a.reason ? `${a.reason} ` : ''}(확인함)` : a.reason) : '아직 나누지 않았어요.'}</p>
      ${confirmBtn}</div>`;
  }).join('');
}

function expSheetHtml(exp) {
  const { room } = state.data;
  const { krw, how } = toKrw(exp, room, room.policy);
  const s = shares(exp, room, room.policy);
  const busy = state.allocating === exp.id;
  const lines = exp.items?.length
    ? `<section class="group"><h3 class="group-label"><span>영수증 ${exp.items.length}줄 · 누가 먹었나</span><span>${esc(state.allocSource[exp.id] ?? (exp.alloc ? '' : '나누기 전'))}</span></h3>
        ${busy ? '<div class="next" aria-busy="true" style="margin:0 0 12px"><h2 style="font-size:1.0625rem">비서들이 기억으로 나누는 중이에요</h2><div class="progress"><i></i></div></div>' : ''}
        <div class="list">${linesHtml(exp)}</div>
        <p class="group-note">${exp.alloc ? '이름을 눌러 고친 뒤 확인하면 그 줄은 더 묻지 않아요.' : '각자의 비서가 공유한 기억으로 줄마다 먹은 사람을 정해요. 근거가 없는 줄은 짐작하지 않고 물어봐요.'}</p>
        <button class="btn ${exp.alloc ? 'secondary' : ''}" style="width:100%;margin-top:10px" data-action="allocate-exp" data-id="${esc(exp.id)}" ${busy ? 'disabled' : ''}>${exp.alloc ? '비서에게 다시 나누기' : '비서에게 나누기 맡기기'}</button></section>`
    : `<p class="how">영수증 줄이 없어서 함께 있던 ${exp.present.length}명이 똑같이 나눠요.</p>`;
  return `<div class="big"><div class="amt">${won(krw)}</div>
      <p class="sub">${money(amountOf(exp), exp.currency)} · ${esc(nameOf(exp.payer))} ${exp.method === 'card' ? '카드' : '현금'} · ${dayLabel(exp.date)} ${esc(exp.time)}</p></div>
    <p class="how">${esc(how)}</p>
    ${state.formError ? `<p class="form-error" role="alert">${esc(state.formError)}</p>` : ''}
    ${lines}
    <section class="group"><h3 class="group-label"><span>사람별 몫</span><span>${exp.split === 'items' ? '먹은 만큼' : '1/N'}</span></h3>
      <div class="list">${room.members.filter((m) => s.krwShare[m.uid] !== undefined).map((m) => `<div class="row" style="--inset:52px">${avatar(m.uid)}
        <span class="grow">${esc(m.name)}${m.uid === exp.payer ? ' <span class="meta">· 낸 사람, 끝전 포함</span>' : ''}</span>
        <span class="amount num">${won(s.krwShare[m.uid])}</span></div>`).join('')}</div></section>`;
}

const lineSum = (items) => items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit) || 0), 0);

async function act(name, d) {
  if (name === 'add-expense') {
    state.draft = newDraft();
    state.addMode = 'manual';
    state.readNotes = [];
    state.formError = '';
    state.sheet = 'add';
    sheet.open(renderSheet);
  } else if (name === 'close-sheet') {
    sheet.close();
  } else if (name === 'draft-set') {
    state.draft[d.field] = d.id;
    fitDate(state.draft);
    renderSheet();
  } else if (name === 'draft-present') {
    const set = new Set(state.draft.present);
    if (set.has(d.id)) set.delete(d.id); else set.add(d.id);
    if (set.size) state.draft.present = members().map((m) => m.uid).filter((u) => set.has(u));
    renderSheet();
  } else if (name === 'open-exp') {
    state.expId = d.id;
    state.formError = '';
    state.sheet = 'exp';
    sheet.open(renderSheet);
  } else if (name === 'allocate-exp') {
    if (!state.allocating) allocateExpense(d.id);
  } else if (name === 'pick') {
    const exp = state.data.expenses.find((e) => e.id === d.exp);
    const edits = (state.edits[d.exp] ??= {});
    const set = new Set(edits[d.line] ?? exp.alloc?.[d.line]?.consumers ?? []);
    if (set.has(d.p)) set.delete(d.p); else set.add(d.p);
    if (set.size) edits[d.line] = exp.present.filter((u) => set.has(u));
    renderSheet();
  } else if (name === 'confirm-line') {
    confirmLine(d.exp, d.line);
  } else if (name === 'add-mode') {
    state.addMode = d.id;
    state.formError = '';
    renderSheet();
  } else if (name === 'cancel-read') {
    state.reading?.abort();
  } else if (name === 'draft-del-item') {
    state.draft.items.splice(Number(d.i), 1);
    if (!state.draft.items.length) state.draft.items = undefined;
    renderSheet();
  } else if (name === 'save-expense') {
    if (!state.saving) saveExpense();
  } else if (name === 'who') {
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
  const mine = state.data.actions ?? [];
  if (!mine.length) {
    return `<section class="next"><p class="eyebrow">${esc(state.data.me.name)}의 할 일</p><h2>지금은 할 일이 없어요</h2>
      <p>비서가 처리하다가 확인이 필요하면 여기에 올라와요.</p></section>`;
  }
  const first = mine[0];
  const button = first.type === 'confirm_line' ? `<div class="actions"><button class="btn" data-action="open-exp" data-id="${esc(first.expenseId)}">확인하기</button></div>` : '';
  return `<section class="next warn"><p class="eyebrow">${esc(state.data.me.name)}의 할 일 ${mine.length}개</p><h2>${esc(first.text)}</h2>
    <p>비서들의 기억에 근거가 없는 줄이에요. 그래서 비서가 짐작으로 청구하지 않고 먼저 물어봐요.</p>${button}</section>`;
}

function expensesSection() {
  const { room, expenses } = state.data;
  const rows = expenses.map((e) => `<button class="row" data-action="open-exp" data-id="${esc(e.id)}">
      ${tile(e.kind)}
      <span class="grow"><span class="title">${esc(e.title)}</span>
        <span class="meta" style="display:block">${esc(nameOf(e.payer))} · ${e.method === 'card' ? '카드' : '현금'} ${money(amountOf(e), e.currency)} · ${dayLabel(e.date)} ${esc(e.time)}</span>
        <span style="display:block;margin-top:4px">${expenseChip(e)}</span></span>
      <span class="end"><span class="amount">${won(toKrw(e, room, room.policy).krw)}</span></span>
      ${CHEVRON}
    </button>`).join('');
  return `<section class="group"><h2 class="group-label"><span>지출 ${expenses.length}건</span><button class="text-btn" data-action="add-expense">지출 추가</button></h2>
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

const seg = (key, field, options, value) => `<div class="seg" role="radiogroup" data-seg="${key}"><span class="seg-thumb"></span>
  ${options.map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === value}" data-action="draft-set" data-field="${field}" data-id="${esc(id)}">${esc(label)}</button>`).join('')}</div>`;

function addSheetHtml() {
  const d = state.draft;
  const { room } = state.data;
  const currencies = ['KRW', room.fx?.currency].filter(Boolean);
  const dateField = d.currency === 'KRW'
    ? `<input type="date" data-field="date" value="${esc(d.date)}" aria-label="날짜">`
    : `<select data-field="date" aria-label="날짜">${fxDates().map((x) => `<option value="${x}" ${x === d.date ? 'selected' : ''}>${dayLabel(x)}</option>`).join('')}</select>`;
  const picks = room.members.map((m) => `<button type="button" class="pick" aria-pressed="${d.present.includes(m.uid)}" data-action="draft-present" data-id="${esc(m.uid)}">${avatar(m.uid)}${esc(m.name)}</button>`).join('');
  const tabs = `<div style="margin-bottom:16px">${seg('add-mode', 'mode', [['manual', '직접 입력'], ['photo', '영수증 사진']], state.addMode).replaceAll('data-action="draft-set"', 'data-action="add-mode"')}</div>`;
  if (state.addMode === 'photo' && !d.items) return tabs + photoPickHtml();
  const amountRow = state.addMode === 'photo' && d.items
    ? linesEditHtml(d)
    : `<label class="row field"><span class="grow">금액</span><input data-field="amount" value="${esc(d.amount)}" inputmode="numeric" placeholder="0" aria-label="금액"></label>`;
  return `${tabs}${state.readNotes.length ? state.readNotes.map((n) => `<p class="preview-note" style="margin-bottom:10px">${esc(n)}</p>`).join('') : ''}
    <section class="group"><div class="list">
      <label class="row field"><span class="grow">제목</span><input data-field="title" value="${esc(d.title)}" placeholder="예: 편의점 간식" maxlength="40"></label>
    </div></section>
    ${amountRow}
    ${currencies.length > 1 ? `<section class="group"><h3 class="group-label"><span>통화</span>${d.currency !== 'KRW' ? '<span>환율이 있는 날짜만 고를 수 있어요</span>' : ''}</h3>${seg('cur', 'currency', currencies.map((c) => [c, c === 'KRW' ? '원' : c === 'JPY' ? '엔' : c]), d.currency)}</section>` : ''}
    <section class="group"><h3 class="group-label"><span>낸 사람</span></h3>${seg('payer', 'payer', room.members.map((m) => [m.uid, m.name]), d.payer)}</section>
    <section class="group"><h3 class="group-label"><span>결제 수단</span></h3>${seg('method', 'method', [['card', '카드'], ['cash', '현금']], d.method)}</section>
    <section class="group"><h3 class="group-label"><span>함께한 사람</span><span>${d.present.length}명이 나눠요</span></h3><div class="picks">${picks}</div></section>
    <section class="group"><div class="list"><div class="row field"><span class="grow">날짜</span>${dateField}</div>
      <label class="row field"><span class="grow">시각</span><input type="time" data-field="time" value="${esc(d.time)}" aria-label="시각"></label></div></section>
    ${state.formError ? `<p class="form-error" role="alert">${esc(state.formError)}</p>` : ''}
    <button class="btn" style="width:100%" data-action="save-expense" ${state.saving ? 'disabled' : ''}>${state.saving ? '남기는 중…' : '지출 남기기'}</button>`;
}

function photoPickHtml() {
  if (state.reading) {
    return `<section class="next" aria-busy="true" style="margin:0"><p class="eyebrow">AI가 읽는 중</p><h2>영수증을 읽고 있어요</h2>
      <p>줄마다 메뉴·수량·단가를 읽어요. 보통 몇 초면 끝나요.</p><div class="progress"><i></i></div>
      <div class="actions"><button class="btn plain sm" data-action="cancel-read">취소</button></div></section>`;
  }
  if (!state.aiReady) {
    return `<p class="preview-note">사진 읽기는 AI 서버가 필요해요. 지금은 '직접 입력'을 써 주세요.</p>`;
  }
  return `<section class="next" style="margin:0"><h2>영수증을 찍거나 골라 주세요</h2>
    <p>AI가 읽은 내용은 저장 전에 직접 확인하고 고칠 수 있어요. 사진 원본은 저장하지 않아요.</p>
    <div class="actions"><label class="btn" style="display:inline-flex;align-items:center">사진 고르기
      <input type="file" accept="image/*" capture="environment" data-receipt hidden></label></div></section>`;
}

// 읽은 줄을 고칠 수 있는 목록. 합계와 줄 합을 나란히 보여 준다.
function linesEditHtml(d) {
  const rows = d.items.map((it, i) => `<div class="row field" style="gap:8px">
      <input data-item="${i}" data-key="name" value="${esc(it.name)}" aria-label="메뉴 이름" style="text-align:left;flex:3">
      <input data-item="${i}" data-key="qty" value="${it.qty}" inputmode="numeric" aria-label="수량" style="flex:1">
      <input data-item="${i}" data-key="unit" value="${it.unit}" inputmode="numeric" aria-label="단가" style="flex:2">
      <button type="button" class="text-btn" data-action="draft-del-item" data-i="${i}" aria-label="${esc(it.name)} 줄 지우기">×</button></div>`).join('');
  return `<section class="group"><h3 class="group-label"><span>영수증 ${d.items.length}줄 · 이름 · 수량 · 단가</span>
      <span id="line-sum">줄 합 ${money(lineSum(d.items), d.currency)}${d.total ? ` · 영수증 합계 ${money(d.total, d.currency)}` : ''}</span></h3>
    <div class="list">${rows}</div>
    <p class="group-note">메뉴별로 누가 먹었는지는 저장한 뒤 '비서에게 나누기'로 정해요.</p></section>`;
}

function renderSheet() {
  if (!state.sheet || !state.data) return;
  const body = $('#sheet-body');
  const top = body.scrollTop;
  const exp = state.sheet === 'exp' ? state.data.expenses.find((e) => e.id === state.expId) : null;
  $('#sheet-title').textContent = exp ? exp.title : '지출 남기기';
  body.innerHTML = exp ? expSheetHtml(exp) : addSheetHtml();
  body.scrollTop = top;
  mountSegs(body);
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
  if (state.sheet === 'exp') renderSheet();
}

// ---------------------------------------------------------------- 이벤트
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  act(el.dataset.action, el.dataset);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') sheet.close();
  else segArrowKeys(e, (btn) => act(btn.dataset.action, btn.dataset));
});
// 입력칸은 다시 그리지 않고 값만 기억한다(타이핑 중 초점을 잃지 않게)
document.addEventListener('input', (e) => {
  const f = e.target.dataset?.field;
  if (f && state.draft) state.draft[f] = e.target.value;
  const i = e.target.dataset?.item;
  if (i !== undefined && state.draft?.items) {
    const key = e.target.dataset.key;
    state.draft.items[i][key] = key === 'name' ? e.target.value : Number(String(e.target.value).replace(/[^\d-]/g, ''));
    const sum = $('#line-sum');
    if (sum) sum.textContent = `줄 합 ${money(lineSum(state.draft.items), state.draft.currency)}${state.draft.total ? ` · 영수증 합계 ${money(state.draft.total, state.draft.currency)}` : ''}`;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.matches?.('input[data-receipt]') && e.target.files?.[0]) readReceipt(e.target.files[0]);
});
document.addEventListener('change', (e) => {
  const f = e.target.dataset?.field;
  if (f && state.draft) state.draft[f] = e.target.value;
});
const sheet = createSheet($('#sheet-root'), { onClosed: () => { state.sheet = null; } });
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
    state.aiReady = config.mode === 'gemini';
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
