import { api } from './room-api.js';
import { esc } from './ui.js';
import { classifyPosition } from './location-core.js';
const roomId = new URLSearchParams(location.search).get('room');
const path = `/api/rooms/${encodeURIComponent(roomId)}/location`;
const content = document.querySelector('#content');
const message = document.querySelector('#message');
let generation = 0;
let busy = false;
document.querySelector('#back').href = roomId ? `room.html?room=${encodeURIComponent(roomId)}` : 'account.html';
async function run(fn) { try { await fn(); } catch (e) { message.textContent = e.message; } }
async function render() {
  if (!roomId) throw new Error('정산 방에서 참석 근거를 열어 주세요');
  const [{ consent, records }, data] = await Promise.all([api(path), api(`/api/rooms/${encodeURIComponent(roomId)}`)]);
  message.textContent = consent ? `공유 동의 만료: ${new Date(consent.expiresAt).toLocaleString('ko-KR')}` : '위치 권한은 동의 후 기록 버튼을 누를 때만 요청해요.';
  if (!consent) {
    content.innerHTML = `<form id="consent" class="next"><h2>이번 모임에만 동의</h2><p>최대 24시간 동안 기록할 수 있어요. 요약은 같은 방 참여자와 중재 AI가 볼 수 있고, 동의가 끝나면 삭제해요. 체크아웃은 귀가·불참을 확정하는 증거가 아니에요.</p><label><input name="agree" type="checkbox" required> 위치 요약 수집·공유에 동의해요</label><label class="row field">공유 기간 <select name="hours"><option value="1">1시간</option><option value="6">6시간</option><option value="24">24시간</option></select></label><button class="btn">동의하고 시작</button></form>`;
    content.querySelector('form').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); run(async () => { await api(`${path}/consent`, { method: 'POST', body: { agree: f.has('agree'), expiresAt: new Date(Date.now() + Number(f.get('hours')) * 3600000).toISOString() } }); await render(); }); };
    return;
  }
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const expenses = data.expenses.filter(e => e.date === today && e.present.includes(data.me.uid));
  content.innerHTML = `<form id="record" class="next"><h2>지금 위치 확인</h2><p>오늘 지출의 장소를 지정하세요. 장소 좌표는 서버에 저장하지 않아요. 같은 장소에 대한 체크인·체크아웃도 연속 체류를 증명하지는 않아요.</p>
    <label class="row field">오늘 지출 <select name="expenseId" required>${expenses.map(e => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}</select></label>
    ${expenses.length ? '' : '<p>오늘 내가 참여한 지출을 먼저 남겨 주세요.</p>'}
    <label class="row field">장소 위도 <input name="latitude" type="number" step="any" min="-90" max="90" required></label>
    <label class="row field">장소 경도 <input name="longitude" type="number" step="any" min="-180" max="180" required></label>
    <label class="row field">반경(미터) <input name="radius" type="number" min="10" max="1000" value="100" required></label>
    <label class="row field">기록 종류 <select name="action"><option value="checkin">체크인</option><option value="checkout">체크아웃</option></select></label>
    <button class="btn" ${expenses.length ? '' : 'disabled'}>현재 위치로 기록</button></form>
    <section class="group"><h2>공유한 요약</h2><div class="list">${records.map(r => `<p class="row">${esc(r.summary)}</p>`).join('') || '<p class="empty">아직 기록이 없어요.</p>'}</div></section>
    <button class="btn secondary" id="revoke">동의 철회·요약 삭제</button><p class="group-note">철회하면 저장한 위치 요약과 연결된 미확정 중재안을 지워요. 이미 합의한 정산 금액은 유지해요.</p>`;
  content.querySelector('#revoke').onclick = () => run(async () => { generation++; await api(`${path}/revoke`, { method: 'POST' }); await render(); });
  content.querySelector('#record').onsubmit = e => {
    e.preventDefault();
    if (busy) return;
    const form = e.target;
    const fields = Object.fromEntries(new FormData(form));
    const version = generation;
    run(async () => {
      busy = true;
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        if (!navigator.geolocation || !isSecureContext) throw new Error('HTTPS 또는 localhost에서 위치 권한을 허용해 주세요');
        message.textContent = '기기 위치를 확인하고 있어요…';
        const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('위치를 확인하지 못했어요. 권한과 기기 위치 설정을 확인해 주세요')), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
        if (generation !== version) return;
        const relation = classifyPosition(position, { latitude: Number(fields.latitude), longitude: Number(fields.longitude), radius: Number(fields.radius) });
        await api(path, { method: 'POST', body: { expenseId: fields.expenseId, action: fields.action, observedAt: new Date(position.timestamp).toISOString(), relation } });
        await render();
      } finally { busy = false; button.disabled = false; }
    });
  };
}
run(render);
