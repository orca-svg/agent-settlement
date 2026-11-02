// 실제 방 화면. 지금은 방 불러오기, (개발용) 신원 고르기, 지출, 누가 누구에게, 비서끼리 기록까지 보여 준다.
// 지출 추가(#6)와 비서 처리(#9) 화면은 이 파일에 이어 붙인다.
import { won, money, dayLabel, amountOf, toKrw, shares, settle } from './core.js';
import { esc, chip, avatarHtml, tile, CHEVRON, logItemHtml, createSheet, mountSegs, resetSegs, mountSliders, segArrowKeys, topic, subj, restNote, allocLabel, allocButton, ARROW, qrImageUrl, qrIsFresh } from './ui.js';
import { api, subscribeRoom, currentUid, setCurrentUid } from './room-api.js';
import { createLogPop } from './log-pop.js';
import { API_BASE } from './api.js';
import { BANKS } from './banks.js';

const $ = (s, el = document) => el.querySelector(s);
const roomId = new URLSearchParams(location.search).get('room');
const state = { data: null, events: [], error: null, renderedLog: 0, sheet: null, draft: null, formError: '', saving: false, addMode: 'manual', reading: null, readNotes: [], aiReady: false, editing: null, lastImage: null, armedDelete: null, expId: null, edits: {}, allocating: null, allocSource: {}, ref: null, busy: null, disputeDraft: null, payoutDraft: null, transferNote: null, pendingSend: null, copied: null, qr: null };
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

// 좁은 화면에서 상단바 종으로 여는 비서끼리 기록. 마지막으로 본 기록은 방·사람마다 기억한다
const seenKey = () => `agent-settlement.seen.${roomId}.${currentUid()}`;
const logPop = createLogPop({
  itemHtml: (e, opts) => logItemHtml({
    avatar: avatar(e.from, 'agent'),
    who: `${agentName(e.from)} → ${nameOf(e.to)}`,
    time: timeOf(e.at),
    text: e.text,
    meta: e.meta,
    tagHtml: e.action ? chip(`${nameOf(e.action.for)}의 확인 필요`, 'warn') : '',
    ...opts,
  }),
  timeOf: (e) => timeOf(e.at),
  todosHtml: () => (state.data?.actions ?? []).map((a) => `<div class="pop-todo"><b>${esc(state.data.me.name)}의 할 일</b><p>${esc(a.text)}</p>
    <div class="actions">${actionButtons(a, 'sm')}<button class="btn sm plain" data-action="close-log">나중에</button></div></div>`).join(''),
  seen: {
    get: () => {
      try {
        return Number(localStorage.getItem(seenKey())) || 0;
      } catch {
        return 0;
      }
    },
    set: (seq) => {
      try {
        localStorage.setItem(seenKey(), String(seq));
      } catch {}
    },
  },
});

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
    const path = state.editing
      ? `/api/rooms/${encodeURIComponent(roomId)}/expenses/${encodeURIComponent(state.editing)}`
      : `/api/rooms/${encodeURIComponent(roomId)}/expenses`;
    await api(path, {
      method: 'POST',
      body: {
        ...(!state.editing && state.addMode === 'photo' && d.items && state.lastImage ? { receipt: state.lastImage } : {}),
        expense: state.addMode === 'photo' && d.items
          ? { ...d, amount: undefined, source: 'receipt' }
          : { ...d, items: undefined, amount: Number(String(d.amount).replace(/[^\d]/g, '')) },
      },
    });
    remember(d);
    if (state.editing) {
      state.sheet = 'exp';
      state.expId = state.editing;
      state.editing = null;
    } else {
      sheet.close();
    }
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
    state.lastImage = image;
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
    state.allocSource[eid] = allocLabel(out);
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
  const ab = allocButton({ allocated: Boolean(exp.alloc), fresh: Boolean(exp.allocFresh), flagged: (exp.items ?? []).filter((it) => isFlagged(exp.alloc?.[it.id])).length });
  const lines = exp.items?.length
    ? `<section class="group"><h3 class="group-label"><span>영수증 ${exp.items.length}줄 · 어떻게 나눌까요</span><span>${esc(state.allocSource[exp.id] ?? (exp.alloc ? '' : '나누기 전'))}</span></h3>
        ${busy ? '<div class="next" aria-busy="true" style="margin:0 0 12px"><h2 style="font-size:1.0625rem">비서들이 기억으로 나누는 중이에요</h2><div class="progress"><i></i></div></div>' : ''}
        <div class="list">${linesHtml(exp)}</div>
        <p class="group-note">${exp.alloc ? '이름을 눌러 고친 뒤 확인하면 그 줄은 더 묻지 않아요.' : '각자의 비서가 공유한 기억으로 줄마다 누구 몫인지 정해요. 근거가 없는 줄은 짐작하지 않고 물어봐요.'}</p>
        <button class="btn ${exp.alloc ? 'secondary' : ''}" style="width:100%;margin-top:10px" data-action="allocate-exp" data-id="${esc(exp.id)}" ${busy || ab.disabled ? 'disabled' : ''}>${ab.label}</button>
        ${ab.hint ? `<p class="group-note" style="margin-top:8px">${esc(ab.hint)}</p>` : ''}</section>`
    : `<p class="how">영수증 줄이 없어서 함께 있던 ${exp.present.length}명이 똑같이 나눠요.</p>`;
  return `<div class="big"><div class="amt">${won(krw)}</div>
      <p class="sub">${money(amountOf(exp), exp.currency)} · ${esc(nameOf(exp.payer))} ${exp.method === 'card' ? '카드' : '현금'} · ${dayLabel(exp.date)} ${esc(exp.time)}</p></div>
    <p class="how">${esc(how)}</p>
    ${exp.hasReceipt ? `<button class="btn secondary" style="width:100%;margin-bottom:20px" data-action="show-receipt" data-id="${esc(exp.id)}">영수증 확인하기</button>` : ''}
    ${state.formError ? `<p class="form-error" role="alert">${esc(state.formError)}</p>` : ''}
    ${lines}
    <section class="group"><h3 class="group-label"><span>사람별 몫</span><span>${exp.split === 'items' ? '쓴 만큼' : '1/N'}</span></h3>
      <div class="list">${room.members.filter((m) => s.krwShare[m.uid] !== undefined).map((m) => `<div class="row" style="--inset:52px">${avatar(m.uid)}
        <span class="grow">${esc(m.name)}${m.uid === exp.payer ? ' <span class="meta">· 낸 사람</span>' : ''}</span>
        <span class="amount num">${won(s.krwShare[m.uid])}</span></div>`).join('')}</div>${restNote(s.rest)}</section>
    <div style="display:grid;gap:8px">
      <button class="btn plain" data-action="edit-exp" data-id="${esc(exp.id)}">지출 고치기</button>
      <button class="btn danger ${state.armedDelete === exp.id ? 'armed' : ''}" data-action="delete-exp" data-id="${esc(exp.id)}">${state.armedDelete === exp.id ? '한 번 더 누르면 지워요' : '지출 지우기'}</button>
    </div>`;
}

