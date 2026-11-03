import { initAuth, currentUser, login, logout, reauthenticate } from './auth.js';
import { api } from './room-api.js';
import { esc, CHEVRON } from './ui.js';
import { profileFormHtml, mountProfileForm } from './profile-form.js';
const panel = document.querySelector('#account');
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

// 화면의 행은 모두 눌러서 들어가는 곳이다(화살표)
const linkRow = (href, title, meta) => `<a class="row" href="${href}"><span class="grow"><span class="title">${title}</span>
  <span class="meta" style="display:block">${meta}</span></span>${CHEVRON}</a>`;
const tryRows = (dev) => `<section class="group"><h2 class="group-label"><span>로그인 없이</span></h2><div class="list">
    ${linkRow('./', '데모 체험하기', '오사카 2박 3일 시나리오로 비서끼리 정산을 바로 해 봐요')}
    ${dev ? linkRow('room.html', '개발용 방 열기', '시드 신원으로 실제 방 화면을 시험해요') : ''}
  </div></section>`;

async function render() {
  const config = await initAuth();
  if (!currentUser()) {
    // 로그인이 먼저, 둘러보기는 그 아래. 이 서버에 로그인이 연결되지 않았으면 버튼을 막고 바로 아래에서 이유를 말한다
    const ready = Boolean(config.firebase);
    panel.innerHTML = `<section class="group">
        <button class="btn google" id="login" ${ready ? '' : 'disabled'}>${GOOGLE_G}<span>Google로 계속하기</span></button>
        ${MESSAGE}
        <p class="group-note">${ready ? '처음이면 이때 계정이 만들어져요.' : '이 서버에는 아직 Google 로그인이 연결되지 않았어요. 데모는 로그인 없이 해 볼 수 있어요.'}
          <a href="${PRIVACY}" target="_blank" rel="noopener">개인정보 처리방침</a></p>
      </section>${tryRows(config.dev)}`;
    if (ready) panel.querySelector('#login').onclick = () => run(async () => { say('Google 창에서 계정을 골라 주세요…'); await login(); await render(); });
    return;
  }
  const { pending } = await api('/api/me/deletion');
  if (pending) {
    panel.innerHTML = `<section class="group"><button class="btn" style="width:100%" id="finish-delete">다시 인증하고 탈퇴 마무리</button>${MESSAGE}</section>`;
    say('개인 데이터는 지웠어요. Google 계정 연결 삭제만 남았어요.');
    panel.querySelector('button').onclick = () => run(async () => { await reauthenticate(); await api('/api/me/delete', { method: 'POST' }); await logout(); });
    return;
  }
  const [{ profile }, { rooms }] = await Promise.all([api('/api/me'), api('/api/rooms')]);
  document.querySelector('#hello').textContent = `${profile.name}님으로 로그인했어요.`;
  panel.innerHTML = `<section class="group"><h2 class="group-label"><span>내 방</span><span>${rooms.length}개</span></h2><div class="list">
      ${rooms.map((r) => linkRow(`room.html?room=${encodeURIComponent(r.id)}`, esc(r.name), esc(r.dates || ''))).join('')
        || '<div class="row"><span class="grow meta">아직 참여한 방이 없어요. 초대받은 방이 여기에 보여요.</span></div>'}
    </div></section>
    <section class="group"><h2 class="group-label"><span>프로필</span><span>방에서 이 이름과 색으로 보여요</span></h2>
      ${profileFormHtml(profile)}${MESSAGE}</section>
    <section class="group"><h2 class="group-label"><span>계정</span></h2>
      <div class="list"><button type="button" class="row act" id="logout">로그아웃</button><button type="button" class="row act danger" id="delete">계정 탈퇴</button></div>
      <p class="group-note">탈퇴하면 프로필·비서 설정·위치 요약을 지우고 방에서 내 이름과 계정 연결을 끊어요. 함께 정산한 금액은 익명 기록으로 남고, 내야 할 돈이 없어지지는 않아요.</p></section>`;
  mountProfileForm(panel.querySelector('#profile'), (body) => run(async () => { await api('/api/me', { method: 'POST', body }); say('프로필을 저장했어요.'); return true; }));
  panel.querySelector('#logout').onclick = () => run(logout);
  panel.querySelector('#delete').onclick = () => run(async () => {
    if (!confirm('프로필·비서 설정·위치 요약을 지우고 탈퇴할까요? 함께 정산한 금액은 익명 기록으로 남고 되돌릴 수 없어요.')) return;
    await reauthenticate();
    await api('/api/me/delete', { method: 'POST' });
    await logout();
  });
}
async function run(fn) { try { return await fn(); } catch (e) { say(e.message, true); } }
run(render);
