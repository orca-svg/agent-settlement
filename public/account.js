import { initAuth, currentUser, login, logout, reauthenticate } from './auth.js';
import { api } from './room-api.js';
import { esc } from './ui.js';
const panel = document.querySelector('#account');
const message = document.querySelector('#message');
async function render() {
  const config = await initAuth();
  if (!currentUser()) {
    message.textContent = config.firebase ? 'Google 계정으로 시작하세요.' : 'Google 로그인을 준비 중이에요. 데모는 바로 체험할 수 있어요.';
    panel.innerHTML = `<section class="next"><button class="btn" id="login" ${config.firebase ? '' : 'disabled'}>Google로 로그인</button> <a class="btn secondary" href="./">데모 체험</a>${config.dev ? '<p><a href="room.html">개발용 방 열기</a></p>' : ''}</section>`;
    panel.querySelector('#login').onclick = () => run(async () => { await login(); await render(); });
    return;
  }
  const { pending } = await api('/api/me/deletion');
  if (pending) {
    message.textContent = '개인 데이터 삭제를 시작했어요. Google 계정 연결 삭제를 마무리해 주세요.';
    panel.innerHTML = '<section class="next"><button class="btn" id="finish-delete">다시 인증하고 탈퇴 마무리</button></section>';
    panel.querySelector('button').onclick = () => run(async () => { await reauthenticate(); await api('/api/me/delete', { method: 'POST' }); await logout(); });
    return;
  }
  const [{ profile }, { rooms }] = await Promise.all([api('/api/me'), api('/api/rooms')]);
  message.textContent = `${profile.name}님, 안녕하세요.`;
  panel.innerHTML = `<section class="group"><h2>내 방</h2><div class="list">${rooms.map(r => `<a class="row" href="room.html?room=${encodeURIComponent(r.id)}">${esc(r.name)} · ${esc(r.dates || '')}</a>`).join('') || '<p class="empty">아직 참여한 방이 없어요.</p>'}</div></section>
    <form id="profile" class="next"><h2>프로필</h2><label class="row field">표시 이름 <input name="name" maxlength="40" required value="${esc(profile.name)}"></label><label class="row field">프로필 색 <input name="color" type="color" value="${esc(profile.color)}"></label><button class="btn">저장</button></form>
    <div class="actions"><button class="btn secondary" id="logout">로그아웃</button><button class="btn plain" id="delete">계정 탈퇴</button></div><p class="group-note">탈퇴하면 프로필·비서 설정·위치 요약을 삭제하고 방의 내 이름과 계정 연결을 지워요. 함께 정산한 금액은 익명 기록으로 남으며, 미정산 금액이 면제되지는 않아요.</p>`;
  panel.querySelector('#profile').onsubmit = e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); run(async () => { await api('/api/me', { method: 'POST', body }); message.textContent = '프로필을 저장했어요'; }); };
  panel.querySelector('#logout').onclick = () => run(logout);
  panel.querySelector('#delete').onclick = () => run(async () => {
    if (!confirm('프로필·비서 설정·위치 요약을 삭제하고 탈퇴할까요? 공유 정산 금액은 익명 기록으로 남고 되돌릴 수 없어요.')) return;
    await reauthenticate();
    await api('/api/me/delete', { method: 'POST' });
    await logout();
  });
}
async function run(fn) { try { await fn(); } catch (e) { message.textContent = e.message; } }
run(render);
