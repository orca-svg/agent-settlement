// 내 비서 설정 화면(#5): 규칙, 기억, 받을 계좌, 규칙 변경 기록, 처음 설정 흐름. 방 화면의 시트로 열린다.
// 판단과 저장은 서버(src/agents/settings.mjs)가 하고, 여기서는 그리고 고른 값만 보낸다. import할 때 DOM을 건드리지 않는다.
// 화면 원칙: 항상 보이는 버튼은 꼭 필요한 것만 둔다. 저장은 바꿨을 때만, 기억 고치기·지우기는 기억을 눌렀을 때만 나온다.
import { esc, CHEVRON } from './ui.js';
import { won } from './core.js';
import { AUTO_ACCEPT_PRESETS, AUTO_ACCEPT_MAX, MEMORY_MAX_CHARS, MANUAL_WAIT_DAYS, NOTIFY, DEFAULT_RULES, sendWhenLabel, autoAcceptLabel } from './agent-rules.js';

const DISPUTE_NOTES = {
  ask: '내가 낸 지출에 이의가 오면 나에게 물어봐요.',
  evidence: '내 몫을 줄일 근거가 있으면 비서가 대신 이의를 내요.',
  mediator: '내가 낸 지출에 이의가 오면 중재 비서에게 맡겨요. 결과에는 내가 동의해야 해요.',
};
const SEND_MODES = [['now', '바로'], ['payday', '지정일'], ['manual', '편할 때']];
const SEND_NOTES = {
  now: '',
  payday: '그날 오전 9시에 알려 드려요. 그달에 그날이 없으면 마지막 날에 알려요.',
  manual: `내가 편할 때 보내요. ${MANUAL_WAIT_DAYS}일이 지나도 받는 사람이 받았다고 하지 않으면 한 번 알려 드려요.`,
};

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
const clockText = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

export const draftFromRules = (r) => ({
  autoAccept: String(r.autoAccept),
  mode: r.sendWhen?.payday ? 'payday' : r.sendWhen,
  payday: r.sendWhen?.payday ?? 25,
  onDispute: r.onDispute,
  notify: r.notify,
});
export const rulesFromDraft = (d) => ({
  autoAccept: Number(onlyDigits(d.autoAccept)),
  sendWhen: d.mode === 'payday' ? { payday: Number(d.payday) } : d.mode,
  onDispute: d.onDispute,
  notify: d.notify,
});

const seg = (key, field, options, value) => `<div class="seg" role="radiogroup" aria-label="${esc(key)}" data-seg="agent-${esc(field)}"><span class="seg-thumb"></span>
  ${options.map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === value}" data-action="agent-set" data-field="${esc(field)}" data-id="${esc(id)}">${esc(label)}</button>`).join('')}</div>`;
const note = (text, id = '') => (text ? `<p class="group-note"${id ? ` id="${id}"` : ''}>${esc(text)}</p>` : '');

export function limitNote(d) {
  const n = Number(onlyDigits(d.autoAccept));
  if (n > AUTO_ACCEPT_MAX) return `한도는 ${won(AUTO_ACCEPT_MAX)}까지 정할 수 있어요.`;
  return n > 0 ? `${won(n)} 이하는 비서가 받고, 넘으면 나에게 물어봐요.` : '모든 청구서를 나에게 물어봐요.';
}
// 처음 설정은 금액 버튼으로 빠르게, 설정 화면은 정확한 금액을 입력한다
export function limitPresetsHtml(d) {
  const presets = AUTO_ACCEPT_PRESETS.map((n) => `<button type="button" class="pick" aria-pressed="${Number(onlyDigits(d.autoAccept)) === n}" data-action="agent-preset" data-id="${n}">${n ? won(n) : '항상 묻기'}</button>`).join('');
  return `<div class="picks agent-presets">${presets}</div>${note(limitNote(d))}`;
}
export function limitInputHtml(d) {
  return `<div class="list"><label class="row field"><span class="grow">금액</span><input data-ag="autoAccept" value="${esc(d.autoAccept)}" inputmode="numeric" maxlength="9" aria-label="자동 수락 한도(원)" placeholder="0"><span class="meta">원</span></label></div>
    ${note(limitNote(d), 'agent-limit-note')}`;
}
export function sendHtml(d) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}"${Number(d.payday) === n ? ' selected' : ''}>${n}일</option>`).join('');
  return `${seg('보낼 시기', 'mode', SEND_MODES, d.mode)}
    ${d.mode === 'payday' ? `<div class="list" style="margin-top:8px"><label class="row field"><span class="grow">매달</span><select data-ag="payday" aria-label="보낼 날짜">${days}</select></label></div>` : ''}
    ${note(SEND_NOTES[d.mode])}`;
}
export function disputeHtml(d) {
  return `${seg('이의 처리', 'onDispute', [['ask', '묻기'], ['evidence', '근거 있으면 이의'], ['mediator', '중재 비서']], d.onDispute)}
    ${note(DISPUTE_NOTES[d.onDispute])}`;
}
export const notifyHtml = (d) => seg('알림 수준', 'notify', Object.entries(NOTIFY), d.notify);