// ---------------------------------------------------------------- 영수증 사진 모달
async function showReceipt(eid) {
  try {
    const { mimeType, data } = await api(`/api/rooms/${encodeURIComponent(roomId)}/expenses/${encodeURIComponent(eid)}/receipt`);
    $('#photo-img').src = `data:${mimeType};base64,${data}`;
    const modal = $('#photo-modal');
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('shown'));
    modal.querySelector('button').focus({ preventScroll: true });
  } catch (e) {
    state.formError = e.message;
    renderSheet();
  }
}
function closePhoto() {
  const modal = $('#photo-modal');
  if (modal.hidden) return;
  modal.classList.remove('shown');
  setTimeout(() => { modal.hidden = true; $('#photo-img').removeAttribute('src'); }, 200);
}

const lineSum = (items) => items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unit) || 0), 0);

async function act(name, d) {
  if (AGENT_ACTIONS.has(name)) return agentAct(name, d); // 송금 링크는 이 호출 안에서 동기적으로 연다
  if (name === 'show-receipt') {
    showReceipt(d.id);
  } else if (name === 'close-photo') {
    closePhoto();
  } else if (name === 'delete-exp') {
    // 되돌릴 수 없는 동작이라 한 번 더 눌러야 지운다(3초 안에)
    if (state.armedDelete !== d.id) {
      state.armedDelete = d.id;
      renderSheet();
      setTimeout(() => { if (state.armedDelete === d.id) { state.armedDelete = null; renderSheet(); } }, 3000);
      return;
    }
    state.armedDelete = null;
    try {
      await api(`/api/rooms/${encodeURIComponent(roomId)}/expenses/${encodeURIComponent(d.id)}/delete`, { method: 'POST', body: {} });
      sheet.close();
    } catch (e) {
      state.formError = e.message;
      renderSheet();
    }
    await load();
  } else if (name === 'edit-exp') {
    const exp = state.data.expenses.find((e) => e.id === d.id);
    state.draft = {
      title: exp.title, amount: exp.amount != null ? String(exp.amount) : '', currency: exp.currency, payer: exp.payer,
      method: exp.method, present: [...exp.present], date: exp.date, time: exp.time, kind: exp.kind,
      items: exp.items ? structuredClone(exp.items) : undefined,
    };
    state.addMode = exp.items ? 'photo' : 'manual';
    state.editing = exp.id;
    state.readNotes = exp.alloc && exp.items ? ['줄이나 함께한 사람을 바꾸면 메뉴 배분을 다시 해야 해요'] : [];
    state.formError = '';
    state.sheet = 'add';
    renderSheet();
  } else if (name === 'add-expense') {
    state.editing = null;
    state.lastImage = null;
    state.draft = newDraft();
    state.addMode = d.mode === 'photo' ? 'photo' : 'manual';
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
    const add = `<button class="btn" data-action="add-expense">지출 남기기</button>${state.aiReady ? '<button class="btn secondary" data-action="add-expense" data-mode="photo">영수증 사진으로</button>' : ''}`;
    // 아직 메뉴별로 나누지 않은 영수증이 있으면 그걸 먼저 권한다. 합계만 알아 1/N로 나누기로 한 지출(split: 'equal')은 빼고
    const unsplit = state.data.expenses.find((e) => e.split === 'items' && e.items?.length && !e.alloc);
    if (unsplit) {
      return `<section class="next"><p class="eyebrow">다음에 할 일</p><h2>${esc(topic(`‘${unsplit.title}’`))} 아직 메뉴별로 나누지 않았어요</h2>
        <p>각자의 비서가 공유한 기억으로 줄마다 누구 몫인지 정해요. 근거가 없는 줄만 사람에게 물어봐요.</p>
        <div class="actions"><button class="btn" data-action="open-exp" data-id="${esc(unsplit.id)}">나누러 가기</button>${add.replace('class="btn"', 'class="btn plain"')}</div></section>`;
    }
    const settling = settlingCard(add.replace(/class="btn( secondary)?"/g, 'class="btn plain"'));
    if (settling) return settling;
    return `<section class="next"><p class="eyebrow">${esc(state.data.me.name)}의 할 일</p><h2>지금은 할 일이 없어요</h2>
      <p>함께 쓴 돈이 있으면 남겨 주세요. 확인이 필요한 일이 생기면 비서가 여기에 올려요.</p>
      <div class="actions">${add}</div></section>`;
  }
  const first = mine[0];
  return `<section class="next warn"><p class="eyebrow">${esc(state.data.me.name)}의 할 일 ${mine.length}개</p><h2>${esc(first.text)}</h2>
    <p>${esc(actionNote(first))}</p><div class="actions">${actionButtons(first)}</div></section>`;
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
  const label = (t) => ({ preview: '청구서 보내기 전', scheduled: new Date(t.remindAt) > Date.now() ? `${whenText(t.remindAt)} 예약` : '곧 알려 드려요', due: '보낼 때가 됐어요', opened: '송금 앱 열림', sent: '보냈어요', confirmed: '받았어요' })[t.status] ?? t.status;
  const me = currentUid();
  const rows = list.map((t) => {
    const mine = t.id && (t.from === me || t.to === me);
    const tag = mine ? `button type="button" class="row" data-action="open-transfer" data-id="${esc(t.id)}"` : 'div class="row"';
    return `<${tag} style="--inset:76px">
      <span style="display:flex;gap:2px">${avatar(t.from)}${avatar(t.to)}</span>
      <span class="grow"><span class="title">${esc(nameOf(t.from))} → ${esc(nameOf(t.to))}</span>
        <span style="display:block;margin-top:3px">${chip(label(t), t.status === 'confirmed' ? 'ok' : t.status === 'due' ? 'warn' : '')}</span></span>
      <span class="end"><span class="amount num">${won(t.amount)}</span>${mine ? CHEVRON : ''}</span></${mine ? 'button' : 'div'}>`;
  }).join('');
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
  const tabs = state.editing ? '' : `<div style="margin-bottom:16px">${seg('add-mode', 'mode', [['manual', '직접 입력'], ['photo', '영수증 사진']], state.addMode).replaceAll('data-action="draft-set"', 'data-action="add-mode"')}</div>`;
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
    <button class="btn" style="width:100%" data-action="save-expense" ${state.saving ? 'disabled' : ''}>${state.saving ? '저장하는 중…' : state.editing ? '고친 내용 저장' : '지출 남기기'}</button>`;
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
    <p class="group-note">줄마다 어떻게 나눌지는 저장한 뒤 '비서에게 나누기'로 정해요.</p></section>`;
}

