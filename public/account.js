// #2 내 계정. 로그인하면 '내 방'이 첫 화면이고, 오른쪽 위 내 아바타를 누르면 '내 계정'(설정) 화면으로 간다.
// 내 계정은 웹 설정 페이지처럼 모든 설정을 한 페이지에 두고(넓은 화면은 왼쪽 목차가 따라온다), 바꾼 것이 있을 때만
// 화면 아래에 저장 막대가 뜬다. 저장하지 않고 떠나려 하면(왼쪽 위 '내 방', 브라우저 뒤로, 탭 닫기) 버릴지 묻는다
import { initAuth, currentUser, login, logout } from './auth.js';
import { api } from './room-api.js';
import { esc, avatarHtml, CHEVRON, GOOGLE_G, ICON_LINK, nextAfterLogin, mountSegs, segArrowKeys } from './ui.js';
import { roomTabs, roomRowsHtml } from './room-list.js';
import { leaveBlock } from './leave.js';
import { toast } from './toast.js';
import { reduceMotion } from './motion.js';
import { profileFormHtml, mountProfileForm, initial } from './profile-form.js';
import { inviteTokenFrom, joinFormHtml } from './join-link.js';
import { defaultsHtml, defaultsBody, defaultsChanges } from './agent-defaults.js';
import { draftFromRules, limitNote } from './agent-panel.js';
import { payoutDraftFrom } from './payout-form.js';
import { SETTINGS_IDS, tocHtml, settingRow, settingsSection } from './settings-layout.js';
const panel = document.querySelector('#account-view'); // 화면 전체. #account는 내 계정의 '계정' 칸 주소라 쓰지 않는다
const nav = document.querySelector('#nav-inner');
// 알림은 방금 누른 버튼 바로 아래에 띄운다. 화면을 다시 그릴 때마다 #message 자리도 함께 그린다.
// 내 계정에서는 저장 막대 안이 그 자리라, 막대 모양은 두고 오류일 때 색만 바꾼다
const say = (text, error = false) => {
  const message = document.querySelector('#message');
  if (!message) return;
  message.textContent = text;
  if (message.closest('.save-bar')) message.classList.toggle('error', error);
  else message.className = error ? 'form-error' : 'group-note';
};
const MESSAGE = '<p id="message" class="group-note" role="status"></p>';
const PRIVACY = 'https://github.com/orca-svg/agent-settlement/blob/main/PRIVACY.md';

// 상단바는 왼쪽·가운데·오른쪽 세 칸이다. 빈 칸도 자리를 지켜 가운데 제목이 가운데에 오게 한다
const BRAND = '<a class="nav-brand" href="./">정산은 비서끼리</a>';
const BACK = '<svg width="10" height="17" viewBox="0 0 10 17" aria-hidden="true"><path d="M8.5 1.5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const setNav = (left, center = '', right = '') => { nav.innerHTML = `<div>${left}</div><div class="nav-heading">${center}</div><div class="nav-end">${right}</div>`; };
// 화면마다 읽기 좋은 폭이 다르다(로그인은 좁게, 내 방은 목록 폭, 내 계정은 목차 + 설정). 상단바·본문·꼬리말이 같이 따른다
const setView = (view) => { document.body.dataset.view = view; };

// 화면의 행은 모두 눌러서 들어가는 곳이다(화살표)
const linkRow = (href, title, meta) => `<a class="row" href="${href}"><span class="grow"><span class="title">${title}</span>
  <span class="meta" style="display:block">${meta}</span></span>${CHEVRON}</a>`;
const demoRows = (label, dev) => `<section class="group"><h2 class="group-label"><span>${label}</span></h2><div class="list">
    ${linkRow('./', '데모 체험하기', '오사카 2박 3일 시나리오로 비서끼리 정산을 바로 해 봐요')}
    ${dev ? linkRow('room.html', '개발용 방 열기', '시드 신원으로 실제 방 화면을 시험해요') : ''}
  </div></section>`;

// 탈퇴하면 로그아웃하고 이 화면의 로그인으로 돌아와 결과를 버튼 바로 아래에 알린다
const DELETED = 'account.html?deleted=1';
let notice = new URLSearchParams(location.search).has('deleted') ? '계정을 지웠어요. 함께 정산한 금액은 익명 기록으로 남아요.' : ''; // 화면을 옮긴 뒤 그 화면에 띄울 한 줄
if (notice) history.replaceState(null, '', location.pathname); // 새로고침해도 다시 뜨지 않게

