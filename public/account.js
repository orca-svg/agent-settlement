// #2 내 계정. 로그인하면 '내 방'이 첫 화면이고, 오른쪽 위 내 아바타를 누르면 '프로필' 화면으로 간다.
// 프로필 화면은 왼쪽 위 '내 방'(바꾼 것은 버림)과 오른쪽 위 '저장'(저장하고 내 방으로)으로 나간다. 브라우저 뒤로도 저장하지 않는다
import { initAuth, currentUser, login, logout } from './auth.js';
import { api } from './room-api.js';
import { esc, avatarHtml, CHEVRON } from './ui.js';
import { profileFormHtml, mountProfileForm, initial } from './profile-form.js';
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
const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

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
const onProfile = () => location.hash === '#profile';
function openProfile() {
  history.pushState({ view: 'profile' }, '', '#profile');
  run(render);
}
// 내 방으로 돌아간다. 프로필로 들어올 때 쌓은 기록이면 되돌려 브라우저 뒤로와 같은 자리로 간다
function toRooms() {
  if (history.state?.view === 'profile') history.back();
  else {
    history.replaceState(null, '', location.pathname + location.search);
    run(render);
  }
}
addEventListener('popstate', () => run(render));

async function render() {
  const config = await initAuth();
  if (!currentUser()) {
    // 로그인이 먼저, 둘러보기는 그 아래. 이 서버에 로그인이 연결되지 않았으면 버튼을 막고 바로 아래에서 이유를 말한다
    const ready = Boolean(config.firebase);
    setNav(BRAND);
    panel.innerHTML = `<section class="hero"><h1>내 계정</h1><p class="sub">로그인하면 내 방과 비서 설정을 어느 기기에서든 이어 봐요.</p></section>
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
  const [{ profile }, { rooms }] = await Promise.all([api('/api/me'), api('/api/rooms')]);
  if (onProfile()) profileView(profile);
  else roomsView(profile, rooms, config);
}

// 첫 화면: 내가 참여한 방. 오른쪽 위 내 아바타가 프로필로 들어가는 문이다
function roomsView(profile, rooms, config) {
  setNav(BRAND, '', `<button type="button" class="nav-avatar" id="open-profile" aria-label="프로필 · ${esc(profile.name)}">${avatarHtml(initial(profile.name), profile.color, 'lg')}</button>`);
  panel.innerHTML = `<section class="hero"><h1>내 방</h1><p class="sub">${esc(profile.name)}님으로 로그인했어요.</p></section>${MESSAGE}
    <section class="group"><div class="list">
      ${rooms.map((r) => linkRow(`room.html?room=${encodeURIComponent(r.id)}`, esc(r.name), esc(r.dates || ''))).join('')
        || '<div class="row"><span class="grow meta">아직 참여한 방이 없어요. 초대받은 방이 여기에 보여요.</span></div>'}
    </div></section>
    <section class="group"><div class="list">${linkRow('room.html', '새 방 만들기', '모임을 만들고 친구를 초대해요')}</div></section>${demoRows('둘러보기', config.dev)}`;
  say(notice);
  notice = '';
  nav.querySelector('#open-profile').onclick = openProfile;
}

// 프로필: 왼쪽 위 '내 방'은 바꾼 것을 버리고 돌아가고, 오른쪽 위 '저장'은 저장한 뒤 내 방으로 간다
function profileView(profile) {
  setNav(`<button type="button" class="nav-text" id="back">${BACK}<span>내 방</span></button>`, '프로필', '<button type="button" class="nav-text strong" id="save">저장</button>');
  panel.innerHTML = `<section class="group" style="margin-top:8px">${profileFormHtml(profile)}${MESSAGE}</section>
    <section class="group"><h2 class="group-label"><span>계정</span></h2>
      <div class="list"><button type="button" class="row act" id="logout">로그아웃</button><button type="button" class="row act danger" id="delete">계정 탈퇴</button></div>
      <p class="group-note">탈퇴하면 프로필·비서 설정·위치 요약을 지우고 방에서 내 이름과 계정 연결을 끊어요. 함께 정산한 금액은 익명 기록으로 남고, 내야 할 돈이 없어지지는 않아요.</p></section>`;
  const saveButton = nav.querySelector('#save');
  const form = mountProfileForm(panel.querySelector('#profile'), { onSubmit: save });
  // 바꾼 것이 없으면 저장할 것 없이 내 방으로 간다. 저장하는 동안은 '저장 중…'으로 바뀌고 다시 누를 수 없다
  async function save() {
    if (saveButton.disabled) return;
    if (!form.changed()) return toRooms();
    const body = form.value();
    if (!body.name.trim()) return say('표시 이름을 적어 주세요.', true);
    saveButton.disabled = true;
    saveButton.textContent = '저장 중…';
    if (await run(async () => { await api('/api/me', { method: 'POST', body }); return true; })) {
      notice = '프로필을 저장했어요.';
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
