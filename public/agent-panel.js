// 내 비서 설정 화면(#5): 규칙, 기억, 받을 계좌, 규칙 변경 기록, 처음 설정 흐름. 방 화면의 시트로 열린다.
// 판단과 저장은 서버(src/agents/settings.mjs)가 하고, 여기서는 그리고 고른 값만 보낸다. import할 때 DOM을 건드리지 않는다.
import { esc, chip } from './ui.js';
import { won } from './core.js';
import { AUTO_ACCEPT_PRESETS, AUTO_ACCEPT_MAX, MEMORY_MAX_CHARS, ON_DISPUTE, NOTIFY, DEFAULT_RULES, sendWhenLabel, autoAcceptLabel } from './agent-rules.js';

const DISPUTE_NOTES = {
  ask: '내가 낸 지출에 이의가 오면 비서가 나에게 물어요. 비서가 먼저 이의를 내지는 않아요.',
  evidence: '내 몫을 깎을 근거가 있으면 비서가 대신 이의를 내요. 근거가 없으면 한도대로 처리하고, 내가 낸 지출에 온 이의는 나에게 물어요.',
  mediator: '내가 낸 지출에 이의가 오면 바로 중재 비서에게 맡겨요. 중재안에는 내가 동의해야 해요.',
};
const SEND_MODES = [['now', '바로'], ['payday', '지정일'], ['manual', '직접']];
const SEND_NOTES = {
  now: '청구가 끝나면 바로 보낼 때라고 알려 드려요.',
  payday: '정한 날 오전 9시에 알려 드려요. 그달에 그날이 없으면 마지막 날에 알려요.',
  manual: '비서가 알리지 않아요. 방에서 내가 편할 때 보내요.',
};

const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
const clockText = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
const maskAccount = (n) => {
  const d = onlyDigits(n);
  return d.length > 4 ? `•••• ${d.slice(-4)}` : d;
};

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

// 한도·시기·이의는 설정 화면과 처음 설정이 같은 조각을 쓴다
export function limitHtml(d) {
  const presets = AUTO_ACCEPT_PRESETS.map((n) => `<button type="button" class="pick" aria-pressed="${Number(onlyDigits(d.autoAccept)) === n}" data-action="agent-preset" data-id="${n}">${n ? won(n) : '항상 묻기'}</button>`).join('');
  return `<div class="picks agent-presets">${presets}</div>
    <div class="list" style="margin-top:8px"><label class="row field"><span class="grow">직접 입력</span><input data-ag="autoAccept" value="${esc(d.autoAccept)}" inputmode="numeric" maxlength="9" aria-label="자동 수락 한도(원)" placeholder="0"><span class="meta">원</span></label></div>
    <p class="group-note" id="agent-limit-note">${esc(limitNote(d))}</p>`;
}
export function limitNote(d) {
  const n = Number(onlyDigits(d.autoAccept));
  if (n > AUTO_ACCEPT_MAX) return `한도는 ${won(AUTO_ACCEPT_MAX)}까지 정할 수 있어요.`;
  return n > 0 ? `내가 낼 돈이 ${won(n)} 이하면 비서가 받고, 넘으면 예외 없이 나에게 물어요.` : '모든 청구서를 비서가 먼저 나에게 물어요.';
}
export function sendHtml(d) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1).map((n) => `<option value="${n}"${Number(d.payday) === n ? ' selected' : ''}>${n}일</option>`).join('');
  return `${seg('보낼 시기', 'mode', SEND_MODES, d.mode)}
    ${d.mode === 'payday' ? `<div class="list" style="margin-top:8px"><label class="row field"><span class="grow">매달</span><select data-ag="payday" aria-label="보낼 날짜">${days}</select></label></div>` : ''}
    <p class="group-note">${esc(SEND_NOTES[d.mode])}</p>`;
}
export function disputeHtml(d) {
  return `${seg('이의 처리', 'onDispute', [['ask', '묻기'], ['evidence', '근거 있으면 이의'], ['mediator', '중재 비서']], d.onDispute)}
    <p class="group-note"><b>${esc(ON_DISPUTE[d.onDispute])}</b> · ${esc(DISPUTE_NOTES[d.onDispute])}</p>`;
}