function renderSheet() {
  if (!state.sheet || !state.data) return;
  const body = $('#sheet-body');
  const top = body.scrollTop;
  if (AGENT_SHEETS[state.sheet]) {
    const { title, html } = AGENT_SHEETS[state.sheet]();
    $('#sheet-title').textContent = title;
    body.innerHTML = html;
    body.scrollTop = top;
    mountSliders(body, { onCommitGesture: (d) => sendGesture(d.id) });
    return;
  }
  const exp = state.sheet === 'exp' ? state.data.expenses.find((e) => e.id === state.expId) : null;
  $('#sheet-title').textContent = exp ? exp.title : state.editing ? '지출 고치기' : '지출 남기기';
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
  logPop.update(state.events);
}


// ---------------------------------------------------------------- 비서끼리 처리(#9): 청구서·이의·중재·송금
const enc = encodeURIComponent;
const byId = (col, id) => state.data?.[col]?.find((x) => x.id === id);
const whenText = (iso) => `${dayLabel(new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10))} 09:00`;

// 할 일마다 누를 버튼. 다음 할 일 카드와 좁은 화면의 기록 패널이 함께 쓴다
function actionButtons(a, size = '') {
  const cls = `btn ${size}`.trim();
  const id = esc(a.ref);
  switch (a.type) {
    case 'confirm_line':
      return `<button class="${cls}" data-action="open-exp" data-id="${esc(a.expenseId)}">확인하기</button>`;
    case 'answer_invoice':
      return `<button class="${cls}" data-action="open-invoice" data-id="${id}">청구서 보기</button>`;
    case 'agree_dispute':
      return `<button class="${cls}" data-action="open-dispute" data-id="${id}">${byId('disputes', a.ref)?.status === 'proposed' ? '중재안 보기' : '이의 보기'}</button>`;
    case 'approve_transfer':
      return byId('transfers', a.ref)?.status === 'opened'
        ? `<button class="${cls}" data-action="mark-sent" data-id="${id}">보냈어요</button><button class="${cls} secondary" data-action="open-transfer" data-id="${id}">다시 보내기</button>`
        : `<button class="${cls}" data-action="open-transfer" data-id="${id}">보내러 가기</button>`;
    case 'set_payout':
      return `<button class="${cls}" data-action="open-payout">받을 계좌 알려 주기</button>`;
    case 'confirm_receipt':
      return `<button class="${cls}" data-action="confirm-receipt" data-id="${id}">받았어요</button>`;
    default:
      return '';
  }
}