// 내 계정의 주소: #profile(맨 위)·#agent(방의 '기본 설정 바꾸기')·#payout·#rules·#notify·#account. 목차 링크도 이 #으로 간다
const onProfile = () => SETTINGS_IDS.includes(location.hash.slice(1));
let settings = null; // 내 계정 화면이 열려 있는 동안 { pending(): 저장하지 않은 변경 수, save() }
const DISCARD = '저장하지 않은 변경이 있어요. 버리고 나갈까요?';
const mayLeave = () => !settings?.pending() || confirm(DISCARD);
function openProfile() {
  history.pushState({ view: 'profile' }, '', '#profile');
  run(render);
}
// 내 방으로 돌아간다. 내 계정으로 들어올 때 쌓은 기록이면 되돌려 브라우저 뒤로와 같은 자리로 간다
function toRooms() {
  if (!mayLeave()) return;
  settings = null;
  if (history.state?.view === 'profile') history.back();
  else {
    history.replaceState(null, '', location.pathname + location.search);
    run(render);
  }
}
addEventListener('popstate', () => {
  if (settings && onProfile()) return; // 목차·#으로 같은 화면 안에서 옮긴 것: 다시 그리지 않아 쓰던 값이 남는다
  if (!mayLeave()) return void history.go(1); // 버리지 않기로 했으면 내 계정에 머문다
  settings = null;
  run(render);
});
addEventListener('beforeunload', (e) => {
  if (!settings?.pending()) return;
  e.preventDefault();
  e.returnValue = '';
});
// ⌘S(Ctrl+S): 브라우저의 '페이지 저장' 대신 내 계정을 저장한다. 저장 버튼의 툴팁이 이 단축키를 알린다
const SAVE_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';
addEventListener('keydown', (e) => {
  if (!settings || e.key.toLowerCase() !== 's' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  e.preventDefault();
  settings.save();
});

// 목차는 지금 읽는 칸을 짚는다: 제목이 상단바 바로 아래를 지난 마지막 칸. 맨 아래까지 내렸는데 칸이 짧아
// 위로 올라오지 못하면, 목차에서 누른 칸(주소의 #)이 화면에 보이는 동안은 그 칸을 짚는다
const READ_LINE = 80;
let spyFrame = 0;
function spy() {
  spyFrame = 0;
  const links = panel.querySelectorAll('[data-toc]');
  if (!links.length) return;
  let current = SETTINGS_IDS[0];
  for (const id of SETTINGS_IDS) if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= READ_LINE) current = id;
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) {
    const target = onProfile() && document.getElementById(location.hash.slice(1));
    const box = target?.getBoundingClientRect();
    current = box && box.top < innerHeight && box.bottom > READ_LINE ? target.id : SETTINGS_IDS.at(-1);
  }
  links.forEach((a) => (a.dataset.toc === current ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
}
addEventListener('scroll', () => { if (settings && !spyFrame) spyFrame = requestAnimationFrame(spy); }, { passive: true });
addEventListener('hashchange', () => { if (settings) spy(); });
// 화면 폭이 바뀌어 두 칸이 한 칸으로 쌓이면 분할 컨트롤의 선택 표시도 새 자리로 옮긴다
new ResizeObserver(() => { if (settings) mountSegs(panel); }).observe(panel);

// 방·초대 링크로 왔다가 로그인하러 온 경우 돌아갈 곳(room.html?room=… 또는 ?invite=…)
const next = nextAfterLogin(location.search);

async function render() {
  const config = await initAuth();
  if (!currentUser()) {
    // 로그인이 먼저, 둘러보기는 그 아래. 이 서버에 로그인이 연결되지 않았으면 버튼을 막고 바로 아래에서 이유를 말한다
    const ready = Boolean(config.firebase);
    setView('login');
    setNav(BRAND);
    panel.innerHTML = `<section class="hero"><h1>내 계정</h1><p class="sub">${next ? '로그인하면 보던 방으로 돌아가요.' : '로그인하면 내 방과 비서 설정을 어느 기기에서든 이어 봐요.'}</p></section>
      <section class="group">
        <button class="btn google" id="login" ${ready ? '' : 'disabled'}>${GOOGLE_G}<span>Google로 계속하기</span></button>
        ${MESSAGE}
        <p class="group-note">${ready ? '처음이면 이때 계정이 만들어져요.' : '이 서버에는 아직 Google 로그인이 연결되지 않았어요. 데모는 로그인 없이 해 볼 수 있어요.'}
          <a href="${PRIVACY}" target="_blank" rel="noopener">개인정보 처리방침</a></p>
      </section>${demoRows('로그인 없이', config.dev)}`;
    if (ready) panel.querySelector('#login').onclick = () => run(async () => { say('Google 창에서 계정을 골라 주세요…'); await login(); await render(); });
    say(notice);
    notice = '';
    return;
  }
  const { pending } = await api('/api/me/deletion');
  if (pending) {
    setView('login');
    setNav(BRAND);
    panel.innerHTML = `<section class="hero"><h1>탈퇴 마무리</h1></section>
      <section class="group"><button class="btn" style="width:100%" id="finish-delete">탈퇴 마무리</button>${MESSAGE}</section>`;
    say('개인 데이터는 지웠어요. Google 계정 연결 삭제만 남았어요.');
    panel.querySelector('button').onclick = () => run(async () => { await api('/api/me/delete', { method: 'POST' }); await logout(DELETED); });
    return;
  }
  if (next) return void location.replace(next); // 로그인했으면 보던 방·초대로 돌아간다
  const [{ profile }, { rooms }] = await Promise.all([api('/api/me'), api('/api/rooms')]);
  panel.onclick = panel.oninput = panel.onchange = null; // 비서 기본 설정 화면이 단 처리기를 다른 화면에 남기지 않는다
  if (onProfile()) profileView(profile, await api('/api/me/agent'));
  else roomsView(profile, rooms, config);
}

// 첫 화면: 내가 참여한 방. 새 방 만들기·초대 링크로 참가는 머리말 오른쪽에, 방은 이름 | 기간 목록으로.
// 방 줄은 링크라 새 탭으로도 열린다. 오른쪽 위 내 아바타가 내 계정으로 들어가는 문이다.
// 정산이 끝난 방이 있으면 '진행 중 | 끝남' 탭으로 나눈다(#55, room-list.js). 고른 탭은 이 화면에 있는 동안 기억한다.
// 목록 오른쪽 위 '편집'을 누르면 줄마다 '나가기'가 온다(#55). '완료'나 Esc로 끝낸다
let roomsTab = 'live';
let roomsEditing = false;
function roomsView(profile, rooms, config) {
  settings = null;
  setView('rooms');
  setNav(BRAND, '', `<button type="button" class="nav-avatar" id="open-profile" aria-label="내 계정 · ${esc(profile.name)}">${avatarHtml(initial(profile.name), profile.color, 'lg')}</button>`);
  const view = roomTabs(rooms, roomsTab);
  roomsEditing &&= view.rooms.length > 0; // 나갈 방이 없으면 편집도 끝난다
  const list = view.rooms.length
    ? roomRowsHtml(view.rooms, { editing: roomsEditing })
    : `<div class="room-empty"><p class="title">${view.empty.title}</p><p class="meta">${view.empty.meta}</p></div>`;
  const edit = view.rooms.length ? `<button type="button" class="text-btn" id="rooms-edit" aria-pressed="${roomsEditing}">${roomsEditing ? '완료' : '편집'}</button>` : '';
  panel.innerHTML = `<header class="hero page-head"><div><h1>내 방</h1><p class="sub">${esc(profile.name)}님으로 로그인했어요.</p></div>
      <div class="page-actions">
        <button type="button" class="btn sm plain" id="join-toggle" aria-expanded="false" aria-controls="join-link">${ICON_LINK}<span>초대 링크로 참가</span></button>
        <a class="btn sm" href="room.html"><span aria-hidden="true">+</span><span>새 방 만들기</span></a>
      </div></header>
    ${MESSAGE}
    <div class="join-panel">${joinFormHtml()}</div>
    <section class="group" id="rooms" aria-labelledby="rooms-title"><div class="group-head"><h2 class="group-label" id="rooms-title"><span>참여한 방${rooms.length ? ` ${rooms.length}개` : ''}</span></h2>${edit}</div>${view.html}${list}</section>
    ${demoRows('둘러보기', config.dev)}`;
  say(notice);
  notice = '';
  nav.querySelector('#open-profile').onclick = openProfile;
  mountJoinLink(panel);
  mountSegs(panel);
  const again = (focus) => { roomsView(profile, rooms, config); panel.querySelector(focus)?.focus(); }; // 다시 그려도 초점은 누른 자리에
  const section = panel.querySelector('#rooms');
  const toggleEdit = () => { roomsEditing = !roomsEditing; again('#rooms-edit'); };
  section.querySelector('#rooms-edit')?.addEventListener('click', toggleEdit);
  section.addEventListener('keydown', (e) => { if (e.key === 'Escape' && roomsEditing) toggleEdit(); });
  section.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-leave]');
    const room = btn && rooms.find((r) => r.id === btn.dataset.leave);
    if (room) leaveFromList(btn, room, () => {
      notice = `‘${room.name}’에서 나갔어요.`;
      const rest = rooms.filter((r) => r.id !== room.id);
      const next = view.rooms[view.rooms.indexOf(room) + 1] ?? view.rooms[view.rooms.indexOf(room) - 1];
      roomsView(profile, rest, config);
      (next && panel.querySelector(`[data-leave="${CSS.escape(next.id)}"]`) || panel.querySelector('#rooms-edit') || panel.querySelector('#join-toggle'))?.focus();
    });
  });
  const tabs = panel.querySelector('[data-seg="rooms-tab"]');
  if (!tabs) return;
  tabs.onclick = (e) => {
    const tab = e.target.closest('[data-id]')?.dataset.id;
    if (!tab || tab === view.tab) return;
    roomsTab = tab;
    again(`[data-seg="rooms-tab"] [data-id="${tab}"]`);
  };
  tabs.onkeydown = (e) => segArrowKeys(e, (btn) => btn.click());
}

