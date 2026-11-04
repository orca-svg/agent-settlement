// 실제 방 화면. 지금은 방 불러오기, (개발용) 신원 고르기, 지출, 누가 누구에게, 비서끼리 기록까지 보여 준다.
// 지출 추가(#6)와 비서 처리(#9) 화면은 이 파일에 이어 붙인다.
import { won, money, dayLabel, amountOf, toKrw, shares, settle } from './core.js';
import { esc, chip, avatarHtml, tile, CHEVRON, CHECK, CROSS, ICON_DONE, logItemHtml, minuteLabels, createSheet, mountSegs, resetSegs, mountSliders, segArrowKeys, topic, subj, restNote, allocLabel, allocButton, ARROW, ALERT, qrImageUrl, qrIsFresh, receiptPickers, sendMode, sendFollowUp, flaggedLines, blockedNotice, askedBy, nudge, COMPUTER_QUERY, disputeWaiting, disputeChoices, disputeNote, disputeRejected, disputeLive, disputeStatus } from './ui.js';
import { reduceMotion } from './motion.js';
import { api, subscribeRoom, currentUid, setCurrentUid } from './room-api.js';
import { createLogPop } from './log-pop.js';
import { API_BASE } from './api.js';
import { initAuth, authOptions, onSessionChange, login } from './auth.js';
import { createAgentPanel, personChipHtml } from './agent-panel.js';
import { notifies } from './agent-rules.js';
import { readVisits, expenseWindow, keepForSettlement, findMismatches } from './timeline.js';
import { guessOs, guideHtml } from './timeline-guide.js';
import { createRoomHtml, joinHtml, setupHtml, notAgreed, inviteUrl, datesLabel, inviteSheetHtml, inviteButtonHtml } from './room-setup.js';
import { pickDay, presetRange, nextFocus, shiftMonth, todayIso } from './date-range.js';
import { payoutFieldsHtml, payoutDraftFrom } from './payout-form.js';

const $ = (s, el = document) => el.querySelector(s);
const roomId = new URLSearchParams(location.search).get('room');
const inviteToken = roomId ? null : new URLSearchParams(location.search).get('invite');
// #4 방 만들기·참가하기·정책 동의·초대 링크 화면 상태. 방에 보일 이름·색은 입력받지 않고 내 프로필(profile)을 쓴다
const setup = { create: { name: '', start: '', end: '', policy: 'actual' }, picker: { open: false, month: '', focus: '', entering: false }, join: {}, invitePreview: {}, invite: undefined, profile: null, policyEdit: false, copied: false, busy: false, error: '' };
// 로그인이 없는 개발용 서버에서만: 처음 방을 만들거나 참가할 때 이 브라우저용 uid를 하나 만든다. 배포에서는 Google 로그인 신원을 쓴다
const ensureUid = () => currentUid() || (authOptions().dev ? (setCurrentUid(`u-${crypto.randomUUID().slice(0, 8)}`), currentUid()) : null);
const state = { data: null, events: [], error: null, renderedLog: 0, sheet: null, draft: null, formError: '', saving: false, addMode: 'manual', reading: null, readNotes: [], aiReady: false, editing: null, lastImage: null, armedDelete: null, expId: null, edits: {}, allocating: null, allocSource: {}, ref: null, busy: null, disputeDraft: null, payoutDraft: null, transferNote: null, pendingSend: null, copied: null, qr: null, disputeDone: null, rejectDraft: null, sendBlocked: false, announceBlocked: false, focusLine: null };
let unsubscribe = () => {};

