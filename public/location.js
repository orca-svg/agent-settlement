import { api } from './room-api.js';
import { esc } from './ui.js';
import { classifyPosition } from './location-core.js';
const roomId = new URLSearchParams(location.search).get('room');
const path = `/api/rooms/${encodeURIComponent(roomId)}/location`;
const content = document.querySelector('#content');
const message = document.querySelector('#message');
let generation = 0;
let busy = false;
let expiryTimer;
async function measure() {
  if (!navigator.geolocation || !isSecureContext) throw new Error('HTTPS 또는 localhost에서 위치 권한을 허용해 주세요');
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, error => reject(new Error({
    1: '위치 권한이 꺼져 있어요. 브라우저의 사이트 설정에서 허용한 뒤 다시 시도해 주세요.',
    2: '기기 위치를 찾지 못했어요. 기기의 위치 설정을 확인해 주세요.',
    3: '위치를 확인하는 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.',
  }[error.code] || '위치를 확인하지 못했어요. 다시 시도해 주세요.')), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }));
}
document.querySelector('#back').href = roomId ? `room.html?room=${encodeURIComponent(roomId)}` : 'account.html';
async function run(fn) { try { await fn(); } catch (e) { message.textContent = e.message; } }
async function render() {
  clearTimeout(expiryTimer);
  if (!roomId) throw new Error('정산 방에서 참석 근거를 열어 주세요');
  const [{ consent, records }, data] = await Promise.all([api(path), api(`/api/rooms/${encodeURIComponent(roomId)}`)]);
  message.textContent = consent ? `공유 동의 만료: ${new Date(consent.expiresAt).toLocaleString('ko-KR')}` : '위치 권한은 동의 후 기록 버튼을 누를 때만 요청해요.';
  if (!consent) {
    content.innerHTML = `<form id="consent" class="next"><h2>이번 모임에만 동의</h2><p>최대 24시간 동안 기록할 수 있어요. 요약은 이의 상대(지출을 낸 사람)와 중재 AI만 볼 수 있고, 같은 방의 다른 참여자에게는 요약이 붙었다는 사실만 보여요. 동의가 끝나면 삭제해요. 체크아웃은 귀가·불참을 확정하는 증거가 아니에요.</p><label><input name="agree" type="checkbox" required> 위치 요약 수집·공유에 동의해요</label><label class="row field">공유 기간 <select name="hours"><option value="1">1시간</option><option value="6">6시간</option><option value="24">24시간</option></select></label><button class="btn">동의하고 시작</button></form>`;
    content.querySelector('form').onsubmit = e => { e.preventDefault(); const f = new FormData(e.target); run(async () => { await api(`${path}/consent`, { method: 'POST', body: { agree: f.has('agree'), expiresAt: new Date(Date.now() + Number(f.get('hours')) * 3600000).toISOString() } }); await render(); }); };
    return;
  }
  expiryTimer = setTimeout(() => { generation++; content.replaceChildren(); run(render); }, Math.max(0, Date.parse(consent.expiresAt) - Date.now()) + 100);
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const expenses = data.expenses.filter(e => e.date === today && e.present.includes(data.me.uid));
  content.innerHTML = `<form id="record" class="next"><h2>지금 위치 확인</h2><p>오늘 지출의 장소를 지정하세요. 장소 좌표는 서버에 저장하지 않아요. 같은 장소에 대한 체크인·체크아웃도 연속 체류를 증명하지는 않아요.</p>
    <label class="row field">오늘 지출 <select name="expenseId" required>${expenses.map(e => `<option value="${esc(e.id)}">${esc(e.title)}</option>`).join('')}</select></label>
    ${expenses.length ? '' : '<p>오늘 내가 참여한 지출을 먼저 남겨 주세요.</p>'}
    <button class="btn secondary" type="button" id="use-here">지금 있는 곳을 기준 장소로 지정</button><p class="group-note">모임 장소에 도착했을 때 지정하세요. 나중에 이 페이지에서 체크아웃할 때 같은 기준 장소와 비교해요. 새로고침하면 좌표는 지워져요.</p>
    <label class="row field">장소 위도 <input name="latitude" type="number" step="any" min="-90" max="90" required></label>
    <label class="row field">장소 경도 <input name="longitude" type="number" step="any" min="-180" max="180" required></label>
    <label class="row field">반경(미터) <input name="radius" type="number" min="10" max="1000" value="100" required></label>
    <label class="row field">기록 종류 <select name="action"><option value="checkin">체크인</option><option value="checkout">체크아웃</option></select></label>
    <button class="btn" type="submit" ${expenses.length ? '' : 'disabled'}>현재 위치로 기록</button></form>
    <section class="group"><h2>공유한 요약</h2><div class="list">${records.map(r => `<p class="row">${esc(r.summary)}</p>`).join('') || '<p class="empty">아직 기록이 없어요.</p>'}</div></section>
    <button class="btn secondary" id="revoke">동의 철회·요약 삭제</button><p class="group-note">철회하면 저장한 위치 요약과 연결된 미확정 중재안을 지워요. 이미 합의한 정산 금액은 유지해요.</p>`;
  content.querySelector('#revoke').onclick = () => run(async () => { generation++; await api(`${path}/revoke`, { method: 'POST' }); await render(); });
  content.querySelector('#use-here').onclick = e => run(async () => {
    const button = e.currentTarget;
    const version = generation;
    button.disabled = true;
    try {
      const position = await measure();
      if (version !== generation) return;
      if (position.coords.accuracy > 200) throw new Error('위치 오차가 커서 기준 장소를 정하지 못했어요. 정확한 위치에서 다시 시도해 주세요.');
      content.querySelector('[name=latitude]').value = position.coords.latitude;
      content.querySelector('[name=longitude]').value = position.coords.longitude;
      message.textContent = '이 페이지에만 기준 장소를 지정했어요. 아래에서 체크인·체크아웃을 기록하세요.';
    } finally { button.disabled = false; }
  });
  content.querySelector('#record').onsubmit = e => {
    e.preventDefault();
    if (busy) return;
    const form = e.target;
    const fields = Object.fromEntries(new FormData(form));
    const version = generation;
    run(async () => {
      busy = true;
      const button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        message.textContent = '기기 위치를 확인하고 있어요…';
        const position = await measure();
        if (generation !== version) return;
        const relation = classifyPosition(position, { latitude: Number(fields.latitude), longitude: Number(fields.longitude), radius: Number(fields.radius) });
        await api(path, { method: 'POST', body: { expenseId: fields.expenseId, action: fields.action, observedAt: new Date(position.timestamp).toISOString(), relation } });
        await render();
        // Keep the reference place only in this page's DOM for the next action.
        const nextForm = content.querySelector('#record');
        if (nextForm) for (const key of ['latitude', 'longitude', 'radius', 'expenseId']) nextForm.elements[key].value = fields[key];
        if (nextForm && fields.action === 'checkin') nextForm.elements.action.value = 'checkout';
      } finally { busy = false; button.disabled = false; }
    });
  };
}
run(render);