function actionNote(a) {
  const opened = byId('transfers', a.ref)?.status === 'opened';
  return {
    confirm_line: '비서들의 기억에 근거가 없는 줄이에요. 그래서 비서가 짐작으로 청구하지 않고 먼저 물어봐요.',
    answer_invoice: '자동 수락 한도를 넘어서 비서가 대신 받지 않고 먼저 물어봐요.',
    agree_dispute: byId('disputes', a.ref)?.status === 'proposed'
      ? '양쪽이 동의하면 그 지출을 중재안대로 다시 나누고 청구서를 다시 보내요.'
      : '중재 비서가 양쪽 근거와 영수증의 주문 시각을 보고 나누는 법을 제안해요.',
    approve_transfer: opened ? '송금 앱에서 보냈다면 알려 주세요. 받는 사람에게 확인을 부탁할게요.' : '밀어서 보내면 토스 송금 화면이 받는 사람·금액이 채워진 채로 열려요.',
    set_payout: '계좌번호는 나에게 돈을 보낼 사람에게만 보여요.',
    confirm_receipt: '받았다면 확인해 주세요. 그래야 이 송금이 끝나요.',
  }[a.type] ?? '';
}

// 할 일이 없을 때: 청구서를 아직 안 보냈으면 보내기를, 보냈으면 진행 상황을 보여 준다
function settlingCard(addButtons) {
  const { room, expenses, invoices = [], transfers = [] } = state.data;
  if (state.busy === 'send') {
    return `<section class="next" aria-busy="true"><p class="eyebrow">비서가 일하는 중</p><h2>비서들이 청구서를 확인하는 중이에요</h2>
      <p>각자 맡긴 규칙(자동 수락 한도, 보낼 시기, 이의 제기)대로 처리해요. 이의가 있으면 중재까지 이어져요.</p><div class="progress"><i></i></div></section>`;
  }
  const current = invoices.filter((i) => i.version === room.version);
  if (!current.length) {
    if (!expenses.length) return '';
    return `<section class="next"><p class="eyebrow">다음에 할 일</p><h2>이대로 청구서를 보낼까요?</h2>
      <p>보내면 각자의 비서가 자기 규칙대로 확인해요. 단톡방에는 아무것도 올라가지 않아요.${invoices.length ? ' 지출이 바뀌어서 다시 보내야 해요.' : ''}</p>
      ${state.formError && !state.sheet ? `<p class="form-error" role="alert">${esc(state.formError)}</p>` : ''}
      <div class="actions"><button class="btn" data-action="send-invoices">비서들에게 청구서 보내기</button>${addButtons}</div></section>`;
  }
  const live = transfers.filter((t) => t.version === room.version);
  const done = live.length ? live.every((t) => t.status === 'confirmed') : current.every((i) => i.status === 'accepted');
  if (done) {
    return `<section class="next done"><p class="eyebrow">정산 완료</p><h2>정산이 끝났어요</h2>
      <p>아무도 단톡방에서 돈 얘기를 꺼내지 않았어요. 남은 건 비서끼리 주고받은 기록뿐이에요.</p><div class="actions">${addButtons}</div></section>`;
  }
  return `<section class="next"><p class="eyebrow">기다리는 중</p><h2>다른 사람의 확인을 기다리고 있어요</h2>
    <p>누가 무엇을 하고 있는지는 아래 '누가 누구에게'와 비서끼리 기록에서 볼 수 있어요. 내 차례가 되면 여기에 올려요.</p><div class="actions">${addButtons}</div></section>`;
}

const formError = () => (state.formError ? `<p class="form-error" role="alert">${esc(state.formError)}</p>` : '');
const notFound = (title) => ({ title, html: '<p class="empty">찾을 수 없어요. 지출이 바뀌어 대체됐을 수 있어요.</p>' });

// 한도를 넘어 비서가 물은 청구서: 이대로 받거나, 지출 하나를 골라 이의를 낸다
function invoiceSheet() {
  const inv = byId('invoices', state.ref);
  if (!inv) return notFound('청구서');
  const dd = state.disputeDraft;
  const answering = inv.status === 'asked' && inv.to === state.data.me.uid;
  const choices = state.data.expenses.filter((e) => e.present.includes(inv.to));
  const form = dd ? `<section class="group"><h3 class="group-label"><span>어느 지출이 맞지 않나요?</span></h3>
      <div class="list">${choices.map((e) => `<button type="button" class="row" data-action="dispute-pick" data-id="${esc(e.id)}" aria-pressed="${dd.expenseId === e.id}">
        ${tile(e.kind)}<span class="grow"><span class="title">${esc(e.title)}</span><span class="meta" style="display:block">${esc(nameOf(e.payer))} · ${money(amountOf(e), e.currency)}</span></span>
        ${dd.expenseId === e.id ? chip('고름', 'ok') : ''}</button>`).join('')}</div></section>
    <section class="group"><div class="list"><label class="row field"><span class="grow">맞지 않는 점</span>
      <input data-dd="claim" value="${esc(dd.claim)}" maxlength="200" placeholder="예: 리무진은 타지 않았어요"></label></div></section>
    ${formError()}
    <button class="btn" style="width:100%" id="dispute-send" data-action="answer-invoice" data-decision="dispute" ${dd.expenseId && dd.claim.trim() ? '' : 'disabled'}>이의 보내기</button>` : '';
  return {
    title: '청구서',
    html: `<div class="big"><div class="amt">${won(Math.max(0, -inv.net))}</div>
        <p class="sub">낸 돈 ${won(inv.paid)} · 내 몫 ${won(inv.owed)} · 방 version ${inv.version}</p></div>
      <p class="how">${esc(inv.reasons.join(' · '))}</p>
      ${answering && !dd ? `${formError()}<div style="display:grid;gap:8px"><button class="btn" data-action="answer-invoice" data-decision="accept">이대로 받기</button>
        <button class="btn secondary" data-action="start-dispute">맞지 않는 지출이 있어요</button></div>` : ''}
      ${answering ? form : `<p class="group-note">${inv.status === 'accepted' ? '받기로 했어요.' : inv.status === 'disputed' ? '이의를 제기했어요.' : '지출이 바뀌어 대체된 청구서예요.'}</p>`}`,
  };
}

