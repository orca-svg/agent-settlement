import { initAuth, currentUser, login, logout, reauthenticate } from './auth.js';
import { api } from './room-api.js';
import { esc, chip, CHEVRON } from './ui.js';
const panel = document.querySelector('#account');
const message = document.querySelector('#message');
const say = (text, error = false) => { message.textContent = text; message.className = error ? 'form-error' : 'group-note'; };

// 화면의 행은 모두 눌러서 들어가는 곳이다(화살표). 지금 할 수 있는 일을 먼저, 준비 중인 일은 칩으로 알린다
const linkRow = (href, title, meta) => `<a class="row" href="${href}"><span class="grow"><span class="title">${title}</span>
  <span class="meta" style="display:block">${meta}</span></span>${CHEVRON}</a>`;
const tryRows = (dev) => `<section class="group"><div class="list">
    ${linkRow('./', '데모 체험하기', '오사카 2박 3일 시나리오로 비서끼리 정산을 바로 해 봐요')}
    ${dev ? linkRow('room.html', '개발용 방 열기', '시드 신원으로 실제 방 화면을 시험해요') : ''}
  </div></section>`;

async function render() {
  const config = await initAuth();
  if (!currentUser()) {
    if (config.firebase) {
      say('Google 계정으로 들어오면 내 방이 여기에 모여요.');
      panel.innerHTML = `<section class="group"><button class="btn" style="width:100%" id="login">Google로 로그인</button></section>${tryRows(config.dev)}`;
      panel.querySelector('#login').onclick = () => run(async () => { await login(); await render(); });
    } else {
      say('Google 로그인은 준비 중이에요. 데모는 지금 바로 해 볼 수 있어요.');
      panel.innerHTML = `${tryRows(config.dev)}
        <section class="group"><h2 class="group-label"><span>Google 계정</span></h2><div class="list">
          <div class="row"><span class="grow">Google로 로그인</span>${chip('준비 중')}</div></div>
          <p class="group-note">팀의 Firebase 프로젝트를 연결하면 여기서 로그인할 수 있어요.</p></section>`;
    }
    return;
  }
  const { pending } = await api('/api/me/deletion');
  if (pending) {
    say('개인 데이터는 지웠어요. Google 계정 연결 삭제만 남았어요.');
    panel.innerHTML = '<section class="group"><button class="btn" style="width:100%" id="finish-delete">다시 인증하고 탈퇴 마무리</button></section>';
    panel.querySelector('button').onclick = () => run(async () => { await reauthenticate(); await api('/api/me/delete', { method: 'POST' }); await logout(); });
    return;
  }
  const [{ profile }, { rooms }] = await Promise.all([api('/api/me'), api('/api/rooms')]);
  say(`${profile.name}님, 안녕하세요.`);
  panel.innerHTML = `<section class="group"><h2 class="group-label"><span>내 방</span><span>${rooms.length}개</span></h2><div class="list">
      ${rooms.map((r) => linkRow(`room.html?room=${encodeURIComponent(r.id)}`, esc(r.name), esc(r.dates || ''))).join('')
        || '<div class="row"><span class="grow meta">아직 참여한 방이 없어요. 초대받은 방이 여기에 보여요.</span></div>'}
    </div></section>
    <section class="group"><h2 class="group-label"><span>프로필</span></h2>
      <form id="profile"><div class="list">
        <label class="row field"><span class="grow">표시 이름</span><input name="name" maxlength="40" required value="${esc(profile.name)}"></label>
        <label class="row field"><span class="grow">프로필 색</span><input name="color" type="color" value="${esc(profile.color)}"></label>
      </div><div class="actions" style="margin-top:12px"><button class="btn">저장</button></div></form></section>
    <section class="group"><h2 class="group-label"><span>계정</span></h2>
      <div class="actions"><button class="btn plain" id="logout">로그아웃</button><button class="btn danger" id="delete">계정 탈퇴</button></div>
      <p class="group-note">탈퇴하면 프로필·비서 설정·위치 요약을 지우고 방에서 내 이름과 계정 연결을 끊어요. 함께 정산한 금액은 익명 기록으로 남고, 내야 할 돈이 없어지지는 않아요.</p></section>`;
  panel.querySelector('#profile').onsubmit = (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); run(async () => { await api('/api/me', { method: 'POST', body }); say('프로필을 저장했어요.'); }); };
  panel.querySelector('#logout').onclick = () => run(logout);
  panel.querySelector('#delete').onclick = () => run(async () => {
    if (!confirm('프로필·비서 설정·위치 요약을 지우고 탈퇴할까요? 함께 정산한 금액은 익명 기록으로 남고 되돌릴 수 없어요.')) return;
    await reauthenticate();
    await api('/api/me/delete', { method: 'POST' });
    await logout();
  });
}
async function run(fn) { try { await fn(); } catch (e) { say(e.message, true); } }
run(render);