// 편집 중 '나가기'(#55). 누르면 먼저 그 방에서 나갈 수 있는지 서버와 같은 규칙(public/leave.js)으로 확인해,
// 막히면 위쪽 노란 알림으로 까닭을 잠깐 보인다. 나갈 수 있으면 지우기처럼 한 번 더 눌러야 나간다.
// 끝난 방은 늘 나갈 수 있어 확인하지 않는다. 그사이 방이 바뀌어 서버가 막으면 그 까닭도 같은 알림으로 보인다
async function leaveFromList(btn, room, onLeft) {
  if (btn.getAttribute('aria-busy') === 'true') return;
  const show = (text, busy = false) => { btn.textContent = text; btn.setAttribute('aria-busy', String(busy)); };
  if (btn.classList.contains('armed')) {
    show('나가는 중…', true);
    try {
      await api(`/api/rooms/${encodeURIComponent(room.id)}/leave`, { method: 'POST' });
    } catch (e) {
      btn.classList.remove('armed');
      show('나가기');
      return toast(e.message);
    }
    await collapse(btn.closest('li'));
    return onLeft();
  }
  for (const other of panel.querySelectorAll('[data-leave].armed')) { other.classList.remove('armed'); other.textContent = '나가기'; } // 한 번에 한 방만
  if (room.status !== 'done') {
    show('확인 중…', true);
    let why;
    try {
      const data = await api(`/api/rooms/${encodeURIComponent(room.id)}`);
      why = leaveBlock(data, data.me.uid);
    } catch (e) {
      why = e.message;
    }
    show('나가기');
    if (why) return toast(why);
  }
  btn.classList.add('armed');
  show('한 번 더 누르면 나가요');
}