// 이의와 중재안. 중재안은 줄마다 누구 몫인지와 사람별 몫이 어떻게 바뀌는지 보여 준다
function disputeSheet() {
  const d = byId('disputes', state.ref);
  const exp = d && byId('expenses', d.expenseId);
  if (!exp) return notFound('이의');
  const { room, me } = state.data;
  const party = [exp.payer, d.by].includes(me.uid);
  const evidence = d.evidence.length
    ? `<div class="list">${d.evidence.map((e) => `<div class="row"><span class="grow">${esc(e.summary)}</span>${e.time ? chip(e.time) : ''}</div>`).join('')}</div>` : '';
  let body = '';
  if (d.status === 'open') {
    body = party
      ? `${formError()}<button class="btn" style="width:100%" data-action="mediate" data-id="${esc(d.id)}" ${state.busy === 'mediate' ? 'disabled' : ''}>${state.busy === 'mediate' ? '중재 비서가 보는 중…' : '중재 비서에게 맡기기'}</button>`
      : '<p class="group-note">당사자가 중재를 맡기면 중재안이 여기에 올라와요.</p>';
  } else if (d.proposal) {
    const now = shares(exp, room, room.policy).krwShare;
    const after = shares({ ...exp, split: 'items' }, room, room.policy, d.proposal.alloc).krwShare;
    const lines = (exp.items ?? []).map((it) => `<div class="row"><span class="grow"><span class="title">${esc(it.name)} ×${it.qty}</span>
        <span class="meta" style="display:block">${esc(it.time || '')} · ${(d.proposal.alloc[it.id]?.consumers ?? []).map(nameOf).map(esc).join('·')}</span></span></div>`).join('');
    const people = exp.present.map((u) => `<div class="row" style="--inset:52px">${avatar(u)}<span class="grow">${esc(nameOf(u))}</span>
        <span class="amount num">${won(now[u] ?? 0)} → ${won(after[u] ?? 0)}</span></div>`).join('');
    const waiting = [exp.payer, d.by].filter((u) => !d.agreedBy.includes(u));
    body = `<section class="group"><h3 class="group-label"><span>중재안</span><span>${esc(allocLabel({ source: d.proposal.source }))}</span></h3>
        <p class="how">${esc(d.proposal.summary)}</p><div class="list">${lines}</div></section>
      <section class="group"><h3 class="group-label"><span>사람별 몫</span><span>지금 → 중재안</span></h3><div class="list">${people}</div></section>
      ${formError()}
      ${d.status === 'resolved' ? '<p class="group-note">양쪽이 동의해서 이 지출을 다시 나눴어요.</p>'
        : party && !d.agreedBy.includes(me.uid) ? `<button class="btn" style="width:100%" data-action="agree" data-id="${esc(d.id)}">중재안에 동의</button>`
        : `<p class="group-note">${waiting.map(nameOf).map(esc).join('·')}의 동의를 기다려요.</p>`}`;
  }
  return {
    title: `‘${exp.title}’ 이의`,
    html: `<p class="how"><b>${esc(nameOf(d.by))}의 비서</b> · ${esc(d.claim)}</p>
      ${evidence ? `<section class="group"><h3 class="group-label"><span>근거</span></h3>${evidence}</section>` : ''}${body}`,
  };
}

const copyRow = (label, value, key) => `<div class="row"><span class="grow"><span class="meta" style="display:block">${label}</span>
    <span class="title num" style="user-select:all">${esc(value)}</span></span>
    <button type="button" class="btn sm secondary" data-action="copy" data-text="${esc(value)}" data-key="${key}">${state.copied === key ? '복사했어요' : '복사'}</button></div>`;

// 데스크톱 QR(#8). 토큰은 수명이 15분이라, 송금 화면을 열 때마다 서버에서 새로 받는다.
// QR에는 계좌·금액이 든 t.link를 바로 담지 않는다. 우리 서버의 짧은 수명 토큰(/api/qr/:token)을 담아,
// QR 이미지를 만들어 주는 외부 서비스는 그 토큰만 보고 실제 계좌 정보는 보지 못하게 한다.
const isDesktop = () => matchMedia('(min-width: 640px)').matches; // style.css의 .qr-desktop 기준과 같게
let qrTimer = 0;
let qrAsked = { id: null, at: 0 };

