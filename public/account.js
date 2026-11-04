// #2 내 계정. 로그인하면 '내 방'이 첫 화면이고, 오른쪽 위 내 아바타를 누르면 '프로필' 화면으로 간다.
// 프로필 화면은 왼쪽 위 '내 방'(바꾼 것은 버림)과 오른쪽 위 '저장'(저장하고 내 방으로)으로 나간다. 브라우저 뒤로도 저장하지 않는다
import { initAuth, currentUser, login, logout } from './auth.js';
import { api } from './room-api.js';
import { esc, avatarHtml, CHEVRON, GOOGLE_G, nextAfterLogin, mountSegs } from './ui.js';
import { profileFormHtml, mountProfileForm, initial } from './profile-form.js';
import { inviteTokenFrom, joinLinkHtml } from './join-link.js';
import { defaultsHtml, defaultsBody } from './agent-defaults.js';
import { draftFromRules, limitNote } from './agent-panel.js';
import { payoutDraftFrom } from './payout-form.js';
const panel = document.querySelector('#account');
const nav = document.querySelector('#nav-inner');
// 알림은 방금 누른 버튼 바로 아래에 띄운다. 화면을 다시 그릴 때마다 #message 자리도 함께 그린다
const say = (text, error = false) => {
  const message = document.querySelector('#message');
  if (!message) return;
  message.textContent = text;
  message.className = error ? 'form-error' : 'group-note';
};
const MESSAGE = '<p id="message" class="group-note" role="status"></p>';
const PRIVACY = 'https://github.com/orca-svg/agent-settlement/blob/main/PRIVACY.md';

// 상단바는 왼쪽·가운데·오른쪽 세 칸이다. 빈 칸도 자리를 지켜 가운데 제목이 가운데에 오게 한다
const BRAND = '<a class="nav-brand" href="./">정산은 비서끼리</a>';
const BACK = '<svg width="10" height="17" viewBox="0 0 10 17" aria-hidden="true"><path d="M8.5 1.5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const setNav = (left, center = '', right = '') => { nav.innerHTML = `<div>${left}</div><div class="nav-heading">${center}</div><div class="nav-end">${right}</div>`; };

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
const onProfile = () => ['#profile', '#agent'].includes(location.hash); // #agent: 같은 화면의 내 비서 기본 설정으로 내려간다(방의 '기본 설정 바꾸기')
function openProfile() {
  history.pushState({ view: 'profile' }, '', '#profile');
  run(render);
}
// 내 방으로 돌아간다. 내 계정으로 들어올 때 쌓은 기록이면 되돌려 브라우저 뒤로와 같은 자리로 간다
function toRooms() {
  if (history.state?.view === 'profile') history.back();
  else {
    history.replaceState(null, '', location.pathname + location.search);
    run(render);
  }
}
addEventListener('popstate', () => run(render));

// 방·초대 링크로 왔다가 로그인하러 온 경우 돌아갈 곳(room.html?room=… 또는 ?invite=…)
const next = nextAfterLogin(location.search);