// 기억 한 줄에는 글과 공유 여부만 둔다. 글을 누르면 그 줄에서 고치거나 지운다.
// 공유해도 방 사람에게 기억 내용이 보이지는 않는다(배분 이유에 싣지 않고, 이의 중재에서만 근거로 쓰인다)
export function memoryRowsHtml(view, roomId, ui = {}) {
  const hidden = new Set(view.memoryHidden?.[roomId] ?? []);
  if (!view.memory.length) return '<p class="empty">아직 기억이 없어요.</p>';
  return view.memory.map((m, i) => {
    if (ui.editing === m) {
      return `<div class="row agent-mem editing"><input data-mem-edit value="${esc(ui.editText ?? m)}" maxlength="${MEMORY_MAX_CHARS}" aria-label="기억 고치기">
        <button type="button" class="btn sm" data-action="mem-edit-save">저장</button><button type="button" class="btn sm plain danger-text" data-action="mem-del" data-i="${i}">지우기</button></div>`;
    }
    const shared = !hidden.has(m);
    return `<div class="row agent-mem"><button type="button" class="agent-mem-text" data-action="mem-edit" data-i="${i}" aria-label="‘${esc(m)}’ 고치거나 지우기">${esc(m)}</button>
      <button type="button" class="pick" aria-pressed="${shared}" data-action="mem-share" data-i="${i}" aria-label="이 방에 ‘${esc(m)}’ 공유">${shared ? '공유 중' : '공유 안 함'}</button></div>`;
  }).join('');
}

// 방 비서 설정의 규칙 한 칸. 내 계정의 기본 설정을 따를지, 이 방에서만 다른 값을 쓸지 고른다.
// 기본 설정을 따르는 동안은 그 값을 글로만 보여 주고, '이 방에서만'일 때 값을 고치는 칸(body)이 나온다
const ROOM_FIELDS = ['autoAccept', 'sendWhen', 'onDispute'];
export function roomRuleHtml(field, { custom, defaultText, body }) {
  const choice = `<div class="seg" role="radiogroup" aria-label="적용할 값" data-seg="room-${esc(field)}"><span class="seg-thumb"></span>
    ${[['default', '기본 설정'], ['room', '이 방에서만']].map(([id, label]) => `<button type="button" role="radio" aria-checked="${(id === 'room') === custom}" data-action="room-rule-scope" data-field="${esc(field)}" data-id="${id}">${label}</button>`).join('')}</div>`;
  return `${choice}<div class="room-rule-body">${custom ? body : note(`기본 설정: ${defaultText}`)}</div>`;
}
const DEFAULT_TEXT = {
  autoAccept: (r) => limitNote({ autoAccept: String(r.autoAccept) }),
  sendWhen: (r) => `${sendWhenLabel(r.sendWhen)}.`,
  onDispute: (r) => DISPUTE_NOTES[r.onDispute],
};