export function memoryRowsHtml(view, roomId, ui = {}) {
  const hidden = new Set(view.memoryHidden?.[roomId] ?? []);
  if (!view.memory.length) return '<p class="empty">아직 기억이 없어요. 메뉴를 나눌 때 비서가 근거 없는 줄은 나에게 물어요.</p>';
  return view.memory.map((m, i) => {
    if (ui.editing === m) {
      return `<div class="row agent-mem editing"><input data-mem-edit value="${esc(ui.editText ?? m)}" maxlength="${MEMORY_MAX_CHARS}" aria-label="기억 고치기">
        <button type="button" class="btn sm" data-action="mem-edit-save">저장</button><button type="button" class="btn sm plain" data-action="mem-edit-cancel">취소</button></div>`;
    }
    const shared = !hidden.has(m);
    return `<div class="row agent-mem"><span class="grow">${esc(m)}</span>
      <button type="button" class="pick" aria-pressed="${shared}" data-action="mem-share" data-i="${i}" aria-label="이 방에 ‘${esc(m)}’ 공유">${shared ? '이 방에 공유' : '공유 안 함'}</button>
      <button type="button" class="text-btn" data-action="mem-edit" data-i="${i}" aria-label="‘${esc(m)}’ 고치기">고치기</button>
      <button type="button" class="text-btn danger-text" data-action="mem-del" data-i="${i}" aria-label="‘${esc(m)}’ 지우기">${ui.armed === m ? '한 번 더' : '지우기'}</button></div>`;
  }).join('');
}

export function historyHtml(view) {
  if (!view.ruleHistory.length) return '<p class="group-note">아직 바꾼 규칙이 없어요.</p>';
  return `<details class="agent-history"><summary>규칙 변경 기록 ${view.ruleHistory.length}개</summary>
    <ol>${[...view.ruleHistory].reverse().map((h) => `<li><span>${esc(h.text)}</span><time>${esc(clockText(h.at))}</time></li>`).join('')}</ol></details>`;
}

export function rowHtml(s) {
  if (!s) return '';
  return `<section class="group"><h2 class="group-label"><span>내 비서</span><span>${esc(`기억 ${s.sharedCount}/${s.memoryCount}개 공유 중`)}</span></h2>
    <div class="list"><button class="row" data-action="open-agent"><span class="grow"><span class="title">${esc(autoAcceptLabel(s.autoAccept))}</span>
      <span class="meta" style="display:block">${esc(sendWhenLabel(s.sendWhen))} · 이의는 ${esc(ON_DISPUTE[s.onDispute])} · 알림 ${esc(NOTIFY[s.notify])}</span></span>
      ${s.hasPayout ? '' : chip('받을 계좌 없음', 'warn')}<svg class="chev" width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div></section>`;
}

const ACTIONS = new Set(['open-agent', 'open-agent-setup', 'agent-set', 'agent-preset', 'agent-save-rules', 'mem-add', 'mem-edit', 'mem-edit-save', 'mem-edit-cancel', 'mem-del', 'mem-share', 'agent-payout', 'setup-next', 'setup-back', 'setup-skip', 'setup-done']);