// 나간 방의 줄을 접어 아래 줄이 자연스럽게 올라오게 한다. 움직임 줄이기면 바로 뺀다
function collapse(li) {
  if (!li || reduceMotion.matches || !li.animate) return Promise.resolve();
  li.style.overflow = 'hidden';
  return li.animate([{ height: `${li.offsetHeight}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' }).finished;
}

// 초대 링크로 참가하기: 버튼을 누르면 머리말 바로 아래에 입력칸을 펼치고 바로 붙여 넣게 초점을 둔다.
// 알아본 토큰으로만 이 서비스의 초대 화면에 가고, 알아볼 수 없으면 입력칸 바로 아래에 알린다
function mountJoinLink(root) {
  const toggle = root.querySelector('#join-toggle');
  const form = root.querySelector('#join-link');
  const input = form.querySelector('#join-input');
  const error = form.querySelector('#join-error');
  toggle.onclick = () => {
    const open = form.hidden;
    form.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  };
  input.oninput = () => { error.textContent = ''; input.removeAttribute('aria-invalid'); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const token = inviteTokenFrom(input.value);
    if (token) return void location.assign(`room.html?invite=${encodeURIComponent(token)}`);
    input.setAttribute('aria-invalid', 'true');
    error.textContent = input.value.trim() ? '초대 링크를 알아볼 수 없어요. 친구에게 받은 링크를 그대로 붙여 넣어 주세요.' : '받은 초대 링크를 붙여 넣어 주세요.';
    input.focus();
  };
}

// 계정 칸의 첫 줄: 버튼 이름을 되풀이하지 않고, 지금 어느 계정으로 로그인했는지를 보이고 오른쪽 끝에 로그아웃을 둔다.
// 되돌릴 수 없는 탈퇴는 이 줄과 떨어진 카드에 따로 둔다
function accountRow(profile) {
  const email = currentUser()?.email;
  return settingRow({ action: true, label: '로그인한 계정', desc: email ? `Google 계정 · ${esc(email)}` : `${esc(profile.name)}님으로 로그인했어요.`,
    control: '<button type="button" class="btn sm plain" id="logout">로그아웃</button>' });
}

// 내 계정: 프로필(이름·색) → 내 비서 기본 설정(받을 계좌·비서 규칙·알림) → 계정을 한 페이지에.
// 바꾸는 대로 아래 저장 막대가 '저장하지 않은 변경 N개'를 세고, 저장하면 이 화면에 머문 채 결과를 그 자리에서 알린다.
// status: 방금 저장한 결과(다시 그린 뒤 막대에 잠깐 띄운다)
function profileView(profile, agent, status = '') {
  setView('settings');
  setNav(`<button type="button" class="nav-text" id="back">${BACK}<span>내 방</span></button>`, '내 계정');
  panel.innerHTML = `<div class="settings">${tocHtml()}<div class="settings-body">
      ${settingsSection({ id: 'profile', level: 2, title: '프로필', desc: '방 사람들에게 이 이름과 색으로 보여요. 바꾸면 모든 방에서 함께 바뀌어요.', body: profileFormHtml(profile) })}
      <div id="agent-box"></div>
      ${settingsSection({ id: 'account', level: 2, title: '계정', body: [accountRow(profile), settingRow({ action: true, label: '계정 탈퇴',
        desc: '프로필·비서 설정·위치 요약을 지우고 방에서 내 이름과 계정 연결을 끊어요. 함께 정산한 금액은 익명 기록으로 남고, 내야 할 돈이 없어지지는 않아요.',
        control: '<button type="button" class="btn sm danger" id="delete">탈퇴하기</button>' })] })}
      <div class="save-bar" id="save-bar" hidden>
        <p class="save-status" id="message" role="status"></p>
        <div class="save-actions" id="save-actions"><button type="button" class="btn sm plain" id="revert">되돌리기</button>
          <button type="button" class="btn sm" id="save" aria-keyshortcuts="Meta+S Control+S" title="저장 (${SAVE_KEY})">저장</button></div>
      </div>
    </div></div>`;
  const formEl = panel.querySelector('#profile-form');
  const form = mountProfileForm(formEl, { onSubmit: save });
  const box = panel.querySelector('#agent-box');
  const bar = panel.querySelector('#save-bar');
  const saveButton = panel.querySelector('#save');
  const fresh = () => ({ draft: draftFromRules(agent.rules), payout: payoutDraftFrom(agent.payout, profile.name), editPayout: !agent.payout });
  let ui = fresh();
  let statusTimer = 0;
  const pending = () => form.changes().length + defaultsChanges(agent, ui).length;
  // 막대: 바꾼 것이 있으면 몇 개인지와 되돌리기·저장을, 방금 저장했으면 그 결과를 4초 동안. 둘 다 없으면 숨긴다
  const syncBar = (done = '') => {
    const n = pending();
    const showDone = Boolean(done) && !n;
    clearTimeout(statusTimer);
    if (showDone) statusTimer = setTimeout(syncBar, 4000);
    say(showDone ? done : n ? `저장하지 않은 변경 ${n}개` : '');
    bar.hidden = !n && !showDone;
    panel.querySelector('#save-actions').hidden = !n;
  };
  const drawAgent = () => {
    box.innerHTML = defaultsHtml(agent, ui);
    mountSegs(box);
  };
  drawAgent();
  formEl.addEventListener('input', () => syncBar());
  formEl.addEventListener('change', () => syncBar());
  box.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'agent-set') ui.draft[el.dataset.field] = el.dataset.id;
    if (el.dataset.action === 'payout-edit') ui.editPayout = true;
    drawAgent();
    syncBar();
    if (el.dataset.action === 'payout-edit') box.querySelector('[data-pf="accountNo"]')?.focus();
  };
  // 입력칸은 다시 그리지 않고 값만 기억한다(타이핑 중 초점을 잃지 않게)
  box.oninput = (e) => {
    const { ag, pf } = e.target.dataset;
    if (ag === 'autoAccept') {
      e.target.value = e.target.value.replace(/\D/g, '');
      ui.draft.autoAccept = e.target.value;
      const note = box.querySelector('#agent-limit-note');
      if (note) note.textContent = limitNote(ui.draft);
    }
    if (pf) ui.payout[pf] = e.target.value;
    syncBar();
  };
  box.onchange = (e) => {
    if (e.target.dataset.ag === 'payday') ui.draft.payday = Number(e.target.value);
    if (e.target.matches('select[data-bank-pick]')) Object.assign(ui.payout, { other: !e.target.value, bank: e.target.value });
    if (e.target.matches('select')) drawAgent();
    syncBar();
  };
  panel.querySelector('#revert').onclick = () => {
    form.reset();
    ui = fresh();
    drawAgent();
    syncBar();
  };

  // 저장하는 동안은 '저장 중…'으로 바뀌고 다시 누를 수 없다. 비서 규칙을 바꿔 저장하면 처음 설정도 마친 것으로 친다.
  // 저장한 값으로 다시 그려(계좌는 끝 4자리로 접힌다) 보던 자리와 초점을 그대로 둔다
  async function save() {
    if (saveButton.disabled) return;
    const changedProfile = form.changed();
    const body = form.value();
    const { rules, payout } = defaultsBody(agent, ui);
    if (!changedProfile && !rules && !payout) return;
    if (changedProfile && !body.name.trim()) {
      say('표시 이름을 적어 주세요.', true);
      return void panel.querySelector('#profile-name').focus();
    }
    saveButton.disabled = true;
    saveButton.textContent = '저장 중…';
    const saved = await run(async () => {
      if (changedProfile) await api('/api/me', { method: 'POST', body });
      if (payout) await api('/api/me/payout', { method: 'POST', body: payout });
      if (rules) await api('/api/me/agent/onboarding', { method: 'POST', body: { rules } });
      const [me, nextAgent] = await Promise.all([api('/api/me'), api('/api/me/agent')]);
      return { profile: me.profile, agent: nextAgent };
    });
    if (!saved) {
      saveButton.disabled = false;
      saveButton.textContent = '저장';
      return;
    }
    const focused = document.activeElement?.id;
    const y = scrollY;
    profileView(saved.profile, saved.agent, rules || payout ? '저장했어요. 방마다 다르게 정한 비서 규칙은 그대로예요.' : '프로필을 저장했어요.');
    scrollTo({ top: y, behavior: 'instant' });
    if (focused) document.getElementById(focused)?.focus({ preventScroll: true });
  }
  settings = { pending, save };
  nav.querySelector('#back').onclick = toRooms;
  saveButton.onclick = save;
  panel.querySelector('#logout').onclick = () => {
    if (!mayLeave()) return;
    settings = null;
    run(logout);
  };
  panel.querySelector('#delete').onclick = () => run(async () => {
    if (!confirm('프로필·비서 설정·위치 요약을 지우고 탈퇴할까요? 함께 정산한 금액은 익명 기록으로 남고 되돌릴 수 없어요.')) return;
    await api('/api/me/delete', { method: 'POST' });
    settings = null;
    await logout(DELETED);
  });
  syncBar(status);
  // 처음 열 때: #profile이면 맨 위, 목차의 다른 칸(#rules 등)이나 방의 '기본 설정 바꾸기'(#agent)면 그 칸으로 간다
  if (!status) {
    const target = location.hash === '#profile' ? null : document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: 'start', behavior: 'instant' });
    else scrollTo({ top: 0, behavior: 'instant' });
  }
  spy();
}
async function run(fn) { try { return await fn(); } catch (e) { say(e.message, true); } }
run(render);