export function historyHtml(view) {
  if (!view.ruleHistory.length) return '';
  return `<section class="group"><details class="agent-history"><summary>규칙 변경 기록 ${view.ruleHistory.length}개</summary>
    <ol>${[...view.ruleHistory].reverse().map((h) => `<li><span>${esc(h.text)}</span><time>${esc(clockText(h.at))}</time></li>`).join('')}</ol></details></section>`;
}

// 비서 설정을 마친 사람의 이름 옆 로봇 표시. 방 사람 누구나 보지만 '설정을 마쳤다'는 사실만 담는다.
// 아이콘: Lucide 'bot'(lucide-static 0.460.0). ISC License, Copyright (c) Lucide Contributors 2022, portions Copyright (c) Cole Bemis 2013-2022 (Feather, MIT). https://lucide.dev/license
export const AGENT_MARK = '<span class="agent-mark" role="img" aria-label="비서 설정함" title="비서 설정을 마쳤어요">'
  + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg></span>';

// 방 머리의 다른 사람 칩. 누를 수 없고, 비서 설정을 마쳤으면 로봇 표시만 붙는다
export const personChipHtml = ({ name, avatar, ready }) => `<span class="person">${avatar}${esc(name)}${ready ? AGENT_MARK : ''}</span>`;

// 방 머리의 내 칩은 '내 비서' 입구를 겸한다. 설정은 내 칩에서만 열리고(화살표·호버로 알린다),
// 처음 설정 전이거나 받을 계좌가 없으면 작은 꼬리표를 글자로 붙인다. 규칙 요약은 툴팁과 읽어 주기 글로 둔다
export function meChipHtml({ name, avatar }, s) {
  if (!s) return `<span class="person">${avatar}${esc(name)}</span>`;
  const tag = !s.onboarded ? '설정 전' : !s.hasPayout ? '계좌 없음' : '';
  const rules = `${autoAcceptLabel(s.autoAccept)} · ${sendWhenLabel(s.sendWhen)}`;
  // 처음 설정 전이면 칩이 바로 처음 설정을 연다(방 안에 큰 안내 카드를 띄우지 않는다)
  return `<button type="button" class="person me" data-action="${s.onboarded ? 'open-agent' : 'open-agent-setup'}" title="내 비서: ${esc(rules)}" aria-label="내 비서 열기. ${esc(rules)}${tag ? `. ${tag}` : ''}">${avatar}${esc(name)}`
    + `${s.onboarded ? AGENT_MARK : ''}${tag ? `<span class="person-tag">${tag}</span>` : ''}${CHEVRON}</button>`;
}

const ACTIONS = new Set(['open-agent', 'open-agent-setup', 'room-rule-scope', 'agent-set', 'agent-preset', 'agent-save-rules', 'mem-add', 'mem-edit', 'mem-edit-save', 'mem-del', 'mem-share', 'agent-payout', 'setup-next', 'setup-back', 'setup-skip', 'setup-done']);