async function refreshQr(tid) {
  // 서버가 실패하거나 컴퓨터 시계가 어긋나 늘 '만료'로 보여도 계속 부르지 않게, 같은 송금은 30초에 한 번만 요청한다
  if (qrAsked.id === tid && Date.now() - qrAsked.at < 30_000) return;
  qrAsked = { id: tid, at: Date.now() };
  const stillOpen = () => state.sheet === 'transfer' && state.ref === tid; // 응답을 기다리는 사이 닫았거나 다른 송금으로 바꿨으면 버린다
  try {
    const { qrToken, expiresAt } = await api(`/api/rooms/${enc(roomId)}/transfers/${enc(tid)}/qr`, { method: 'POST', body: {} });
    if (!stillOpen()) return;
    state.qr = { id: tid, token: qrToken, expiresAt };
    // 화면을 오래 열어 두면 만료 1분 전에 다시 그린다. 그때 qrIsFresh가 false라 새 토큰을 받는다
    clearTimeout(qrTimer);
    qrTimer = setTimeout(() => {
      if (stillOpen()) renderSheet();
    }, Math.max(30_000, Date.parse(expiresAt) - 60_000 - Date.now()));
  } catch {
    if (!stillOpen()) return;
    state.qr = { id: tid, token: null, failed: true };
  }
  renderSheet();
}

function qrBlock(t) {
  if (!t.link || !isDesktop()) return '';
  if (!qrIsFresh(state.qr, t.id)) refreshQr(t.id);
  const qr = state.qr?.id === t.id ? state.qr : null;
  // 휴대폰 카메라가 찍을 절대 주소가 필요해서, API_BASE가 비어 있으면(로컬 개발) 지금 페이지 origin을 쓴다
  const img = qr?.token
    ? `<img src="${qrImageUrl(`${API_BASE || location.origin}/api/qr/${enc(qr.token)}`)}" width="220" height="220" alt="휴대폰으로 토스 송금 화면을 여는 QR 코드" referrerpolicy="no-referrer">`
    : `<div class="qr-wait">${qr?.failed ? 'QR을 만들지 못했어요.<br>위 계좌번호를 복사해 보내 주세요.' : 'QR을 만드는 중이에요'}</div>`;
  // 휴대폰으로 보내고 돌아온 사람이 슬라이더(데스크톱에선 토스가 안 열림)를 거치지 않고 바로 끝낼 수 있게
  return `<div class="qr-desktop"><p class="group-note">컴퓨터라면 휴대폰으로 QR을 찍어 토스를 열어요.</p>${img}
    <button class="btn secondary" style="width:100%;margin-top:12px" data-action="mark-sent" data-id="${esc(t.id)}">휴대폰으로 보냈어요</button></div>`;
}

// 송금: 밀어서 보내면 그 제스처 안에서 토스를 연다. 앱이 안 열리면 계좌·금액을 복사해 둔다
function transferSheet() {
  const t = byId('transfers', state.ref);
  if (!t) return notFound('송금');
  const me = state.data.me.uid;
  const toName = nameOf(t.to);
  const account = t.fallback ? `<section class="group"><h3 class="group-label"><span>${esc(toName)}의 계좌</span><span>${esc(t.fallback.bank)}</span></h3>
      <div class="list">${copyRow('계좌번호', t.fallback.accountNo, 'acct')}${copyRow('금액', String(t.amount), 'amt')}</div></section>` : '';
  const note = {
    fallback: '송금 앱이 열리지 않았어요. 계좌번호를 복사해 두었으니 쓰시는 은행 앱에 붙여 넣어 보내 주세요.',
    back: '송금 앱에서 돌아왔어요. 보냈나요?',
  }[state.transferNote];
  let actions = '';
  if (t.from === me && ['scheduled', 'due'].includes(t.status)) {
    actions = t.link || t.fallback
      ? `<div class="slider" data-commit="send" data-id="${esc(t.id)}"><span class="slider-fill"></span>
          <span class="slider-label">${t.link ? '밀어서 토스로 보내기' : '밀어서 계좌 복사하기'}</span>
          <button type="button" class="slider-thumb" aria-label="${t.link ? '밀어서 토스로 보내기' : '밀어서 계좌 복사하기'}. Enter 키로도 할 수 있어요">${ARROW}</button></div>
        <p class="slider-hint">${t.link ? '토스가 열리지 않으면 계좌번호를 복사해 드려요' : '받는 사람의 계좌를 복사해 드려요'}</p>
        ${qrBlock(t)}`
      : `<p class="group-note">${esc(subj(toName))} 받을 계좌를 아직 알려 주지 않았어요. 알려 주면 바로 보낼 수 있어요.</p>`;
  } else if (t.from === me && t.status === 'opened') {
    actions = `<h3 style="margin:0 0 10px">보냈나요?</h3><div style="display:grid;gap:8px">
      <button class="btn" data-action="mark-sent" data-id="${esc(t.id)}">보냈어요</button>
      ${t.link ? `<button class="btn secondary" data-action="reopen-link" data-id="${esc(t.id)}">토스 다시 열기</button>` : ''}
      <button class="btn plain" data-action="close-sheet">아직이에요</button></div>`;
  } else if (t.to === me && t.status === 'sent') {
    actions = `<button class="btn" style="width:100%" data-action="confirm-receipt" data-id="${esc(t.id)}">받았어요</button>`;
  } else {
    actions = `<p class="group-note">${{ scheduled: `${whenText(t.remindAt)}에 ${esc(nameOf(t.from))}에게 알려요.`, due: `${esc(subj(nameOf(t.from)))} 보낼 차례예요.`, opened: `${esc(subj(nameOf(t.from)))} 송금 앱을 열었어요.`, sent: `${esc(subj(nameOf(t.from)))} 보냈어요. 받는 사람의 확인을 기다려요.`, confirmed: '받았다고 확인했어요. 이 송금은 끝났어요.', superseded: '지출이 바뀌어 대체된 송금이에요.' }[t.status] ?? ''}</p>`;
  }
  return {
    title: '송금',
    html: `<div class="big"><div class="amt">${won(t.amount)}</div><p class="sub">${esc(nameOf(t.from))} → ${esc(toName)}${t.status === 'scheduled' && new Date(t.remindAt) > Date.now() ? ` · ${whenText(t.remindAt)} 예약` : ''}</p></div>
      ${note ? `<p class="preview-note" style="margin-bottom:14px">${esc(note)}</p>` : ''}
      ${account}${formError()}${actions}`,
  };
}