const members = () => state.data?.room.members ?? [];
const nameOf = (uid) => ({ system: '정산방', mediator: '중재 비서', all: '모두' })[uid] ?? members().find((m) => m.uid === uid)?.name ?? uid;
const agentName = (uid) => (uid === 'system' || uid === 'mediator' ? nameOf(uid) : `${nameOf(uid)}의 비서`);
const colorOf = (uid) => {
  const profileColor = members().find(m => m.uid === uid)?.color;
  if (/^#[0-9a-f]{6}$/i.test(profileColor)) return profileColor;
  const i = members().findIndex((m) => m.uid === uid);
  return i < 0 ? '#8e8e93' : `var(--p${i % 4})`;
};
const avatar = (uid, cls = '') => avatarHtml(nameOf(uid)[0], colorOf(uid), cls);
// 기록 시각은 분까지만(로그가 아니라 대화)
const timeOf = (iso) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

// 좁은 화면에서 상단바 종으로 여는 비서끼리 기록. 마지막으로 본 기록은 방·사람마다 기억한다
const seenKey = () => `agent-settlement.seen.${roomId}.${currentUid()}`;
const logPop = createLogPop({
  itemHtml: (e, opts) => logItemHtml({
    avatar: avatar(e.from, 'agent'),
    who: agentName(e.from),
    to: nameOf(e.to),
    time: timeOf(e.at),
    text: e.text,
    meta: e.meta,
    tagHtml: e.action ? chip(`${nameOf(e.action.for)}의 확인 필요`, 'warn') : '',
    ...opts,
  }),
  timeOf: (e) => timeOf(e.at),
  counts: (e) => notifies(e, currentUid(), state.data?.myAgent?.notify),
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

// 우측 상단 내 프로필 메뉴(#5). 내 계정으로 가는 길이면서, 방 안에서는 '이 방의 내 비서'로 가는 길을 겸한다(주 입구는 방 머리의 내 칩)
const meMenu = {
  get isOpen() {
    return !$('#me-menu').hidden;
  },
  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  },
  open() {
    $('#me-menu').hidden = false;
    $('#nav-me').setAttribute('aria-expanded', 'true');
    $('#me-menu [role="menuitem"]:not([hidden])')?.focus();
  },
  close(focus = true) {
    $('#me-menu').hidden = true;
    $('#nav-me').setAttribute('aria-expanded', 'false');
    if (focus) $('#nav-me').focus();
  },
  // 방을 읽은 뒤 내 얼굴과 '이 방의 내 비서'를 채운다. 방 밖이거나 서버가 요약을 주지 않으면 내 계정만 남는다
  update() {
    const me = state.data?.me;
    $('#nav-me-avatar').innerHTML = me ? avatar(me.uid) : '';
    $('#me-menu-agent').hidden = !state.data?.myAgent;
  },
};

// ---------------------------------------------------------------- 데이터
async function load() {
  try {
    state.data = await api(`/api/rooms/${encodeURIComponent(roomId)}`);
    state.error = null;
    // 살아 있는 초대 링크는 처음 한 번만 물어본다(정산 중인 방은 초대를 막는다)
    if (setup.invite === undefined && state.data.room.status !== 'settling') {
      setup.invite = null;
      api(`/api/rooms/${encodeURIComponent(roomId)}/invite`).then(({ invite }) => { setup.invite = invite; render(); }, () => {});
    }
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
// 정산당 한 번 올린 타임라인(#7). 이 정산 지출 시간대의 방문 시각만 이 브라우저에 7일 두고 서버로는 보내지 않는다.
// 저장이 막힌 브라우저에서도 지금 화면에서는 쓰도록 메모리에도 둔다. 로그아웃하면 지운다(auth.js)
const TIMELINE_DAYS = 7;
const timelineKey = () => `agent-settlement.timeline.${roomId}.${state.data?.me.uid}`;
const visitsInMemory = {};
function savedVisits() {
  const key = timelineKey();
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (saved && Date.now() - saved.savedAt < TIMELINE_DAYS * 86400_000) return saved.visits;
    localStorage.removeItem(key);
  } catch {}
  return visitsInMemory[key] ?? null;
}
function saveVisits(visits) {
  visitsInMemory[timelineKey()] = visits;
  try {
    localStorage.setItem(timelineKey(), JSON.stringify({ savedAt: Date.now(), visits }));
  } catch {}
}
function forgetVisits() {
  delete visitsInMemory[timelineKey()];
  try {
    localStorage.removeItem(timelineKey());
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
  const uids = room.members.filter(m => !m.deleted).map((m) => m.uid);
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
    // 확인이 필요한 줄이 내 비서가 물은 게 아니면 누구의 비서가 물었는지 함께 보인다(청구서 보내기가 막혀 여기로 왔을 때 길을 잃지 않게)
    const owner = flag && exp.createdBy !== state.data.me.uid ? chip(askedBy(exp.createdBy, { me: state.data.me.uid, nameOf }), 'warn') : '';
    const confirmBtn = a && (flag || edited)
      ? `<div class="line-foot"><button class="btn sm ${flag ? 'secondary' : 'plain'}" data-action="confirm-line" data-exp="${esc(exp.id)}" data-line="${esc(it.id)}">${edited ? '이대로 확인' : '비서가 짐작한 대로 확인'}</button>${owner}</div>`
      : '';
    const focus = state.focusLine?.exp === exp.id && state.focusLine.line === it.id;
    return `<div class="line ${flag ? 'flag' : ''}${focus ? ' focus' : ''}" data-line-id="${esc(it.id)}"${focus ? ' aria-current="true"' : ''}>
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

// #4 방 만들기·참가하기·정책·초대. 복사·공유는 클릭 처리기 안에서 바로 불러야 브라우저가 허락한다
const SETUP_ACTIONS = new Set(['open-invite', 'range-toggle', 'range-day', 'range-month', 'range-preset', 'range-clear', 'cf-policy','sign-in', 'create-room', 'join-room', 'agree-policy', 'edit-policy', 'set-policy', 'make-invite', 'copy-invite', 'share-invite']);
// 기간 고르기(방 만들기 폼). 화면을 통째로 다시 그리므로, 방금 누른 자리로 초점을 돌려놓아 키보드로 이어 고를 수 있게 한다
function rangeAct(name, d) {
  const p = setup.picker;
  const c = setup.create;
  const today = todayIso();
  let back = '[data-action="range-toggle"]';
  if (name === 'range-toggle') {
    p.open = !p.open;
    p.entering = p.open; // 펼칠 때만 한 번 나타나는 움직임(날짜를 누를 때마다 다시 움직이지 않게)
    if (p.open) Object.assign(p, { month: (c.start || today).slice(0, 7), focus: c.start || today });
  }
  if (name === 'range-month') {
    p.month = shiftMonth(p.month, Number(d.step));
    back = `[data-action="range-month"][data-step="${d.step}"]`;
  }
  if (name === 'range-day') {
    Object.assign(c, pickDay(c, d.date));
    p.focus = d.date;
    back = `[data-date="${d.date}"]`;
  }
  if (name === 'range-preset') {
    Object.assign(c, presetRange(d.id, c, today));
    Object.assign(p, { month: c.start.slice(0, 7), focus: c.end });
    back = `[data-action="range-preset"][data-id="${d.id}"]`;
  }
  if (name === 'range-clear') Object.assign(c, { start: '', end: '' });
  render();
  p.entering = false;
  document.querySelector(back)?.focus({ preventScroll: true });
}
// 달력 안의 방향키: 초점만 옮기고(달이 바뀌면 그 달을 보여 준다) 고르기는 Enter·Space(버튼 누르기)로 한다
function rangeKeys(e) {
  const next = e.target.dataset?.date && nextFocus(e.target.dataset.date, e.key);
  if (!next) return false;
  e.preventDefault();
  Object.assign(setup.picker, { focus: next, month: next.slice(0, 7) });
  render();
  document.querySelector(`[data-date="${next}"]`)?.focus();
  return true;
}

async function setupAct(name, d) {
  const base = `/api/rooms/${encodeURIComponent(roomId)}`;
  if (name.startsWith('range-')) return rangeAct(name, d);
  if (name === 'cf-policy') {
    setup.create.policy = d.id;
    return render();
  }
  if (name === 'edit-policy') {
    setup.policyEdit = !setup.policyEdit;
    return render();
  }
  // 시트를 먼저 열고, 링크가 없으면 그때 만든다. 처음 불러오는 중에 눌러도 이미 보낸 링크를 새 링크로 덮지 않게 있는지부터 본다
  if (name === 'open-invite') {
    setup.copyError = '';
    openAgentSheet('invite');
    if (setup.invite) return undefined;
    try {
      const { invite } = await api(`${base}/invite`);
      setup.invite = invite ?? await api(`${base}/invite`, { method: 'POST', body: {} });
    } catch (e) {
      setup.copyError = e.message;
    }
    return renderSheet();
  }
  if (name === 'copy-invite') {
    const done = (ok) => {
      setup.copied = ok;
      setup.copyError = ok ? '' : '복사하지 못했어요. 링크를 눌러 통째로 고른 뒤 복사해 주세요.'; // 누른 링크 줄 바로 아래에 알린다
      render();
      if (ok) setTimeout(() => { setup.copied = false; render(); }, 1500);
    };
    if (!navigator.clipboard) return done(false);
    return navigator.clipboard.writeText(inviteUrl(setup.invite.token)).then(() => done(true), () => done(false));
  }
  if (name === 'share-invite') {
    const { room } = state.data;
    return navigator.share({ title: room.name, text: `‘${room.name}’ 정산 방에 초대해요`, url: inviteUrl(setup.invite.token) }).catch(() => {});
  }
  if (setup.busy) return;
  const need = (ok, msg) => {
    if (!ok) throw new Error(msg);
  };
  setup.busy = true;
  setup.error = '';
  render();
  try {
    // 방 만들기·초대 화면에서 바로 로그인한다(계정 화면으로 갔다 오면 초대 링크를 잃는다). 로그인하면 내 프로필로 다시 그린다
    if (name === 'sign-in') {
      await login();
      await loadProfile();
      if (inviteToken) setup.invitePreview = await api(`/api/invites/${encodeURIComponent(inviteToken)}`).catch((e) => ({ error: e.message }));
    }
    if (name === 'create-room') {
      const c = setup.create;
      need(c.name.trim(), '방 이름을 적어 주세요');
      need(!c.start || !c.end || c.end >= c.start, '끝나는 날이 시작하는 날보다 빨라요');
      ensureUid();
      const { room } = await api('/api/rooms', { method: 'POST', body: { name: c.name, dates: datesLabel(c.start, c.end), policy: c.policy } });
      location.search = `?room=${encodeURIComponent(room.id)}`;
      return;
    }
    if (name === 'join-room') {
      ensureUid(); // '동의하고 참가하기'를 누른 것이 곧 동의다
      const { roomId: id } = await api(`/api/invites/${encodeURIComponent(inviteToken)}/join`, { method: 'POST', body: { agree: true } });
      location.search = `?room=${encodeURIComponent(id)}`;
      return;
    }
    if (name === 'agree-policy') await api(`${base}/policy/agree`, { method: 'POST', body: {} });
    if (name === 'set-policy') {
      await api(`${base}/policy`, { method: 'POST', body: { policy: d.id } });
      setup.policyEdit = false;
    }
    if (name === 'make-invite') setup.invite = await api(`${base}/invite`, { method: 'POST', body: {} });
  } catch (e) {
    setup.error = e.message;
  } finally {
    setup.busy = false;
  }
  if (roomId) await load();
  else render();
}

// 방 만들기·참가 화면에 보일 내 프로필(이름·색). 아직 누구인지 모르면(로그인 전) null
async function loadProfile() {
  if (!currentUid()) return void (setup.profile = null);
  try {
    setup.profile = (await api('/api/me')).profile;
  } catch {
    setup.profile = null;
  }
}

async function loadInvite() {
  try {
    setup.invitePreview = await api(`/api/invites/${encodeURIComponent(inviteToken)}`);
  } catch (e) {
    setup.invitePreview = { error: e.message };
  }
  render();
}

async function act(name, d) {
  if (name !== 'agree' && name !== 'reject') state.disputeDone = null; // 동의·거부 결과 한 줄은 다음 조작 전까지만 남긴다
  if (SETUP_ACTIONS.has(name)) return setupAct(name, d);
  if (agentPanel.handles(name)) return agentPanel.act(name, d);
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
    // 막힌 줄에서 왔으면 그 줄로 스크롤해 강조한다(renderSheet). 그냥 지출을 연 것이면 처음부터 보인다
    state.focusLine = d.line ? { exp: d.id, line: d.line, pending: true } : null;
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
    if (state.focusLine?.exp === d.exp && state.focusLine.line === d.line) state.focusLine = null; // 확인했으니 강조는 거둔다
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
  return createRoomHtml(setup.create, { busy: setup.busy, error: setup.error, seedFailed: state.error?.status === 'seed', dev: authOptions().dev, profile: setup.profile, picker: setup.picker, today: todayIso() });
}

const isDemoRoom = () => String(roomId).startsWith('demo-');

function whoPicker() {
  if (!authOptions().dev || !isDemoRoom()) return ''; // 개발용 데모 방에서만 남의 신원으로 바꿔 본다
  const me = currentUid();
  return `<section class="group"><h2 class="group-label"><span>누구로 볼까요?</span><span>개발용 시드 신원</span></h2>
    <div class="seg" role="radiogroup" aria-label="보는 사람" data-seg="who"><span class="seg-thumb"></span>
      ${members().filter(m => !m.deleted).map((m) => `<button type="button" role="radio" aria-checked="${m.uid === me}" data-action="who" data-id="${esc(m.uid)}">${esc(m.name)}</button>`).join('')}
    </div></section>`;
}

function hero() {
  const { room, me } = state.data;
  // 내 칩은 '내 비서' 입구를 겸한다(#5). 다른 사람 칩은 이름표이고, 비서 설정을 마쳤는지만 로봇 표시로 보인다
  const ready = new Set(state.data.agentReady ?? []);
  const person = (m) => (m.uid === me.uid ? agentPanel.chipHtml(m, avatar(m.uid)) : personChipHtml({ name: m.name, avatar: avatar(m.uid), ready: ready.has(m.uid) }));
  return `<section class="hero"><h1>${esc(room.name)}</h1>
    <p class="sub">${esc(room.dates || '')}${room.dates ? ' · ' : ''}${room.members.length}명 · 돈 얘기는 각자의 비서끼리 해요</p>
    <div class="people">${room.members.map(person).join('')}${room.status === 'settling' ? '' : inviteButtonHtml()}</div></section>`;
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

// 이의 목록. 이의를 낸 사람처럼 '할 일'이 없는 당사자도 여기서 시트로 들어가 중재안을 보고 거부할 수 있다.
// 열린 이의를 먼저, 끝난 이의는 어떻게 끝났는지와 함께 남긴다(기각된 쪽이 결과를 다시 확인할 곳이기도 하다)
function disputesSection() {
  const { disputes = [], expenses } = state.data;
  const rows = disputes.map((d) => [d, expenses.find((e) => e.id === d.expenseId)]).filter(([, e]) => e)
    .sort(([a], [b]) => Number(disputeLive(b)) - Number(disputeLive(a)));
  if (!rows.length) return '';
  const live = rows.filter(([d]) => disputeLive(d)).length;
  const items = rows.map(([d, e]) => `<button class="row" data-action="open-dispute" data-id="${esc(d.id)}">
      ${tile(e.kind)}
      <span class="grow"><span class="title">${esc(e.title)}</span>
        <span class="meta" style="display:block">${esc(subj(nameOf(d.by)))} 낸 이의</span>
        <span class="meta" style="display:block;color:var(--label)">${esc(disputeStatus(d, e, nameOf))}</span>
        <span style="display:block;margin-top:4px">${disputeLive(d) ? chip('진행 중', 'warn') : chip('끝남')}</span></span>
      ${CHEVRON}
    </button>`).join('');
  return `<section class="group"><h2 class="group-label"><span>이의 ${rows.length}건</span><span>${live ? `${live}건 진행 중` : '모두 끝났어요'}</span></h2>
    <div class="list">${items}</div></section>`;
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
  const me = currentUid();
  const label = (t) => ({ preview: '청구서 보내기 전', scheduled: isManual(t) ? '편할 때 보내기' : new Date(t.remindAt) > Date.now() ? `${whenText(t.remindAt)} 예약` : '곧 알려 드려요', due: '보낼 때가 됐어요', opened: '송금 앱 열림', sent: !t.notReceivedAt ? '보냈어요' : t.to === me ? '확인을 부탁했어요' : '아직 못 받았대요', confirmed: '받았어요' })[t.status] ?? t.status;
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
  const room = { ...state.data.room, members: state.data.room.members.filter(m => !m.deleted) };
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
  // 터치가 주 입력인 기기(휴대폰·태블릿)면 찍기와 앨범에서 고르기를 따로 둔다(receiptPickers)
  const touch = matchMedia('(pointer: coarse)').matches;
  return `<section class="next" style="margin:0"><h2>${touch ? '영수증을 찍거나 골라 주세요' : '영수증 사진을 골라 주세요'}</h2>
    <p>AI가 읽은 내용은 저장 전에 직접 확인하고 고칠 수 있어요. 사진 원본은 저장하지 않아요.</p>
    <div class="actions">${receiptPickers(touch)}</div></section>`;
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
    mountSegs(body);
    mountSliders(body, { onCommitGesture: (d) => sendGesture(d.id) });
    return;
  }
  const exp = state.sheet === 'exp' ? state.data.expenses.find((e) => e.id === state.expId) : null;
  $('#sheet-title').textContent = exp ? exp.title : state.editing ? '지출 고치기' : '지출 남기기';
  body.innerHTML = exp ? expSheetHtml(exp) : addSheetHtml();
  body.scrollTop = top;
  mountSegs(body);
  if (exp && state.focusLine?.pending) revealLine(body);
}

// 막힌 줄이 시트 가운데에 오도록 스크롤하고, 강조 테두리가 안쪽으로 내려앉게 한다.
// 시트가 아직 올라오는 중에 미리 맞춰 두므로 그 위에 움직임을 더하지 않는다. 움직임 줄이기면 테두리만 남는다(.line.focus)
function revealLine(body) {
  const f = state.focusLine;
  f.pending = false; // 이벤트로 다시 그려도 스크롤을 되돌리지 않고 테두리만 남는다
  const el = body.querySelector(`.line[data-line-id="${CSS.escape(f.line)}"]`);
  if (!el) return;
  const at = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  body.scrollTop = Math.max(0, at - (body.clientHeight - el.offsetHeight) / 2);
  if (reduceMotion.matches) return;
  el.animate(
    [{ boxShadow: 'inset 0 0 0 8px color-mix(in srgb, var(--orange) 28%, transparent)' }, { boxShadow: 'inset 0 0 0 2px var(--orange)' }],
    { duration: 520, delay: 240, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', fill: 'backwards' },
  );
}

function renderChannel() {
  const times = minuteLabels(state.events.map((e) => timeOf(e.at)));
  const items = state.events.map((e, i) => logItemHtml({
    avatar: avatar(e.from, 'agent'),
    who: agentName(e.from),
    to: nameOf(e.to),
    time: times[i],
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
// 편할 때 보내기 송금. remindAt이 없는 예전 송금도 편할 때 보내기다(그때는 알리지 않았다)
const isManual = (t) => Boolean(t.manual) || !t.remindAt;

// 할 일마다 누를 버튼. 다음 할 일 카드와 좁은 화면의 기록 패널이 함께 쓴다
function actionButtons(a, size = '') {
  const cls = `btn ${size}`.trim();
  const id = esc(a.ref);
  switch (a.type) {
    case 'confirm_line':
      return `<button class="${cls}" data-action="open-exp" data-id="${esc(a.expenseId)}" data-line="${esc(a.itemId)}">확인하기</button>`;
    case 'answer_invoice':
      return `<button class="${cls}" data-action="open-invoice" data-id="${id}">청구서 보기</button>`;
    case 'agree_dispute':
      return `<button class="${cls}" data-action="open-dispute" data-id="${id}">${byId('disputes', a.ref)?.status === 'proposed' ? '중재안 보기' : '이의 보기'}</button>`;
    case 'approve_transfer':
      // opened(송금 앱을 열었다)와, 받는 사람이 안 들어왔다고 한 sent는 둘 다 보냈는지 묻는다
      return ['opened', 'sent'].includes(byId('transfers', a.ref)?.status)
        ? `<button class="${cls}" data-action="mark-sent" data-id="${id}">보냈어요</button><button class="${cls} secondary" data-action="open-transfer" data-id="${id}">다시 보내기</button>`
        : `<button class="${cls}" data-action="open-transfer" data-id="${id}">보내러 가기</button>`;
    case 'set_payout':
      return `<button class="${cls}" data-action="open-payout">받을 계좌 알려 주기</button>`;
    case 'confirm_receipt':
      // 이미 안 들어왔다고 했으면 보내는 사람의 답을 기다리는 중이라 받았어요만 둔다
      return `<button class="${cls}" data-action="confirm-receipt" data-id="${id}">받았어요</button>${byId('transfers', a.ref)?.notReceivedAt ? '' : `<button class="${cls} secondary" data-action="not-received" data-id="${id}">아직 안 들어왔어요</button>`}`;
    default:
      return '';
  }
}

// 일반 글자를 돌려준다(이름이 들어간다). HTML에 넣을 때는 쓰는 쪽에서 esc()로 감싼다(지금은 nextCard() 한 곳)
function actionNote(a) {
  const t = byId('transfers', a.ref);
  const opened = t?.status === 'opened';
  return {
    confirm_line: '비서들의 기억에 근거가 없는 줄이에요. 그래서 비서가 짐작으로 청구하지 않고 먼저 물어봐요.',
    answer_invoice: '자동 수락 한도를 넘어서 비서가 대신 받지 않고 먼저 물어봐요.',
    agree_dispute: byId('disputes', a.ref)?.status === 'proposed'
      ? '양쪽이 동의하면 그 지출을 중재안대로 다시 나누고 청구서를 다시 보내요. 거부하면 이의가 끝나고 지금 배분 그대로 정산해요.'
      : '중재 비서가 양쪽 근거와 영수증의 주문 시각을 보고 나누는 법을 제안해요.',
    approve_transfer: t?.notReceivedAt ? '토스 송금 내역을 먼저 확인해 주세요. 보냈다면 ‘보냈어요’를, 아니면 ‘다시 보내기’를 눌러요.'
      : !opened ? '밀어서 보내면 토스 송금 화면이 받는 사람·금액이 채워진 채로 열려요.'
      : '송금 앱에서 보냈다면 알려 주세요. 받는 사람에게 확인을 부탁할게요.',
    set_payout: '계좌번호는 나에게 돈을 보낼 사람에게만 보여요.',
    confirm_receipt: t?.notReceivedAt ? `${nameOf(t.from)}에게 송금 내역을 확인해 달라고 했어요. 그 사이 들어왔다면 알려 주세요.`
      : `통장에 들어왔는지 보고 알려 주세요. 안 들어왔으면 ${t ? nameOf(t.from) : '보낸 사람'}에게 다시 확인을 부탁할게요.`,
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
    // 정산 시작은 전원이 환율 정책에 동의해야 열린다(#4). 서버도 같은 조건으로 막는다
    const waiting = notAgreed(room);
    if (waiting.length) {
      return `<section class="next"><p class="eyebrow">정산 시작 전</p><h2>환율 정책에 ${waiting.length}명이 아직 동의하지 않았어요</h2>
        <p>${esc(waiting.map((m) => m.name).join(', '))}의 동의를 기다리고 있어요. 모두 동의하면 청구서를 보낼 수 있어요.</p>
        <div class="actions"><button class="btn" disabled>비서들에게 청구서 보내기</button>${addButtons}</div></section>`;
    }
    // 확인이 필요한 줄이 있으면 서버가 막는다. 미리 알리지 않고, 버튼을 눌렀을 때 그 자리에서 까닭을 알린다(agentAct의 send-invoices)
    const notice = blockedNotice(flaggedLines(expenses, isFlagged), { me: state.data.me.uid, nameOf });
    if (!notice) state.sendBlocked = false; // 막던 줄을 모두 확인했으면 안내는 저절로 사라진다
    const blocked = state.sendBlocked ? notice : null;
    return `<section class="next"><p class="eyebrow">다음에 할 일</p><h2>이대로 청구서를 보낼까요?</h2>
      <p>보내면 각자의 비서가 자기 규칙대로 확인해요. 단톡방에는 아무것도 올라가지 않아요.${invoices.length ? ' 지출이 바뀌어서 다시 보내야 해요.' : ''}</p>
      ${state.formError && !state.sheet ? `<p class="form-error" role="alert">${esc(state.formError)}</p>` : ''}
      <div class="actions"><button class="btn" data-action="send-invoices"${blocked ? ' aria-describedby="send-blocked"' : ''}>비서들에게 청구서 보내기</button>${addButtons}</div>
      ${blocked ? blockedHtml(blocked, state.announceBlocked) : ''}</section>`;
  }
  const live = transfers.filter((t) => t.version === room.version);
  // 편할 때 보내기로 정한 송금은 바로 알리지 않는다. 대신 방을 열었을 때 내 차례임을 보여 준다
  const manual = live.find((t) => t.from === state.data.me.uid && t.status === 'scheduled' && isManual(t));
  if (manual) {
    return `<section class="next"><p class="eyebrow">편할 때 보내기</p><h2>${esc(nameOf(manual.to))}에게 ${won(manual.amount)}을 보내면 돼요</h2>
      <p>편할 때 보내기로 정해서 비서가 바로 알리지 않아요. 준비되면 보내 주세요.${manual.remindAt ? ` ${esc(whenText(manual.remindAt))}까지 받았다는 확인이 없으면 한 번 알려 드려요.` : ''}</p><div class="actions"><button class="btn" data-action="open-transfer" data-id="${esc(manual.id)}">보내러 가기</button>${addButtons}</div></section>`;
  }
  const done = live.length ? live.every((t) => t.status === 'confirmed') : current.every((i) => i.status === 'accepted');
  if (done) {
    return `<section class="next done"><p class="eyebrow">정산 완료</p><h2>정산이 끝났어요</h2>
      <p>아무도 단톡방에서 돈 얘기를 꺼내지 않았어요. 남은 건 비서끼리 주고받은 기록뿐이에요.</p><div class="actions">${addButtons}</div></section>`;
  }
  return `<section class="next"><p class="eyebrow">기다리는 중</p><h2>다른 사람의 확인을 기다리고 있어요</h2>
    <p>누가 무엇을 하고 있는지는 아래 '누가 누구에게'와 비서끼리 기록에서 볼 수 있어요. 내 차례가 되면 여기에 올려요.</p><div class="actions">${addButtons}</div></section>`;
}

// 청구서를 막는 줄 안내. 몇 줄인지, 어느 지출의 줄인지, 누가 확인할지를 글로 쓰고(색에만 기대지 않는다) 줄마다 그리로 가는 버튼을 둔다.
// 스크린리더에는 눌렀을 때 한 번만 읽어 준다(announce). 이벤트로 다시 그릴 때마다 읽으면 시끄럽다
function blockedHtml(n, announce) {
  return `<div class="blocked" id="send-blocked"${announce ? ' role="alert"' : ''}>
    <p class="blocked-title">${ALERT}${esc(n.title)}</p>
    <p class="blocked-lead">${esc(n.lead)}</p>
    <ul>${n.rows.map((r) => `<li><span class="blocked-what">${esc(r.what)}<small>${esc(r.who)}</small></span>
      <button class="btn sm secondary" data-action="open-exp" data-id="${esc(r.expId)}" data-line="${esc(r.lineId)}" aria-label="${esc(`${r.what} ${r.label}`)}">${esc(r.label)}</button></li>`).join('')}</ul></div>`;
}

// 눌러서 막힌 버튼 자리에서 알린다. 그리는 사이 잃은 초점을 돌려주고, 안내가 화면 밖이면 보이게 한 뒤, 버튼을 흔든다
function alertBlocked() {
  const btn = $('[data-action="send-invoices"]');
  if (!btn) return;
  btn.focus({ preventScroll: true });
  $('#send-blocked')?.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  nudge(btn);
}

const formError = () => (state.formError ?`<p class="form-error" role="alert">${esc(state.formError)}</p>` : '');
const notFound = (title) => ({ title, html: '<p class="empty">찾을 수 없어요. 지출이 바뀌어 대체됐을 수 있어요.</p>' });

// 이의를 낼 수 있는 지출: 그 청구서를 받은 사람이 함께 있던 지출
const disputable = (inv) => state.data.expenses.filter((e) => e.present.includes(inv.to));

// 한도를 넘어 비서가 물은 청구서: 이대로 받거나, 맞지 않는 지출을 골라 이의를 낸다
function invoiceSheet() {
  const inv = byId('invoices', state.ref);
  if (!inv) return notFound('청구서');
  const dd = state.disputeDraft;
  const answering = inv.status === 'asked' && inv.to === state.data.me.uid;
  const form = dd ? disputeForm(inv, dd) : '';
  return {
    title: '청구서',
    html: `<div class="big"><div class="amt">${won(Math.max(0, -inv.net))}</div>
        <p class="sub">낸 돈 ${won(inv.paid)} · 내 몫 ${won(inv.owed)} · 방 version ${inv.version}</p>
        ${inv.hasLocationSummary ? `<p class="badges">${chip('위치 요약 · 확인 전')}</p>` : ''}</div>
      <p class="how">${esc(inv.reasons.join(' · '))}</p>
      ${answering && !dd ? `${formError()}<div style="display:grid;gap:8px"><button class="btn" data-action="answer-invoice" data-decision="accept">이대로 받기</button>
        <button class="btn secondary" data-action="start-dispute">맞지 않는 지출이 있어요</button></div>` : ''}
      ${answering ? form : `<p class="group-note">${inv.status === 'accepted' ? '받기로 했어요.' : inv.status === 'disputed' ? '이의를 제기했어요.' : '지출이 바뀌어 대체된 청구서예요.'}</p>`}`,
  };
}

// 중재안에 할 수 있는 것: 동의하거나, 거부해서 이의를 끝낸다. 거부는 되돌릴 수 없어서
// 한 번 누르면 까닭(선택)을 적는 칸과 확정 버튼이 열리고, 그동안 동의 버튼은 숨겨 칸이 동의에 딸린 것처럼 읽히지 않게 한다.
// 동의와는 아이콘·글자·바탕이 달라 색만 보고 고르지 않게 한다
function proposalChoices(d, exp, uid) {
  const choose = disputeChoices(d, exp, uid);
  const rd = state.rejectDraft;
  const busy = state.busy === 'reject';
  const waiting = disputeWaiting(d, exp);
  const buttons = [
    choose.agree && !rd && `<button class="btn lead" data-action="agree" data-id="${esc(d.id)}">${CHECK}중재안에 동의</button>`,
    choose.reject && !rd && `<button class="btn secondary lead" data-action="reject-ask">${CROSS}중재안 거부하기</button>`,
  ].filter(Boolean).join('');
  return `${!choose.agree && waiting.length ? `<p class="group-note" style="margin-bottom:12px">${waiting.map(nameOf).map(esc).join('·')}의 동의를 기다려요.</p>` : ''}
    ${buttons ? `<div class="stack">${buttons}</div>` : ''}
    ${choose.reject && !rd ? '<p class="group-note">거부하면 이 이의가 끝나고, 지출은 지금 배분 그대로 정산해요.</p>' : ''}
    ${choose.reject && rd ? `<section class="group"><div class="list"><label class="row field"><span class="grow">거부하는 까닭(선택)</span>
        <input data-rd="reason" value="${esc(rd.reason)}" maxlength="100" placeholder="예: 술은 같이 마셨어요"></label></div>
        <p class="group-note">까닭은 비서끼리 기록에 남아 상대도 볼 수 있어요. 거부하면 되돌릴 수 없어요.</p></section>
      <div class="stack"><button class="btn danger lead" data-action="reject" data-id="${esc(d.id)}" ${busy ? 'disabled' : ''}>${CROSS}${busy ? '거부하는 중…' : '거부하고 지금 배분대로 정산'}</button>
        <button class="btn plain" data-action="reject-cancel" ${busy ? 'disabled' : ''}>취소</button></div>` : ''}`;
}

const rowText = (title, meta = '', end = '') => `<span class="grow"><span class="title">${esc(title)}</span>${meta ? `<span class="meta" style="display:block">${esc(meta)}</span>` : ''}</span>${end}`;

// #7 정산당 한 번: 여행이 끝난 뒤 Google 지도 타임라인 파일을 한 번 고르면, 이의를 낼 때마다 그 지출 시간대를 여기 남긴 방문에서 찾는다
function locationSection() {
  const { expenses, me } = state.data;
  if (!expenses.some((e) => e.present.includes(me.uid))) return '';
  const visits = savedVisits();
  const body = state.timelineReading
    ? `<div class="list" aria-busy="true"><div class="row">${tile('pin')}${rowText('파일에서 이 정산 기간만 찾는 중…')}</div></div>`
    : visits
    ? `<div class="list"><div class="row">${tile('pin')}${rowText('Google 지도 타임라인을 올렸어요', visits.length ? `이 정산 기간 방문 ${visits.length}곳 · 이의를 낼 때 자동으로 찾아요` : '이 정산 기간의 기록이 없어요')}
        <button type="button" class="text-btn" data-action="timeline-forget">지우기</button></div></div>`
    : `<div class="list"><button type="button" class="row" data-action="timeline-guide" aria-haspopup="dialog">${tile('pin')}${rowText('Google 지도 타임라인 올리기', '여행이 끝난 뒤 한 번만 올리면 돼요', CHEVRON)}</button></div>`;
  return `<section class="group"><h2 class="group-label"><span>내 위치 기록</span><span>선택</span></h2>${body}
    ${state.timelineError ? `<p class="form-error" role="alert">${esc(state.timelineError)}</p>` : ''}
    <p class="group-note">파일은 이 기기에서만 읽어요. 이 정산 기간의 방문 시각만 이 브라우저에 ${TIMELINE_DAYS}일 두고, 이의를 낼 때 내가 켠 한 줄만 상대에게 가요.</p></section>`;
}

// 이의 쓰기(#7). 타임라인을 올리면 결제 전에 자리를 떠난 지출을 골라 두고 '맞지 않는 점'을 채운다(public/timeline.js의 findMismatches).
// 골라 둔 지출은 눌러서 빼고, 다른 지출은 눌러서 더한다. 맞지 않는 점은 고치거나 비워도 된다(서버가 기본 문구로 채운다).
// 타임라인은 이의에 쓰려고 올린 것이라 따로 묻지 않고, 보낼 때 찾은 지출에 위치 요약(떠난 시각 한 줄)을 함께 붙인다.
// dd: { picks: { [지출 id]: 맞지 않는 점 }, found: { [지출 id]: { result, summary, claim } } | null, scan: null | 'reading' | { error } }
function disputeForm(inv, dd) {
  const choices = disputable(inv);
  const found = dd.found;
  const foundCount = found ? Object.keys(found).length : 0;
  const picked = choices.filter((e) => e.id in dd.picks);
  const located = picked.filter((e) => found?.[e.id]).length;
  const scan = dd.scan === 'reading'
    ? `<div class="list" aria-busy="true"><div class="row">${tile('pin')}${rowText('타임라인에서 찾는 중…')}</div></div>`
    : found
    ? `<div class="list"><div class="row">${tile('pin')}${rowText(foundCount ? `자리를 떠난 지출 ${foundCount}건을 골라 뒀어요` : '타임라인과 맞지 않는 지출이 없어요', foundCount ? '아니면 아래에서 눌러 빼요' : '맞지 않는 지출을 직접 골라요')}
        <button type="button" class="text-btn" data-action="timeline-pick">다른 파일 고르기</button></div></div>`
    : `<div class="list"><button type="button" class="row" data-action="timeline-guide" aria-haspopup="dialog">${tile('pin')}${rowText('Google 지도 타임라인 올리기', '자리를 떠난 지출을 찾아 골라 둬요', CHEVRON)}</button></div>`;
  const sample = authOptions().dev && dd.scan !== 'reading' ? '<div class="group-actions"><button type="button" class="text-btn" data-action="timeline-sample">개발용 가짜 기록</button></div>' : '';
  const rows = choices.map((e) => {
    const on = e.id in dd.picks;
    const f = found?.[e.id];
    const claim = on ? `<div class="row claim-row"><textarea data-claim="${esc(e.id)}" rows="2" maxlength="200" aria-label="‘${esc(e.title)}’에서 맞지 않는 점" placeholder="맞지 않는 점(비워도 보낼 수 있어요)">${esc(dd.picks[e.id])}</textarea></div>` : '';
    return `<button type="button" class="row choice" data-action="dispute-toggle" data-id="${esc(e.id)}" aria-pressed="${on}">
        ${tile(e.kind)}<span class="grow"><span class="title">${esc(e.title)}</span><span class="meta" style="display:block">${esc(nameOf(e.payer))} · ${money(amountOf(e), e.currency)}${f ? ` · <span class="found">${esc(f.result.leftAt)}에 떠남</span>` : ''}</span></span>
        <span class="choice-mark" aria-hidden="true">${on ? ICON_DONE : ''}</span></button>${claim}`;
  }).join('');
  const note = located ? `<p class="group-note">고른 지출 중 ${located}건에는 타임라인에서 찾은 떠난 시각 한 줄이 이의 상대와 중재 비서에게 가요. 파일·좌표·장소 이름은 보내지 않고, 7일 뒤 지워요.</p>` : '';
  return `<section class="group"><h3 class="group-label"><span>위치 기록으로 찾기</span><span>선택</span></h3>${scan}
      ${dd.scan?.error ? `<p class="form-error" role="alert">${esc(dd.scan.error)}</p>` : ''}${sample}</section>
    <section class="group"><h3 class="group-label"><span>맞지 않는 지출</span><span>${picked.length ? `${picked.length}건 고름` : '눌러서 골라요'}</span></h3>
      <div class="list">${rows}</div>${note}</section>
    ${formError()}
    <button class="btn" style="width:100%" id="dispute-send" data-action="answer-invoice" data-decision="dispute" ${picked.length ? '' : 'disabled'}>${picked.length > 1 ? `이의 ${picked.length}건 보내기` : '이의 보내기'}</button>`;
}

// 타임라인 방문에서 이 청구서의 맞지 않는 지출을 찾아 골라 둔다. 사람이 이미 고르거나 고쳐 쓴 지출은 그대로 둔다
function scanDispute(visits) {
  const dd = state.disputeDraft;
  const inv = byId('invoices', state.ref);
  if (!dd || !inv) return;
  const found = findMismatches(visits, disputable(inv));
  dd.found = Object.fromEntries(found.map((f) => [f.expenseId, f]));
  for (const f of found) if (!(f.expenseId in dd.picks)) dd.picks[f.expenseId] = f.claim;
}

// 타임라인 올리기 안내(#7). 처음 올릴 때는 바로 파일을 고르게 하지 않고, 이 기기에 맞는 내보내기 단계와
// 'Google 지도 열기'·'내보낸 파일 고르기'를 보여 준다. 컴퓨터에는 타임라인이 없어서 지도 링크 없이 파일만 고른다
const deviceOs = guessOs(navigator.userAgent, navigator.maxTouchPoints);
let guideOs = deviceOs === 'android' ? 'android' : 'ios';
function renderGuide() {
  const body = $('#guide-body');
  body.innerHTML = guideHtml({ os: guideOs, phone: deviceOs !== 'computer' });
  mountSegs(body);
}

// 파일 고르기. 문서에 붙인 입력은 다시 그릴 때 사라지므로 고를 때마다 만든다
function pickTimeline() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
  input.addEventListener('change', () => {
    if (input.files?.[0]) readTimeline(input.files[0]);
    input.remove();
  });
  document.body.append(input);
  input.click();
}

// 파일은 여기서만 읽는다. 이 정산 지출 시간대의 방문만 남기고, 이의를 쓰는 중이면 맞지 않는 지출을 바로 찾아 골라 둔다
async function readTimeline(file) {
  const dd = state.disputeDraft;
  const redraw = () => { render(); if (dd) renderSheet(); };
  state.timelineReading = true;
  state.timelineError = '';
  if (dd) dd.scan = 'reading';
  redraw();
  try {
    const mine = state.data.expenses.filter((e) => e.present.includes(state.data.me.uid));
    const visits = keepForSettlement(readVisits(JSON.parse(await file.text())), mine);
    saveVisits(visits);
    if (dd && state.disputeDraft === dd) {
      scanDispute(visits);
      dd.scan = null;
    }
  } catch (e) {
    const message = e instanceof SyntaxError ? 'JSON 파일이 아니에요. 휴대폰 Google 지도에서 내보낸 타임라인 파일을 골라 주세요.' : e.message;
    if (dd) dd.scan = { error: message };
    else state.timelineError = message;
  }
  state.timelineReading = false;
  redraw();
}

// 개발용: 고른 지출에 맞춘 가짜 타임라인. 첫 주문 20분 전부터 머물다 결제 전에 떠나 13분 뒤 다른 곳에 도착한다
function sampleTimeline(exp) {
  const { from, until } = expenseWindow(exp);
  const iso = (ms) => new Date(ms + 9 * 3600_000).toISOString().replace('Z', '+09:00');
  const left = from + Math.round((until - from) * 0.6);
  const visit = (start, end) => ({ startTime: iso(start), endTime: iso(end), visit: { hierarchyLevel: 0, probability: 0.9, topCandidate: { semanticType: 'UNKNOWN' } } });
  return { semanticSegments: [visit(from - 20 * 60_000, left), visit(left + 13 * 60_000, left + 8 * 3600_000)] };
}

// 이의와 중재안. 중재안은 줄마다 누구 몫인지와 사람별 몫이 어떻게 바뀌는지 보여 준다
function disputeSheet() {
  const d = byId('disputes', state.ref);
  const exp = d && byId('expenses', d.expenseId);
  if (!exp) return notFound('이의');
  const { room, me } = state.data;
  const party = [exp.payer, d.by].includes(me.uid);
  // 이의를 낸 사람이 붙인 타임라인 요약은 본인이 언제든 지울 수 있다(동의 철회). 지우면 미확정 중재안은 다시 열린 이의가 된다
  const mine = d.by === me.uid && d.evidence.some((e) => e.locationId);
  const evidence = d.evidence.length
    ? `<div class="list">${d.evidence.map((e) => `<div class="row"><span class="grow">${esc(e.summary)}</span>${e.time ? chip(e.time) : ''}</div>`).join('')}</div>
      ${mine ? '<div class="actions" style="margin-top:8px"><button type="button" class="text-btn" data-action="revoke-location">내 위치 요약 지우기</button></div>' : ''}` : '';
  let body = '';
  if (d.status === 'superseded') {
    body = `<p class="group-note">${esc(disputeNote(d, exp, nameOf))}</p>`;
  } else if (d.status === 'open') {
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
    body = `<section class="group"><h3 class="group-label"><span>중재안</span><span>${esc(allocLabel({ source: d.proposal.source }))}</span></h3>
        <p class="how">${esc(d.proposal.summary)}</p><div class="list">${lines}</div></section>
      <section class="group"><h3 class="group-label"><span>사람별 몫</span><span>지금 → 중재안</span></h3><div class="list">${people}</div></section>
      ${formError()}
      ${d.status === 'resolved' ? '<p class="group-note">양쪽이 동의해서 이 지출을 다시 나눴어요.</p>'
        : disputeRejected(d) ? `<p class="group-note">${esc(disputeNote(d, exp, nameOf))}</p>${d.rejectReason ? `<p class="group-note">까닭: ${esc(d.rejectReason)}</p>` : ''}`
        : proposalChoices(d, exp, me.uid)}`;
  }
  return {
    title: `‘${exp.title}’ 이의`,
    html: `<p class="how"><b>${esc(nameOf(d.by))}의 비서</b> · ${esc(d.claim)}</p>
      ${evidence ? `<section class="group"><h3 class="group-label"><span>근거</span></h3>${evidence}</section>` : ''}${body}`,
  };
}

// 중재안에 동의하거나 거부하면 시트가 닫히므로, 사용자가 돌아오는 다음 할 일 카드 바로 위에 결과를 한 줄 남긴다.
// 상대가 이어서 동의하거나 거부하면 기록을 받아 다시 그릴 때 '다시 나눴어요'·'이의가 끝났어요'로 바뀐다.
// 거부로 끝난 한 줄은 동의의 초록 체크와 달리 회색 ✕로 그려, 색을 못 봐도 구분된다
function disputeLine() {
  const d = state.disputeDone && byId('disputes', state.disputeDone);
  const exp = d && byId('expenses', d.expenseId);
  const ended = d && disputeRejected(d);
  return exp ? `<p class="done-note${ended ? ' ended' : ''}" id="dispute-note" role="status">${ended ? CROSS : CHECK}<span>${esc(disputeNote(d, exp, nameOf))}</span></p>` : '';
}

const copyRow = (label, value, key) => `<div class="row"><span class="grow"><span class="meta" style="display:block">${label}</span>
    <span class="title num" style="user-select:all">${esc(value)}</span></span>
    <button type="button" class="btn sm secondary" data-action="copy" data-text="${esc(value)}" data-key="${key}">${state.copied === key ? '복사했어요' : '복사'}</button></div>`;

// 데스크톱 QR(#8). 토큰은 수명이 15분이라, 송금 화면을 열 때마다 서버에서 새로 받는다.
// QR에는 계좌·금액이 든 t.link를 바로 담지 않는다. 우리 서버의 짧은 수명 토큰(/api/qr/:token)을 담아,
// QR 이미지를 만들어 주는 외부 서비스는 그 토큰만 보고 실제 계좌 정보는 보지 못하게 한다.
const isComputer = () => matchMedia(COMPUTER_QUERY).matches;
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

// 부르는 쪽에서 컴퓨터이고 t.link가 있을 때만 부른다(링크가 없으면 QR로 열 토스 화면이 없고, 휴대폰은 토스가 바로 열린다)
function qrBlock(t, { sentButton = true } = {}) {
  if (!qrIsFresh(state.qr, t.id)) refreshQr(t.id);
  const qr = state.qr?.id === t.id ? state.qr : null;
  // 휴대폰 카메라가 찍을 절대 주소가 필요해서, API_BASE가 비어 있으면(로컬 개발) 지금 페이지 origin을 쓴다
  const img = qr?.token
    ? `<img src="${qrImageUrl(`${API_BASE || location.origin}/api/qr/${enc(qr.token)}`)}" width="220" height="220" alt="휴대폰으로 토스 송금 화면을 여는 QR 코드" referrerpolicy="no-referrer">`
    : `<div class="qr-wait">${qr?.failed ? 'QR을 만들지 못했어요.<br>위 계좌번호를 복사해 보내 주세요.' : 'QR을 만드는 중이에요'}</div>`;
  // 컴퓨터에는 슬라이더가 없으니, 휴대폰으로 보내고 돌아온 사람이 여기서 바로 끝낸다.
  // 보냈어요 버튼이 이미 있는 시트(보냈나요?)에서는 sentButton: false로 QR만 붙인다
  return `<div class="qr-desktop"><p class="group-note">휴대폰 카메라로 QR을 찍으면 토스 송금 화면이 열려요.</p>${img}
    ${sentButton ? `<button class="btn secondary" style="width:100%;margin-top:12px" data-action="mark-sent" data-id="${esc(t.id)}">보냈어요</button>` : ''}</div>`;
}

// 송금: 밀어서 보내면 그 제스처 안에서 토스를 연다. 앱이 안 열리면 계좌·금액을 복사해 둔다.
// 컴퓨터에서는 토스가 열리지 않으니 슬라이더 대신 휴대폰으로 넘기는 QR만 보여 준다(sendMode)
function transferSheet() {
  const t = byId('transfers', state.ref);
  if (!t) return notFound('송금');
  const me = state.data.me.uid;
  const toName = nameOf(t.to);
  const account = t.fallback ? `<section class="group"><h3 class="group-label"><span>${esc(toName)}의 계좌</span><span>${esc(t.fallback.bank)}</span></h3>
      <div class="list">${copyRow('계좌번호', t.fallback.accountNo, 'acct')}${copyRow('금액', String(t.amount), 'amt')}</div></section>` : '';
  const note = {
    fallback: '토스가 열리지 않으면, 계좌번호를 복사해 두었으니 쓰시는 은행 앱에 붙여 넣어 보내 주세요.',
    back: '송금 앱에서 돌아왔어요. 보냈나요?',
  }[state.transferNote];
  let actions = '';
  if (t.from === me && ['scheduled', 'due'].includes(t.status)) {
    const mode = sendMode(t, { computer: isComputer() });
    actions = mode === 'qr'
      ? qrBlock(t)
      : mode === 'slider'
        ? `<div class="slider" data-commit="send" data-id="${esc(t.id)}"><span class="slider-fill"></span>
          <span class="slider-label">${t.link ? '밀어서 토스로 보내기' : '밀어서 계좌 복사하기'}</span>
          <button type="button" class="slider-thumb" aria-label="${t.link ? '밀어서 토스로 보내기' : '밀어서 계좌 복사하기'}. Enter 키로도 할 수 있어요">${ARROW}</button></div>
        <p class="slider-hint">${t.link ? '토스가 열리지 않으면 계좌번호를 복사해 드려요' : '받는 사람의 계좌를 복사해 드려요'}</p>`
        : `<p class="group-note">${esc(subj(toName))} 받을 계좌를 아직 알려 주지 않았어요. 알려 주면 바로 보낼 수 있어요.</p>`;
  } else if (t.from === me && (t.status === 'opened' || (t.status === 'sent' && t.notReceivedAt))) {
    // 받는 사람이 "아직 안 들어왔어요"라고 했으면(상태는 sent 그대로) 제목만 바꾸고 송금 내역부터 보게 한다(버튼은 같다)
    const head = t.notReceivedAt
      ? `<h3 style="margin:0 0 8px">${esc(subj(toName))} 아직 못 받았대요</h3><p class="group-note" style="padding:0;margin:0 0 10px">토스 송금 내역을 먼저 확인해 주세요. 두 번 보내지 않게요.</p>`
      : '<h3 style="margin:0 0 10px">보냈나요?</h3>';
    // 컴퓨터(마우스 기기)에서는 토스 링크가 열리지 않으므로 토스 다시 열기 대신 휴대폰으로 넘길 QR을 보여 준다(보냈어요 버튼은 위에 있다).
    // 너비로 판단하면 가로로 돌린 휴대폰에서 토스 다시 열기가 사라지고 자기 화면의 QR이 뜬다
    actions = `${head}<div style="display:grid;gap:8px">
      <button class="btn" data-action="mark-sent" data-id="${esc(t.id)}">보냈어요</button>
      ${t.link && !isComputer() ? `<button class="btn secondary" data-action="reopen-link" data-id="${esc(t.id)}">토스 다시 열기</button>` : ''}
      <button class="btn plain" data-action="close-sheet">아직이에요</button></div>${t.link && isComputer() ? qrBlock(t, { sentButton: false }) : ''}`;
  } else if (t.to === me && isManual(t) && ['scheduled', 'due', 'opened'].includes(t.status)) {
    actions = `<p class="group-note">${esc(subj(nameOf(t.from)))} 편할 때 보내기로 했어요. 돈이 들어왔으면 알려 주세요. 그러면 비서가 ${esc(nameOf(t.from))}에게 따로 알리지 않아요.</p>
      <button class="btn" style="width:100%;margin-top:10px" data-action="confirm-receipt" data-id="${esc(t.id)}">받았어요</button>`;
  } else if (t.to === me && t.status === 'sent' && !t.notReceivedAt) {
    actions = `<div style="display:grid;gap:8px"><button class="btn" data-action="confirm-receipt" data-id="${esc(t.id)}">받았어요</button>
      <button class="btn secondary" data-action="not-received" data-id="${esc(t.id)}">아직 안 들어왔어요</button></div>`;
  } else if (t.to === me && t.status === 'sent') {
    // 다시 확인해 달라고 한 사이 돈이 늦게 들어왔으면 바로 끝낼 수 있게
    actions = `<p class="group-note">${esc(nameOf(t.from))}에게 다시 확인해 달라고 했어요. 그 사이 들어왔다면 알려 주세요.</p>
      <button class="btn" style="width:100%;margin-top:10px" data-action="confirm-receipt" data-id="${esc(t.id)}">받았어요</button>`;
  } else {
    actions = `<p class="group-note">${{ scheduled: !isManual(t) ? `${whenText(t.remindAt)}에 ${esc(nameOf(t.from))}에게 알려요.` : `${esc(subj(nameOf(t.from)))} 편할 때 보내기로 했어요.`, due: `${esc(subj(nameOf(t.from)))} 보낼 차례예요.`, opened: `${esc(subj(nameOf(t.from)))} 송금 앱을 열었어요.`, sent: t.notReceivedAt ? `${esc(subj(toName))} 아직 못 받았대요. ${esc(subj(nameOf(t.from)))} 확인하고 있어요.` : `${esc(subj(nameOf(t.from)))} 보냈어요. 받는 사람의 확인을 기다려요.`, confirmed: '받았다고 확인했어요. 이 송금은 끝났어요.', superseded: '지출이 바뀌어 대체된 송금이에요.' }[t.status] ?? ''}</p>`;
  }
  return {
    title: '송금',
    html: `<div class="big"><div class="amt">${won(t.amount)}</div><p class="sub">${esc(nameOf(t.from))} → ${esc(toName)}${t.status === 'scheduled' && !isManual(t) && new Date(t.remindAt) > Date.now() ? ` · ${whenText(t.remindAt)} 예약` : ''}</p></div>
      ${note ? `<p class="preview-note" style="margin-bottom:14px">${esc(note)}</p>` : ''}
      ${account}${formError()}${actions}`,
  };
}

function payoutSheet() {
  return {
    title: '받을 계좌',
    html: `<p class="how">계좌번호는 나에게 돈을 보낼 사람에게만 보여요. 받을 송금이 있으면 바로 토스 링크가 채워져요. 계좌는 모든 방에 같아요.</p>
      <section class="group">${payoutFieldsHtml(state.payoutDraft)}</section>${formError()}
      <button class="btn" style="width:100%" data-action="save-payout">저장</button>`,
  };
}

// 개인 비서 설정(#5). 받을 계좌는 위 payoutSheet를 그대로 쓴다
const agentPanel = createAgentPanel({
  api,
  roomId,
  summary: () => state.data?.myAgent,
  meName: () => state.data?.me.name ?? '',
  rerender: () => renderSheet(),
  openSheet: (kind) => openAgentSheet(kind),
  closeSheet: () => sheet.close(),
  reload: () => load(),
  openPayout: (payout) => openPayoutSheet(payout),
});

// 친구 초대(#4): 참여자 줄 끝 + 버튼으로 연다. 누가 참가하면 방이 다시 그려지면서 이 시트의 참여자 목록도 바로 바뀐다
const inviteSheet = () => ({
  title: '친구 초대',
  html: inviteSheetHtml({ room: state.data.room, me: state.data.me, avatar, invite: setup.invite, copied: setup.copied, copyError: setup.copyError, canShare: !!navigator.share }),
});
const AGENT_SHEETS = { invoice: invoiceSheet, dispute: disputeSheet, transfer: transferSheet, payout: payoutSheet, invite: inviteSheet, ...agentPanel.sheets };

// 방의 할 일에서 열면 비어 있고, 내 비서 설정에서 열면 저장된 은행·예금주를 채운다. 계좌번호는 끝 4자리만 알아서 새로 입력한다
function openPayoutSheet(saved = null) {
  state.payoutDraft = payoutDraftFrom(saved, state.data.me.name);
  state.payoutFromAgent = Boolean(saved) || state.sheet === 'agent';
  openAgentSheet('payout');
}

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
  // 2초 안에 페이지가 가려지지 않으면(앱 없음·데스크톱, 또는 iPhone이 'Open in "Toss"?'를 묻는 중) 복사 안내를 띄운다.
  // 실패로 단정하지 않아서, 나중에 토스로 넘어갔다 돌아오면 '보냈나요?'로 바뀐다(sendFollowUp)
  setTimeout(() => { if (state.pendingSend?.id === tid) followUp('timeout'); }, 2000);
}
function followUp(event) {
  const id = state.pendingSend?.id;
  const { pending, note } = sendFollowUp(state.pendingSend, event);
  state.pendingSend = pending;
  if (!note) return;
  state.transferNote = note;
  openAgentSheet('transfer', id);
  load();
}
document.addEventListener('visibilitychange', () => followUp(document.hidden ? 'hidden' : 'visible'));

const AGENT_ACTIONS = new Set(['send-invoices', 'open-invoice', 'start-dispute', 'dispute-toggle', 'timeline-pick', 'timeline-guide', 'tl-os', 'timeline-file', 'close-guide', 'timeline-forget', 'timeline-sample', 'revoke-location', 'answer-invoice', 'open-dispute', 'mediate', 'agree', 'reject-ask', 'reject-cancel', 'reject', 'open-transfer', 'reopen-link', 'mark-sent', 'confirm-receipt', 'not-received', 'open-payout', 'save-payout', 'copy']);


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
    const blocked = () => flaggedLines(state.data.expenses, isFlagged).length > 0;
    // 확인이 필요한 줄이 남았으면 서버도 409로 막는다. 같은 기준으로 먼저 알아 기다림 없이 그 자리에서 알린다.
    // 그 사이 다른 사람이 줄을 만들어 서버가 먼저 막았어도 post가 방을 다시 불러온 뒤라 같은 안내로 이어진다
    if (!blocked()) {
      state.busy = 'send';
      state.formError = '';
      render();
      await post('/invoices/send');
      state.busy = null;
    }
    state.sendBlocked = blocked();
    state.announceBlocked = state.sendBlocked;
    if (state.sendBlocked) state.formError = ''; // 서버의 409 문구는 안내가 대신한다
    render();
    state.announceBlocked = false;
    if (state.sendBlocked) alertBlocked();
  } else if (name === 'open-invoice') {
    state.disputeDraft = null;
    openAgentSheet('invoice', d.id);
  } else if (name === 'start-dispute') {
    state.disputeDraft = { picks: {}, found: null, scan: null };
    const visits = savedVisits(); // 이 정산에 이미 올려 둔 타임라인이 있으면 바로 찾아 골라 둔다
    if (visits) scanDispute(visits);
    renderSheet();
  } else if (name === 'dispute-toggle') {
    // 누를 때마다 고르고 뺀다. 다시 고르면 타임라인에서 찾은 글을 다시 채운다. 다시 그린 뒤에도 그 줄에 초점을 둔다
    const dd = state.disputeDraft;
    if (d.id in dd.picks) delete dd.picks[d.id];
    else dd.picks[d.id] = dd.found?.[d.id]?.claim ?? '';
    renderSheet();
    $(`[data-action="dispute-toggle"][data-id="${CSS.escape(d.id)}"]`)?.focus({ preventScroll: true });
  } else if (name === 'timeline-pick') {
    pickTimeline();
  } else if (name === 'timeline-guide') {
    guide.open(renderGuide);
  } else if (name === 'tl-os') {
    guideOs = d.id;
    renderGuide();
  } else if (name === 'timeline-file') {
    pickTimeline(); // 파일 선택 창은 이 누름 안에서 바로 열어야 한다. 안내는 그 뒤에 내린다
    guide.close();
  } else if (name === 'close-guide') {
    guide.close();
  } else if (name === 'timeline-forget') {
    forgetVisits();
    render();
  } else if (name === 'timeline-sample') {
    const inv = byId('invoices', state.ref);
    const exp = inv && disputable(inv)[0];
    if (exp) scanDispute(readVisits(sampleTimeline(exp)));
    renderSheet();
  } else if (name === 'revoke-location') {
    await post('/location/revoke');
  } else if (name === 'answer-invoice') {
    const dd = state.disputeDraft;
    let body = { decision: 'accept' };
    if (d.decision === 'dispute') {
      const ids = disputable(byId('invoices', state.ref)).map((e) => e.id).filter((id) => id in dd.picks);
      if (!ids.length) return;
      // 타임라인으로 찾은 지출에는 위치 요약을 먼저 붙인다. 그러면 이의에 근거로 함께 들어간다. 이미 붙어 있으면(409) 그것을 쓴다
      for (const id of ids.filter((i) => dd.found?.[i])) {
        try {
          await api(`/api/rooms/${enc(roomId)}/location/timeline`, { method: 'POST', body: { agree: true, expenseId: id, ...dd.found[id].result } });
        } catch (e) {
          if (e.status === 409) continue;
          state.formError = e.message;
          return renderSheet();
        }
      }
      body = { decision: 'dispute', disputes: ids.map((id) => ({ expenseId: id, claim: dd.picks[id] })) };
    }
    if (await post(`/invoices/${enc(state.ref)}/answer`, body)) {
      state.disputeDraft = null;
      sheet.close();
    }
  } else if (name === 'open-dispute') {
    state.rejectDraft = null;
    openAgentSheet('dispute', d.id);
  } else if (name === 'mediate') {
    state.busy = 'mediate';
    renderSheet();
    await post(`/disputes/${enc(d.id)}/mediate`);
    state.busy = null;
    renderSheet();
  } else if (name === 'agree') {
    // 동의하면 시트를 닫고 결과는 방 화면에 한 줄로 남긴다. 실패(409 등)하면 시트를 그대로 두고 까닭을 보여 준다
    if (await post(`/disputes/${enc(d.id)}/agree`)) {
      state.disputeDone = d.id;
      sheet.close();
      render();
      $('#dispute-note')?.scrollIntoView({ block: 'nearest' });
    }
  } else if (name === 'reject-ask') {
    state.rejectDraft = { reason: '' };
    state.formError = '';
    renderSheet();
  } else if (name === 'reject-cancel') {
    state.rejectDraft = null;
    state.formError = '';
    renderSheet();
  } else if (name === 'reject') {
    // 거부하면 이의가 끝나므로 동의처럼 시트를 닫고 결과를 방 화면에 한 줄로 남긴다. 실패(409 등)하면 시트를 그대로 두고 까닭을 보여 준다
    if (state.busy === 'reject') return;
    state.busy = 'reject';
    renderSheet();
    const ok = await post(`/disputes/${enc(d.id)}/reject`, { reason: state.rejectDraft?.reason ?? '' });
    state.busy = null;
    if (ok) {
      state.rejectDraft = null;
      state.disputeDone = d.id;
      sheet.close();
      render();
      $('#dispute-note')?.scrollIntoView({ block: 'nearest' });
    } else {
      renderSheet();
    }
  } else if (name === 'open-transfer') {
    state.transferNote = null;
    openAgentSheet('transfer', d.id);
  } else if (name === 'mark-sent') {
    state.transferNote = null;
    state.pendingSend = null;
    await post(`/transfers/${enc(d.id)}/sent`);
  } else if (name === 'confirm-receipt') {
    await post(`/transfers/${enc(d.id)}/confirm`);
  } else if (name === 'not-received') {
    await post(`/transfers/${enc(d.id)}/not-received`);
  } else if (name === 'open-payout') {
    openPayoutSheet();
  } else if (name === 'save-payout') {
    if (await post('/payout', state.payoutDraft)) {
      if (state.payoutFromAgent) agentPanel.open(); // 내 비서 설정에서 왔으면 설정으로 돌아간다
      else sheet.close();
    }
  } else if (name === 'copy') {
    copyText(d.text, d.key);
  }
}

function render() {
  const main = $('#main');
  if (!state.data) renderChannel();
  if (inviteToken) {
    main.innerHTML = joinHtml(setup.invitePreview, setup.join, { ...setup, dev: authOptions().dev });
    return;
  }
  if (!roomId || state.error?.status === 'seed') {
    main.innerHTML = noRoom();
    return;
  }
  if (state.error?.status === 404) {
    if (!authOptions().dev) { main.innerHTML = '<section class="hero"><h1>방을 찾을 수 없어요</h1><a href="account.html">내 방 목록</a></section>'; return; }
    main.innerHTML = `<section class="hero"><h1>방을 찾을 수 없어요</h1>
      <p class="sub">서버를 다시 켜면 메모리에 있던 방이 사라져요. 개발용 데모 방을 다시 만들어 주세요.</p></section>
      <section class="next"><div class="actions"><button class="btn" data-action="seed">데모 방 만들기</button></div></section>`;
    return;
  }
  // 실제 방(배포, 또는 개발용 서버에서 만든 방)을 열지 못했을 때. 어디로 나갈지 함께 보여 준다
  if (!state.data && (!authOptions().dev || !isDemoRoom())) {
    const notMember = state.error?.status === 403;
    const title = !state.error ? '방을 여는 중…' : notMember ? '이 방의 멤버가 아니에요' : '방을 열 수 없어요';
    const sub = !state.error ? '' : notMember ? '방에 있는 친구에게 초대 링크를 받아 들어와 주세요.' : state.error.message || '연결을 확인해 주세요';
    main.innerHTML = `<section class="hero"><h1>${title}</h1>${sub ? `<p class="sub">${esc(sub)}</p>` : ''}</section>
      ${state.error ? '<section class="next"><div class="actions"><a class="btn" href="account.html">내 방 목록</a><a class="btn plain" href="room.html">새 방 만들기</a></div></section>' : ''}`;
    return;
  }
  if (!state.data) {
    // 아직 누구인지 모르거나(401) 이 방 멤버가 아니면(403) 방 정보 없이 멤버 목록도 모른다.
    // 개발용 시드 방의 uid로 고르게 한다.
    const seedMembers = [['me', '나'], ['cs', '철수'], ['yh', '영희'], ['ms', '민수']];
    main.innerHTML = `<section class="hero"><h1>누구로 볼까요?</h1>
      <p class="sub">개발용 데모 방의 멤버 중 한 명을 골라 주세요. 실제 계정으로 로그인한 경우에는 본인으로만 참여해요.</p></section>
      <section class="group"><div class="list">${seedMembers.map(([uid, name]) => `<button class="row" data-action="who" data-id="${uid}">
        ${avatarHtml(name[0], '#8e8e93')}<span class="grow">${name}</span></button>`).join('')}</div></section>`;
    return;
  }
  $('#nav-title').textContent = state.data.room.name;
  $('#nav-add').hidden = false;
  logPop.show(true);
  logPop.update(state.events); // 할 일이 바뀌었을 수 있다
  meMenu.update();
  const roomSetup = setupHtml({ room: state.data.room, me: state.data.me, avatar, policyEdit: setup.policyEdit, error: setup.error });
  main.innerHTML = [hero(), whoPicker(), agentPanel.nudgeHtml(), disputeLine(), nextCard(), roomSetup, disputesSection(), expensesSection(), transfersSection(), locationSection()].join('');
  mountSegs(main);
  // 이의·청구서 시트는 글을 쓰는 중이면 다시 그리지 않는다(타이핑 중 초점을 잃지 않게)
  if (['exp', 'transfer', 'invite'].includes(state.sheet) || (state.sheet === 'dispute' && !state.rejectDraft) || (state.sheet === 'invoice' && !state.disputeDraft)) renderSheet();
}

// ---------------------------------------------------------------- 이벤트
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (meMenu.isOpen && !e.target.closest('#me-menu-wrap')) meMenu.close(false); // 메뉴 밖을 누르면 닫는다
  if (!el || el.disabled) return;
  if (el.dataset.action === 'toggle-me-menu') return meMenu.toggle();
  if (meMenu.isOpen) meMenu.close(false); // 메뉴 안의 항목(내 비서)은 메뉴를 닫고 진행한다
  if (el.dataset.action === 'toggle-log') return logPop.toggle();
  if (el.dataset.action === 'close-log') return logPop.close();
  if (logPop.isOpen) logPop.close(false); // 기록 패널 안의 버튼(확인하기)은 패널을 닫고 진행한다
  act(el.dataset.action, el.dataset);
});
document.addEventListener('keydown', (e) => {
  agentPanel.onKeydown(e);
  if (rangeKeys(e)) return;
  if (e.key === 'Escape') {
    if (meMenu.isOpen) meMenu.close();
    else if (logPop.isOpen) logPop.close();
    else if (!$('#photo-modal').hidden) closePhoto();
    else if (setup.picker.open && !roomId) rangeAct('range-toggle', {});
    else if (guide.visible) guide.close(); // 겹친 안내부터 내린다
    else sheet.close();
  }
  else if (e.key === 'Enter' && e.target.dataset?.rd !== undefined && !e.isComposing) act('reject', { id: state.ref }); // 한글 조합 중의 Enter는 글자를 확정하는 키라 제외
  else segArrowKeys(e, (btn) => act(btn.dataset.action, btn.dataset));
});
// 입력칸은 다시 그리지 않고 값만 기억한다(타이핑 중 초점을 잃지 않게)
document.addEventListener('input', (e) => {
  if (e.target.dataset?.cf) setup.create[e.target.dataset.cf] = e.target.value;
  if (e.target.dataset?.claim !== undefined && state.disputeDraft?.picks) state.disputeDraft.picks[e.target.dataset.claim] = e.target.value;
  if (e.target.dataset?.rd !== undefined && state.rejectDraft) state.rejectDraft.reason = e.target.value;
  if (e.target.dataset?.pf && state.payoutDraft) state.payoutDraft[e.target.dataset.pf] = e.target.value;
  agentPanel.onInput(e.target);
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
  agentPanel.onChange(e.target);
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
    state.focusLine = null;
    state.ref = null;
    state.disputeDraft = null;
    state.payoutFromAgent = false;
    state.rejectDraft = null;
    state.transferNote = null;
    state.pendingSend = null; // 시트를 닫으면 송금 앱에서 돌아왔는지 더는 묻지 않는다
    // QR 토큰은 버린다. 다시 열면 새로 받는다
    state.qr = null;
    clearTimeout(qrTimer);
    qrAsked = { id: null, at: 0 };
  },
});
// 안내가 올라오는 만큼 아래 시트가 작아지며 물러난다(style.css의 --behind)
const guide = createSheet($('#guide-root'), { onTravel: (p) => $('#sheet').style.setProperty('--behind', p.toFixed(3)) });
const nav = $('#nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 56), { passive: true });
addEventListener('resize', () => {
  resetSegs();
  mountSegs(document);
});
// 송금 시트는 그릴 때 컴퓨터인지 보고 QR이나 슬라이더 중 하나만 둔다. 연 채로 포인터가 바뀌면
// (iPad에서 키보드를 떼거나 붙일 때 등) 맞는 쪽으로 다시 그린다
matchMedia(COMPUTER_QUERY).addEventListener('change', () => {
  if (state.sheet === 'transfer') renderSheet();
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
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('[data-select-all]')) e.target.select(); // 초대 링크 칸은 누르면 통째로 고른다
});
try {
  await initAuth();
  if (roomId) {
    // 로그인하지 않았으면 계정 화면에서 로그인한 뒤 이 방으로 돌아온다(next)
    if (!authOptions().dev && !currentUid()) location.replace(`account.html?next=${encodeURIComponent(`room.html${location.search}`)}`);
    else { await load(); if (currentUid()) watch(); }
  } else {
    // 방 만들기·초대 화면은 이 자리에서 로그인한다. 로그인하면 내 프로필(이름·색)을 불러와 다시 그린다
    await loadProfile();
    if (inviteToken) await loadInvite();
    else render();
  }
  const sessionUid = currentUid();
  onSessionChange(user => {
    if (!roomId) return void loadProfile().then(render);
    if (!user || user.uid !== sessionUid) { unsubscribe(); state.data = null; state.events = []; location.replace('account.html'); }
  });
} catch (e) { state.error = e; render(); }