async function render() {
  const config = await initAuth();
  if (!currentUser()) {
    // 로그인이 먼저, 둘러보기는 그 아래. 이 서버에 로그인이 연결되지 않았으면 버튼을 막고 바로 아래에서 이유를 말한다
    const ready = Boolean(config.firebase);
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

// 첫 화면: 내가 참여한 방. 오른쪽 위 내 아바타가 프로필로 들어가는 문이다
function roomsView(profile, rooms, config) {
  setNav(BRAND, '', `<button type="button" class="nav-avatar" id="open-profile" aria-label="내 계정 · ${esc(profile.name)}">${avatarHtml(initial(profile.name), profile.color, 'lg')}</button>`);
  panel.innerHTML = `<section class="hero"><h1>내 방</h1><p class="sub">${esc(profile.name)}님으로 로그인했어요.</p></section>${MESSAGE}
    <section class="group"><div class="list">
      <a class="row new-room" href="room.html"><span class="new-room-icon" aria-hidden="true">+</span><span class="grow"><span class="title">새 방 만들기</span>
        <span class="meta" style="display:block">모임을 만들고 초대 링크로 친구를 불러요</span></span>${CHEVRON}</a>
      ${joinLinkHtml()}
      ${rooms.map((r) => linkRow(`room.html?room=${encodeURIComponent(r.id)}`, esc(r.name), esc(r.dates || ''))).join('')
        || '<div class="row"><span class="grow meta">아직 참여한 방이 없어요. 새 방을 만들거나 친구에게 초대 링크를 받으면 여기에 보여요.</span></div>'}
    </div></section>
    ${demoRows('둘러보기', config.dev)}`;
  say(notice);
  notice = '';
  nav.querySelector('#open-profile').onclick = openProfile;
  mountJoinLink(panel);
}

// 초대 링크로 참가하기: 줄을 누르면 그 자리에 입력칸을 펼치고 바로 붙여 넣게 초점을 둔다.
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

// 내 계정: 프로필(이름·색) + 내 비서 기본 설정(받을 계좌·규칙) + 계정. 왼쪽 위 '내 방'은 바꾼 것을 버리고 돌아가고,
// 오른쪽 위 '저장'은 바꾼 것만 저장한 뒤 내 방으로 간다. 방의 '내 계정' 메뉴와 내 방의 아바타가 여기로 온다
function profileView(profile, agent) {
  setNav(`<button type="button" class="nav-text" id="back">${BACK}<span>내 방</span></button>`, '내 계정', '<button type="button" class="nav-text strong" id="save">저장</button>');
  panel.innerHTML = `<section class="group" style="margin-top:8px">${profileFormHtml(profile)}${MESSAGE}</section>
    <div id="agent-box"></div>
    <section class="group"><h2 class="group-label"><span>계정</span></h2>
      <div class="list"><button type="button" class="row act" id="logout">로그아웃</button><button type="button" class="row act danger" id="delete">계정 탈퇴</button></div>
      <p class="group-note">탈퇴하면 프로필·비서 설정·위치 요약을 지우고 방에서 내 이름과 계정 연결을 끊어요. 함께 정산한 금액은 익명 기록으로 남고, 내야 할 돈이 없어지지는 않아요.</p></section>`;
  const saveButton = nav.querySelector('#save');
  const form = mountProfileForm(panel.querySelector('#profile'), { onSubmit: save });
  const box = panel.querySelector('#agent-box');
  const ui = { draft: draftFromRules(agent.rules), payout: payoutDraftFrom(agent.payout, profile.name), editPayout: !agent.payout };
  const drawAgent = () => {
    box.innerHTML = defaultsHtml(agent, ui);
    mountSegs(box);
  };
  drawAgent();
  box.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'agent-set') ui.draft[el.dataset.field] = el.dataset.id;
    if (el.dataset.action === 'payout-edit') ui.editPayout = true;
    drawAgent();
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
  };
  box.onchange = (e) => {
    if (e.target.dataset.ag === 'payday') ui.draft.payday = Number(e.target.value);
    if (e.target.matches('select[data-bank-pick]')) Object.assign(ui.payout, { other: !e.target.value, bank: e.target.value });
    if (e.target.matches('select')) drawAgent();
  };
  // 방의 '기본 설정 바꾸기'로 왔으면 내 비서 기본 설정으로 바로 내려간다
  if (location.hash === '#agent') box.scrollIntoView({ block: 'start' });

  // 바꾼 것이 없으면 저장할 것 없이 내 방으로 간다. 저장하는 동안은 '저장 중…'으로 바뀌고 다시 누를 수 없다.
  // 비서 규칙을 바꿔 저장하면 처음 설정도 마친 것으로 친다
  async function save() {
    if (saveButton.disabled) return;
    const changedProfile = form.changed();
    const body = form.value();
    const { rules, payout } = defaultsBody(agent, ui);
    if (!changedProfile && !rules && !payout) return toRooms();
    if (changedProfile && !body.name.trim()) return say('표시 이름을 적어 주세요.', true);
    saveButton.disabled = true;
    saveButton.textContent = '저장 중…';
    const ok = await run(async () => {
      if (changedProfile) await api('/api/me', { method: 'POST', body });
      if (payout) await api('/api/me/payout', { method: 'POST', body: payout });
      if (rules) await api('/api/me/agent/onboarding', { method: 'POST', body: { rules } });
      return true;
    });
    if (ok) {
      notice = rules || payout ? '저장했어요. 방마다 다르게 정한 비서 규칙은 그대로예요.' : '프로필을 저장했어요.';
      toRooms();
      return;
    }
    saveButton.disabled = false;
    saveButton.textContent = '저장';
  }
  nav.querySelector('#back').onclick = toRooms;
  saveButton.onclick = save;
  panel.querySelector('#logout').onclick = () => run(logout);
  panel.querySelector('#delete').onclick = () => run(async () => {
    if (!confirm('프로필·비서 설정·위치 요약을 지우고 탈퇴할까요? 함께 정산한 금액은 익명 기록으로 남고 되돌릴 수 없어요.')) return;
    await api('/api/me/delete', { method: 'POST' });
    await logout(DELETED);
  });
}
async function run(fn) { try { return await fn(); } catch (e) { say(e.message, true); } }
run(render);