function payoutSheet() {
  const p = state.payoutDraft;
  // 은행은 목록에서 고른다(#8). 토스는 모르는 은행 이름이면 에러를 내서, 실기기로 확인한 은행만 목록에 둔다(public/banks.js).
  // 목록에 없는 은행만 직접 쓴다
  const options = BANKS.map((b) => `<option value="${esc(b.label)}"${!p.other && p.bank === b.label ? ' selected' : ''}>${esc(b.label)}</option>`).join('');
  return {
    title: '받을 계좌',
    html: `<p class="how">계좌번호는 나에게 돈을 보낼 사람에게만 보여요. 받을 송금이 있으면 바로 토스 링크가 채워져요.</p>
      <section class="group"><div class="list">
        <label class="row field"><span class="grow">은행</span><select data-bank-pick>${options}<option value=""${p.other ? ' selected' : ''}>목록에 없어요</option></select></label>
        ${p.other ? `<label class="row field"><span class="grow">은행 이름</span><input data-pf="bank" value="${esc(p.bank)}" maxlength="30" placeholder="예: 경남은행"></label>` : ''}
        <label class="row field"><span class="grow">계좌번호</span><input data-pf="accountNo" value="${esc(p.accountNo)}" inputmode="numeric" maxlength="30" placeholder="숫자만 또는 - 포함"></label>
        <label class="row field"><span class="grow">예금주</span><input data-pf="holder" value="${esc(p.holder)}" maxlength="30"></label>
      </div></section>
      ${p.other ? '<p class="group-note">목록에 없는 은행은 토스가 알아보지 못할 수 있어요. 그때는 보내는 사람에게 계좌번호를 복사해 보내도록 안내해요.</p>' : ''}${formError()}
      <button class="btn" style="width:100%" data-action="save-payout">저장</button>`,
  };
}

const AGENT_SHEETS = { invoice: invoiceSheet, dispute: disputeSheet, transfer: transferSheet, payout: payoutSheet };

function openAgentSheet(kind, ref = null) {
  state.sheet = kind;
  state.ref = ref;
  state.formError = '';
  if (sheet.visible) renderSheet();
  else sheet.open(renderSheet);
}

function copyText(text, key) {
  const done = (ok) => {
    state.copied = ok ? key : null;
    if (!ok) state.formError = '복사하지 못했어요. 숫자를 길게 눌러 복사해 주세요.';
    renderSheet();
    if (ok) setTimeout(() => { if (state.copied === key) { state.copied = null; renderSheet(); } }, 1500);
  };
  if (!navigator.clipboard) return done(false);
  navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
}

// 밀어서 보내기를 놓는 그 순간(사용자 제스처 안)에 부른다. 서버를 기다리지 않고 바로 송금 앱을 연다
function sendGesture(tid) {
  const t = byId('transfers', tid);
  if (!t) return;
  if (t.fallback) navigator.clipboard?.writeText(t.fallback.accountNo).catch(() => {});
  api(`/api/rooms/${enc(roomId)}/transfers/${enc(tid)}/approve`, { method: 'POST', body: {}, keepalive: true }).catch(() => {});
  state.pendingSend = { id: tid, left: false };
  if (t.link) location.href = t.link;
  // 1.5초 안에 페이지가 숨지 않으면 앱이 열리지 않은 것(앱 없음·데스크톱)으로 보고 복사 안내를 띄운다
  setTimeout(() => {
    if (state.pendingSend?.id !== tid || state.pendingSend.left) return;
    state.pendingSend = null;
    state.transferNote = 'fallback';
    openAgentSheet('transfer', tid);
    load();
  }, 1500);
}
document.addEventListener('visibilitychange', () => {
  if (!state.pendingSend) return;
  if (document.hidden) {
    state.pendingSend.left = true;
  } else if (state.pendingSend.left) {
    const id = state.pendingSend.id;
    state.pendingSend = null;
    state.transferNote = 'back';
    openAgentSheet('transfer', id);
    load();
  }
});

const AGENT_ACTIONS = new Set(['send-invoices', 'open-invoice', 'start-dispute', 'dispute-pick', 'answer-invoice', 'open-dispute', 'mediate', 'agree', 'open-transfer', 'reopen-link', 'mark-sent', 'confirm-receipt', 'open-payout', 'save-payout', 'copy']);