export function createAgentPanel({ api, roomId, summary, meName, rerender, openSheet, closeSheet, reload, openPayout }) {
  // errorAt·noticeAt: 글을 누른 버튼 가까이에 보여 주려고 어느 구역의 글인지 기억한다(시트가 길어서 맨 위에 두면 안 보인다)
  // draft: 방 시트에서는 이 방에서 쓰는 값(기본 설정 + 이 방 값), 처음 설정에서는 기본 설정. custom: 이 방에서만 정한 칸
  const ui = { view: null, draft: null, custom: new Set(), memDraft: '', editing: null, editText: '', error: '', errorAt: 'top', notice: '', noticeAt: 'rules', busy: false, step: 0 };
  const ownRules = () => ui.view?.roomRules?.[roomId] ?? {};
  const resetDraft = () => {
    ui.custom = new Set(ROOM_FIELDS.filter((f) => ownRules()[f] !== undefined));
    ui.draft = draftFromRules({ ...ui.view.rules, ...ownRules() });
  };
  // 보낼 것: 이 방에서만 정한 칸은 값, 기본 설정을 따르는 칸은 null(비우기)
  const roomInput = () => {
    const r = rulesFromDraft(ui.draft);
    return Object.fromEntries(ROOM_FIELDS.map((f) => [f, ui.custom.has(f) ? r[f] : null]));
  };
  const dirty = () => Boolean(ui.view && ui.draft) && JSON.stringify(roomInput()) !== JSON.stringify(Object.fromEntries(ROOM_FIELDS.map((f) => [f, ownRules()[f] ?? null])));
  const errorHtml = (at) => (ui.error && ui.errorAt === at ? `<p class="form-error" role="alert" style="margin-top:10px">${esc(ui.error)}</p>` : '');
  const noticeHtml = (at) => (ui.notice && ui.noticeAt === at ? `<p class="group-note agent-status" role="status">${esc(ui.notice)}</p>` : '');

  // 서버에 보내고 돌아온 설정으로 화면을 맞춘다. 실패하면 글을 보여 주고 고른 값은 그대로 둔다
  async function send(path, body, { notice = '', at = 'memory' } = {}) {
    if (ui.busy) return false;
    ui.busy = true;
    try {
      ui.view = await api(path, { method: 'POST', body });
      ui.error = '';
      ui.notice = notice;
      ui.noticeAt = at;
      return true;
    } catch (e) {
      ui.error = e.message;
      ui.errorAt = at;
      ui.notice = '';
      return false;
    } finally {
      ui.busy = false;
      await reload();
      rerender();
    }
  }
  const mem = (i) => ui.view.memory[Number(i)];

  async function open(kind = 'agent') {
    ui.error = '';
    ui.errorAt = 'top';
    ui.notice = '';
    ui.editing = null;
    ui.memDraft = '';
    ui.step = 0;
    try {
      ui.view = await api('/api/me/agent');
      if (kind === 'agent-setup') ui.draft = draftFromRules(ui.view.rules);
      else resetDraft();
    } catch (e) {
      ui.view = null;
      ui.draft = null;
      ui.error = e.message;
    }
    openSheet(kind);
  }

  // 방에서 여는 내 비서: 이 방에서 쓸 규칙(기본 설정 / 이 방에서만), 기억 공유, 받을 계좌.
  // 기본 설정 자체와 알림·규칙 변경 기록은 내 계정의 '내 비서 기본 설정'에서 바꾼다
  function agentSheet() {
    const v = ui.view;
    if (!v) return { title: '내 비서', html: errorHtml('top') };
    const d = ui.draft;
    const full = v.memory.length >= v.memoryLimit;
    const payout = v.payout
      ? `<div class="row"><span class="grow"><span class="title">${esc(v.payout.bank)} •••• ${esc(v.payout.last4)}</span></span><button type="button" class="btn sm secondary" data-action="agent-payout">바꾸기</button></div>`
      : '<div class="row"><span class="grow">아직 받을 계좌가 없어요</span><button type="button" class="btn sm" data-action="agent-payout">등록</button></div>';
    const rule = (field, label, body) => `<section class="group"><h3 class="group-label"><span>${label}</span></h3>
      ${roomRuleHtml(field, { custom: ui.custom.has(field), defaultText: DEFAULT_TEXT[field](v.rules), body })}</section>`;
    return {
      title: `${meName()}의 비서`,
      html: `<p class="group-note" style="margin:0 0 16px">모든 방에는 내 계정의 기본 설정이 쓰여요. 이 방에만 다르게 하고 싶은 규칙은 ‘이 방에서만’을 골라요. <a href="account.html#agent">기본 설정 바꾸기</a></p>
        ${rule('autoAccept', '자동 수락 한도', limitInputHtml(d))}
        ${rule('sendWhen', '보낼 시기', sendHtml(d))}
        ${rule('onDispute', '이의 처리', disputeHtml(d))}
        <div id="agent-save-wrap" class="agent-save" ${dirty() ? '' : 'hidden'}>
          <button class="btn" id="agent-save" style="width:100%" data-action="agent-save-rules" ${ui.busy ? 'disabled' : ''}>이 방 규칙 저장</button>
          <p class="group-note">이 방의 다음 청구서부터 적용돼요. 다른 방은 그대로예요.</p></div>
        ${errorHtml('rules')}${noticeHtml('rules')}
        <section class="group"><h3 class="group-label"><span>기억 ${v.memory.length}/${v.memoryLimit}</span></h3>
          <div class="list">${memoryRowsHtml(v, roomId, ui)}</div>
          ${full ? `<p class="group-note">무료 요금제는 ${v.memoryLimit}개까지예요. 기억을 눌러 지우면 더할 수 있어요.</p>`
            : `<div class="mem-add"><input data-mem value="${esc(ui.memDraft)}" maxlength="${MEMORY_MAX_CHARS}" placeholder="예: 술을 마시지 않아요" aria-label="새 기억"><button type="button" class="btn sm" data-action="mem-add">더하기</button></div>`}
          ${errorHtml('memory')}${noticeHtml('memory')}
          <p class="group-note">기억을 누르면 고치거나 지울 수 있어요. 공유한 기억만 이 방의 배분과 중재에 쓰여요. 방 사람들에게 기억 내용은 보이지 않고, 이의를 중재할 때만 근거로 인용될 수 있어요.</p></section>
        <section class="group"><h3 class="group-label"><span>받을 계좌</span></h3><div class="list">${payout}</div>
          <p class="group-note">계좌는 모든 방에 같아요. 바꾸면 내가 받을 모든 방의 대기 중 송금에 적용돼요.</p></section>`,
    };
  }

  function setupSheet() {
    const d = ui.draft;
    if (!d) return { title: '비서 설정', html: errorHtml('top') };
    const step = [
      ['얼마까지 비서가 받을까요?', limitPresetsHtml(d)],
      ['돈은 언제 보낼까요?', sendHtml(d)],
      ['이의는 어떻게 할까요?', disputeHtml(d)],
    ];
    const last = ui.step === step.length - 1;
    return {
      title: '내 비서 설정',
      html: `<div class="agent-setup"><p class="group-note" style="margin-top:0">한 번 정하면 모든 방에 기본으로 쓰여요. 방마다 다르게 하고 싶은 것은 그 방에서 ‘이 방에서만’으로 바꾸고, 기본 설정은 내 계정에서 언제든 바꿔요.</p><p class="eyebrow agent-step">${ui.step + 1}/${step.length}단계</p><h3 class="agent-q">${esc(step[ui.step][0])}</h3>
        ${step[ui.step][1]}${errorHtml('setup')}
        <div class="agent-nav">${ui.step ? '<button type="button" class="btn plain" data-action="setup-back">이전</button>' : ''}
          <button type="button" class="btn" style="flex:1" data-action="${last ? 'setup-done' : 'setup-next'}" ${ui.busy ? 'disabled' : ''}>${last ? '시작하기' : '다음'}</button></div>
        ${ui.step ? '' : '<p class="group-note" style="text-align:center"><button type="button" class="text-btn" data-action="setup-skip">기본값으로 시작</button></p>'}</div>`,
    };
  }

  const addMemory = async () => {
    if (await send('/api/me/agent/memory', { text: ui.memDraft })) ui.memDraft = '';
    rerender();
  };
  const saveEdit = async () => {
    if (await send('/api/me/agent/memory/edit', { from: ui.editing, to: ui.editText })) ui.editing = null;
    rerender();
  };

  async function act(name, d) {
    if (name === 'open-agent') return open('agent');
    if (name === 'open-agent-setup') return open('agent-setup');
    if (name === 'agent-set' || name === 'agent-preset') {
      if (name === 'agent-set') ui.draft[d.field] = d.id;
      else ui.draft.autoAccept = d.id;
      ui.notice = '';
      ui.error = '';
      return rerender();
    }
    if (name === 'agent-save-rules') {
      if (await send(`/api/rooms/${encodeURIComponent(roomId)}/agent/rules`, roomInput(), { notice: '이 방 규칙을 저장했어요.', at: 'rules' })) resetDraft();
      return rerender();
    }
    // 이 방에서만으로 바꾸면 지금 값(기본 설정)에서 고치기 시작하고, 기본 설정으로 돌리면 그 칸을 기본 설정 값으로 되돌린다
    if (name === 'room-rule-scope') {
      if (d.id === 'room') ui.custom.add(d.field);
      else {
        ui.custom.delete(d.field);
        const base = draftFromRules(ui.view.rules);
        if (d.field === 'sendWhen') Object.assign(ui.draft, { mode: base.mode, payday: base.payday });
        else ui.draft[d.field] = base[d.field];
      }
      ui.notice = '';
      ui.error = '';
      return rerender();
    }
    if (name === 'mem-add') return addMemory();
    if (name === 'mem-edit') {
      ui.editing = mem(d.i);
      ui.editText = ui.editing;
      ui.error = '';
      ui.notice = '';
      return rerender();
    }
    if (name === 'mem-edit-save') return saveEdit();
    if (name === 'mem-del') {
      const text = mem(d.i);
      ui.editing = null;
      return send('/api/me/agent/memory/delete', { text });
    }
    if (name === 'mem-share') {
      const text = mem(d.i);
      const hidden = (ui.view.memoryHidden?.[roomId] ?? []).includes(text);
      // 끌 때만 안내한다. 이미 나눈 지출은 다시 나누기 전까지 그대로다
      return send(`/api/rooms/${encodeURIComponent(roomId)}/agent/shared`, { text, shared: hidden }, { notice: hidden ? '' : '이미 나눈 지출은 다시 나눌 때부터 반영돼요.' });
    }
    if (name === 'agent-payout') return openPayout(ui.view.payout);
    if (name === 'setup-next' || name === 'setup-back') {
      ui.error = '';
      ui.step += name === 'setup-next' ? 1 : -1;
      return rerender();
    }
    if (name === 'setup-skip' || name === 'setup-done') {
      const rules = name === 'setup-done' ? rulesFromDraft(ui.draft) : DEFAULT_RULES;
      if (await send('/api/me/agent/onboarding', { rules }, { at: 'setup' })) closeSheet();
      return undefined;
    }
    return undefined;
  }

  return {
    sheets: { agent: agentSheet, 'agent-setup': setupSheet },
    handles: (name) => ACTIONS.has(name),
    act,
    open: () => open('agent'),
    chipHtml: (member, avatar) => meChipHtml({ name: member.name, avatar }, summary()),
    // 비서는 사람마다 하나라 방마다 묻지 않는다. 처음 설정은 내 칩의 '설정 전' 꼬리표로 들어간다
    nudgeHtml: () => '',
    // 입력칸은 다시 그리지 않고 값만 기억한다(타이핑 중 초점을 잃지 않게)
    onInput(el) {
      if (el.dataset?.ag === 'autoAccept' && ui.draft) {
        el.value = onlyDigits(el.value);
        ui.draft.autoAccept = el.value;
        const limit = document.querySelector('#agent-limit-note');
        if (limit) limit.textContent = limitNote(ui.draft);
        const wrap = document.querySelector('#agent-save-wrap');
        if (wrap) wrap.hidden = !dirty();
      }
      if (el.dataset?.mem !== undefined) ui.memDraft = el.value;
      if (el.dataset?.memEdit !== undefined) ui.editText = el.value;
    },
    onChange(el) {
      if (el.dataset?.ag === 'payday' && ui.draft) {
        ui.draft.payday = Number(el.value);
        ui.notice = '';
        rerender();
      }
    },
    // 기억 칸에서 Enter로 바로 저장한다. 한글 조합을 끝내는 Enter는 저장으로 치지 않는다
    onKeydown(e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      if (e.target.dataset?.mem !== undefined) {
        e.preventDefault();
        addMemory();
      } else if (e.target.dataset?.memEdit !== undefined) {
        e.preventDefault();
        saveEdit();
      }
    },
  };
}