export function createAgentPanel({ api, roomId, summary, meName, rerender, openSheet, closeSheet, reload, openPayout }) {
  const ui = { view: null, draft: null, memDraft: '', editing: null, editText: '', armed: null, error: '', notice: '', busy: false, step: 0 };
  const dirty = () => ui.view && ui.draft && JSON.stringify(rulesFromDraft(ui.draft)) !== JSON.stringify(rulesFromDraft(draftFromRules(ui.view.rules)));
  const errorHtml = () => (ui.error ? `<p class="form-error" role="alert">${esc(ui.error)}</p>` : '');
  const noticeHtml = () => (ui.notice ? `<p class="preview-note" role="status" style="margin-bottom:12px">${esc(ui.notice)}</p>` : '');

  // 서버에 보내고 돌아온 설정으로 화면을 맞춘다. 실패하면 글을 보여 주고 고른 값은 그대로 둔다
  async function send(path, body, { notice = '' } = {}) {
    if (ui.busy) return false;
    ui.busy = true;
    try {
      ui.view = await api(path, { method: 'POST', body });
      ui.error = '';
      ui.notice = notice;
      return true;
    } catch (e) {
      ui.error = e.message;
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
    ui.notice = '';
    ui.editing = null;
    ui.armed = null;
    ui.step = 0;
    try {
      ui.view = await api('/api/me/agent');
      ui.draft = draftFromRules(ui.view.rules);
    } catch (e) {
      ui.view = null;
      ui.draft = null;
      ui.error = e.message;
    }
    openSheet(kind);
  }

  function agentSheet() {
    const v = ui.view;
    if (!v) return { title: '내 비서', html: errorHtml() };
    const d = ui.draft;
    const full = v.memory.length >= v.memoryLimit;
    const payout = v.payout
      ? `<div class="row"><span class="grow"><span class="title">${esc(v.payout.bank)} ${esc(maskAccount(v.payout.accountNo))}</span><span class="meta" style="display:block">예금주 ${esc(v.payout.holder || '-')}</span></span><button type="button" class="btn sm secondary" data-action="agent-payout">바꾸기</button></div>`
      : '<div class="row"><span class="grow">아직 받을 계좌가 없어요</span><button type="button" class="btn sm" data-action="agent-payout">등록</button></div>';
    return {
      title: `${meName()}의 비서`,
      html: `<p class="how">비서가 알아서 하되, 어디까지 할지는 내가 정해요.</p>
        ${noticeHtml()}${errorHtml()}
        <section class="group"><h3 class="group-label"><span>자동 수락 한도</span></h3>${limitHtml(d)}</section>
        <section class="group"><h3 class="group-label"><span>보낼 시기</span></h3>${sendHtml(d)}</section>
        <section class="group"><h3 class="group-label"><span>이의 처리</span></h3>${disputeHtml(d)}</section>
        <section class="group"><h3 class="group-label"><span>알림</span></h3>${seg('알림 수준', 'notify', Object.entries(NOTIFY), d.notify)}
          <p class="group-note">상단 종에 올릴 기록을 정해요. 비서끼리 기록은 어느 쪽이든 모두 남아요.</p></section>
        <button class="btn" id="agent-save" style="width:100%;margin-bottom:6px" data-action="agent-save-rules" ${dirty() && !ui.busy ? '' : 'disabled'}>규칙 저장</button>
        <p class="group-note" style="margin-bottom:22px">바꾼 규칙은 다음 청구서부터 적용돼요. 보낼 시기는 아직 보내지 않은 송금에도 바로 적용돼요.</p>
        <section class="group"><h3 class="group-label"><span>비서의 기억 ${v.memory.length}/${v.memoryLimit}</span><span>무료 요금제</span></h3>
          <div class="list">${memoryRowsHtml(v, roomId, ui)}</div>
          <div class="mem-add"><input data-mem value="${esc(ui.memDraft)}" maxlength="${MEMORY_MAX_CHARS}" placeholder="${full ? '기억이 가득 찼어요' : '예: 술을 마시지 않아요'}" aria-label="새 기억" ${full ? 'disabled' : ''}>
            <button type="button" class="btn sm" data-action="mem-add" ${full ? 'disabled' : ''}>더하기</button></div>
          <p class="group-note">공유한 기억만 이 방의 메뉴 배분과 중재에 쓰여요. 방의 다른 사람도 배분 이유에서 볼 수 있으니, 보이고 싶지 않으면 꺼 주세요.</p></section>
        <section class="group"><h3 class="group-label"><span>받을 계좌</span></h3><div class="list">${payout}</div>
          <p class="group-note">계좌는 하나예요. 바꾸면 내가 받을 모든 방의 대기 중 송금에 새 계좌가 들어가요.</p></section>
        <section class="group">${historyHtml(v)}</section>
        <button type="button" class="text-btn" data-action="open-agent-setup">처음 설정 다시 하기</button>`,
    };
  }

  function setupSheet() {
    const d = ui.draft;
    if (!d) return { title: '비서 설정', html: errorHtml() };
    const step = [
      ['얼마까지 비서가 받을까요?', limitHtml(d)],
      ['돈은 언제 보낼까요?', sendHtml(d)],
      ['이의는 어떻게 할까요?', `${disputeHtml(d)}
        <section class="group" style="margin-top:18px"><h3 class="group-label"><span>비서에게 알려 줄 기억</span><span>선택</span></h3>
          <div class="list"><label class="row field"><input data-mem value="${esc(ui.memDraft)}" maxlength="${MEMORY_MAX_CHARS}" style="text-align:left" placeholder="예: 술을 마시지 않아요" aria-label="비서에게 알려 줄 기억"></label></div></section>`],
    ];
    const last = ui.step === step.length - 1;
    return {
      title: '비서 설정',
      html: `<p class="eyebrow agent-step">${ui.step + 1}/${step.length}단계</p><h3 class="agent-q">${esc(step[ui.step][0])}</h3>
        ${step[ui.step][1]}${errorHtml()}
        <div class="agent-nav">${ui.step ? '<button type="button" class="btn plain" data-action="setup-back">이전</button>' : ''}
          <button type="button" class="btn" style="flex:1" data-action="${last ? 'setup-done' : 'setup-next'}" ${ui.busy ? 'disabled' : ''}>${last ? '이대로 시작' : '다음'}</button></div>
        <p class="group-note" style="text-align:center"><button type="button" class="text-btn" data-action="setup-skip">기본값으로 시작</button> · 항상 묻기, ${esc(sendWhenLabel(DEFAULT_RULES.sendWhen))}, ${esc(ON_DISPUTE[DEFAULT_RULES.onDispute])}</p>`,
    };
  }

  async function act(name, d) {
    if (name === 'open-agent') return open('agent');
    if (name === 'open-agent-setup') return open('agent-setup');
    if (name === 'agent-set') {
      ui.draft[d.field] = d.id;
      ui.notice = '';
      return rerender();
    }
    if (name === 'agent-preset') {
      ui.draft.autoAccept = d.id;
      ui.notice = '';
      return rerender();
    }
    if (name === 'agent-save-rules') {
      if (await send('/api/me/agent/rules', rulesFromDraft(ui.draft), { notice: '규칙을 저장했어요.' })) ui.draft = draftFromRules(ui.view.rules);
      return rerender();
    }
    if (name === 'mem-add') {
      if (await send('/api/me/agent/memory', { text: ui.memDraft })) ui.memDraft = '';
      return rerender();
    }
    if (name === 'mem-edit') {
      ui.editing = mem(d.i);
      ui.editText = ui.editing;
      return rerender();
    }
    if (name === 'mem-edit-cancel') {
      ui.editing = null;
      return rerender();
    }
    if (name === 'mem-edit-save') {
      if (await send('/api/me/agent/memory/edit', { from: ui.editing, to: ui.editText })) ui.editing = null;
      return rerender();
    }
    if (name === 'mem-del') {
      const text = mem(d.i);
      // 되돌릴 수 없어서 지출 지우기처럼 한 번 더 눌러야 지운다(3초 안에)
      if (ui.armed !== text) {
        ui.armed = text;
        rerender();
        setTimeout(() => {
          if (ui.armed === text) {
            ui.armed = null;
            rerender();
          }
        }, 3000);
        return undefined;
      }
      ui.armed = null;
      return send('/api/me/agent/memory/delete', { text });
    }
    if (name === 'mem-share') {
      const text = mem(d.i);
      const hidden = (ui.view.memoryHidden?.[roomId] ?? []).includes(text);
      return send(`/api/rooms/${encodeURIComponent(roomId)}/agent/shared`, { text, shared: hidden });
    }
    if (name === 'agent-payout') return openPayout(ui.view.payout);
    if (name === 'setup-next' || name === 'setup-back') {
      ui.error = '';
      ui.step += name === 'setup-next' ? 1 : -1;
      return rerender();
    }
    if (name === 'setup-skip' || name === 'setup-done') {
      const body = name === 'setup-done' ? { rules: rulesFromDraft(ui.draft), memory: ui.memDraft } : {};
      if (await send('/api/me/agent/onboarding', body)) {
        ui.memDraft = '';
        closeSheet();
      }
      return undefined;
    }
    return undefined;
  }

  return {
    sheets: { agent: agentSheet, 'agent-setup': setupSheet },
    handles: (name) => ACTIONS.has(name),
    act,
    open: () => open('agent'),
    rowHtml: () => rowHtml(summary()),
    nudgeHtml: () => (summary() && !summary().onboarded
      ? `<section class="next"><p class="eyebrow">처음 설정</p><h2>내 비서가 어디까지 할지 정해 주세요</h2>
        <p>세 가지만 고르면 끝나요. 정하기 전에는 비서가 모든 청구서를 먼저 나에게 물어요.</p>
        <div class="actions"><button class="btn" data-action="open-agent-setup">설정하기</button></div></section>`
      : ''),
    // 입력칸은 다시 그리지 않고 값만 기억한다(타이핑 중 초점을 잃지 않게)
    onInput(el) {
      if (el.dataset?.ag === 'autoAccept' && ui.draft) {
        el.value = onlyDigits(el.value);
        ui.draft.autoAccept = el.value;
        const note = document.querySelector('#agent-limit-note');
        if (note) note.textContent = limitNote(ui.draft);
        document.querySelectorAll('.agent-presets .pick').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.id) === Number(el.value))));
        const save = document.querySelector('#agent-save');
        if (save) save.disabled = !dirty();
      }
      if (el.dataset?.mem !== undefined) ui.memDraft = el.value;
      if (el.dataset?.memEdit !== undefined) ui.editText = el.value;
    },
    onChange(el) {
      if (el.dataset?.ag === 'payday' && ui.draft) {
        ui.draft.payday = Number(el.value);
        rerender();
      }
    },
  };
}