async function agentAct(name, d) {
  const base = `/api/rooms/${enc(roomId)}`;
  const post = async (path, body = {}) => {
    try {
      await api(base + path, { method: 'POST', body });
      state.formError = '';
      return true;
    } catch (e) {
      state.formError = e.message;
      return false;
    } finally {
      await load();
      if (state.sheet) renderSheet();
    }
  };
  if (name === 'reopen-link') {
    // 클릭 처리기 안에서 바로 연다(기다리면 브라우저가 막는다)
    const t = byId('transfers', d.id);
    if (t?.fallback) navigator.clipboard?.writeText(t.fallback.accountNo).catch(() => {});
    if (t?.link) location.href = t.link;
  } else if (name === 'send-invoices') {
    state.busy = 'send';
    state.formError = '';
    render();
    await post('/invoices/send');
    state.busy = null;
    render();
  } else if (name === 'open-invoice') {
    state.disputeDraft = null;
    openAgentSheet('invoice', d.id);
  } else if (name === 'start-dispute') {
    state.disputeDraft = { expenseId: null, claim: '' };
    renderSheet();
  } else if (name === 'dispute-pick') {
    state.disputeDraft.expenseId = d.id;
    renderSheet();
  } else if (name === 'answer-invoice') {
    const body = d.decision === 'dispute' ? { decision: 'dispute', ...state.disputeDraft } : { decision: 'accept' };
    if (await post(`/invoices/${enc(state.ref)}/answer`, body)) {
      state.disputeDraft = null;
      sheet.close();
    }
  } else if (name === 'open-dispute') {
    openAgentSheet('dispute', d.id);
  } else if (name === 'mediate') {
    state.busy = 'mediate';
    renderSheet();
    await post(`/disputes/${enc(d.id)}/mediate`);
    state.busy = null;
    renderSheet();
  } else if (name === 'agree') {
    await post(`/disputes/${enc(d.id)}/agree`);
  } else if (name === 'open-transfer') {
    state.transferNote = null;
    openAgentSheet('transfer', d.id);
  } else if (name === 'mark-sent') {
    state.transferNote = null;
    await post(`/transfers/${enc(d.id)}/sent`);
  } else if (name === 'confirm-receipt') {
    await post(`/transfers/${enc(d.id)}/confirm`);
  } else if (name === 'open-payout') {
    const mine = state.data.me;
    state.payoutDraft = { bank: BANKS[0].label, accountNo: '', holder: mine.name, other: false };
    openAgentSheet('payout');
  } else if (name === 'save-payout') {
    if (await post('/payout', state.payoutDraft)) sheet.close();
  } else if (name === 'copy') {
    copyText(d.text, d.key);
  }
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
  $('#nav-add').hidden = false;
  logPop.show(true);
  logPop.update(state.events); // 할 일이 바뀌었을 수 있다
  main.innerHTML = [hero(), whoPicker(), nextCard(), expensesSection(), transfersSection()].join('');
  mountSegs(main);
  if (['exp', 'dispute', 'transfer'].includes(state.sheet) || (state.sheet === 'invoice' && !state.disputeDraft)) renderSheet();
}

// ---------------------------------------------------------------- 이벤트
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  if (el.dataset.action === 'toggle-log') return logPop.toggle();
  if (el.dataset.action === 'close-log') return logPop.close();
  if (logPop.isOpen) logPop.close(false); // 기록 패널 안의 버튼(확인하기)은 패널을 닫고 진행한다
  act(el.dataset.action, el.dataset);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (logPop.isOpen) logPop.close();
    else if (!$('#photo-modal').hidden) closePhoto();
    else sheet.close();
  }
  else segArrowKeys(e, (btn) => act(btn.dataset.action, btn.dataset));
});
// 입력칸은 다시 그리지 않고 값만 기억한다(타이핑 중 초점을 잃지 않게)
document.addEventListener('input', (e) => {
  if (e.target.dataset?.dd && state.disputeDraft) {
    state.disputeDraft[e.target.dataset.dd] = e.target.value;
    const send = $('#dispute-send');
    if (send) send.disabled = !(state.disputeDraft.expenseId && state.disputeDraft.claim.trim());
  }
  if (e.target.dataset?.pf && state.payoutDraft) state.payoutDraft[e.target.dataset.pf] = e.target.value;
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
  // 받을 계좌의 은행 선택. '목록에 없어요'(빈 값)면 직접 쓰는 칸을 보여 주려고 다시 그린다
  if (e.target.matches?.('select[data-bank-pick]') && state.payoutDraft) {
    state.payoutDraft.other = !e.target.value;
    state.payoutDraft.bank = e.target.value;
    renderSheet();
  }
});
const sheet = createSheet($('#sheet-root'), {
  onClosed: () => {
    state.sheet = null;
    state.editing = null;
    state.ref = null;
    state.disputeDraft = null;
    state.transferNote = null;
    // QR 토큰은 버린다. 다시 열면 새로 받는다
    state.qr = null;
    clearTimeout(qrTimer);
    qrAsked = { id: null, at: 0 };
  },
});
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
    if (state.data) render(); // AI가 연결돼 있으면 '영수증 사진으로'를 보여 준다
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
