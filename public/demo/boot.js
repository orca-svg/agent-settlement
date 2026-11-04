// 체험 데모 페이지(demo/room.html·demo/account.html)에서 실제 화면 코드(room.js·account.js)보다 먼저 돈다.
// 1) 화면이 서버로 보내는 /api 요청을 브라우저 안의 데모 서버(server.js)로 돌린다. 화면 코드는 바뀌지 않는다
// 2) task 체크리스트(guide.js)를 붙인다
// 3) 토스 송금 화면이 열릴 자리(#demo-toss)에 데모 안내를 띄운다
import { API_BASE } from '../api.js';
import { won } from '../core.js';
import { esc } from '../ui.js';
import { createDemoServer } from './server.js';
import { mountGuide } from './guide.js';
import { ME } from './scenario.js';

let guide = null;
const server = createDemoServer({ onChange: () => guide?.render() });

// ---------------------------------------------------------------- /api 가로채기
const realFetch = globalThis.fetch.bind(globalThis);
const apiOrigin = API_BASE ? new URL(API_BASE).origin : location.origin;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
  if (!url.pathname.startsWith('/api/') || ![location.origin, apiOrigin].includes(url.origin)) return realFetch(input, init);
  const method = String(init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : null;
  const out = await server.handle(method, url.pathname + url.search, { body });
  return new Response(JSON.stringify(out.body ?? {}), { status: out.status, headers: { 'content-type': 'application/json' } });
};

// ---------------------------------------------------------------- task 체크리스트
async function snapshot() {
  const { store } = server;
  const room = await server.focusRoom();
  const list = async (col) => (room ? store.list(col, { roomId: room.id }) : []);
  return {
    room,
    invite: room && (await store.get('invites', room.id)),
    expenses: await list('expenses'),
    invoices: await list('invoices'),
    disputes: await list('disputes'),
    transfers: await list('transfers'),
    location: (await list('locationEvidence')).filter((e) => e.uid === ME),
    agent: await store.get('agents', ME),
  };
}
function reset() {
  server.reset();
  try { sessionStorage.removeItem('agent-settlement.demo.guide'); } catch {}
  location.href = 'account.html';
}
server.ready.then(() => { guide = mountGuide({ snapshot, reset }); });

// ---------------------------------------------------------------- 토스 대신 데모 안내
// 데모 서버가 송금 링크를 #demo-toss=<송금 id>로 바꿔 둔다. 방 화면이 '밀어서 보내기'로 그 주소를 열면 여기서 안내를 띄우고,
// 실제로 다른 앱에 다녀온 것처럼 페이지를 가려진 상태로 둔다. 닫으면 다시 보이게 해서 방 화면이 '보냈나요?'를 묻는다(room.js followUp)
let tossOpen = false;
Object.defineProperty(document, 'hidden', { configurable: true, get: () => tossOpen });
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (tossOpen ? 'hidden' : 'visible') });
const tossRoot = document.createElement('div');
tossRoot.className = 'demo-toss-root';
tossRoot.hidden = true;
document.body.append(tossRoot);

async function showToss() {
  const m = /^#demo-toss=(.+)$/.exec(location.hash);
  if (!m) return;
  const t = await server.store.get('transfers', decodeURIComponent(m[1]));
  if (!t) return closeToss();
  const to = (await server.store.get('rooms', t.roomId))?.members.find((x) => x.uid === t.to)?.name ?? '';
  const account = t.fallback ? `${t.fallback.bank} ${t.fallback.accountNo}` : '';
  tossRoot.innerHTML = `<div class="demo-toss-scrim"></div>
    <section class="demo-toss" role="dialog" aria-modal="true" aria-labelledby="demo-toss-title" tabindex="-1">
      <p class="eyebrow">송금 앱이 열리는 자리 · 체험 데모</p>
      <h2 id="demo-toss-title">여기서 토스가 열려요</h2>
      <p class="demo-toss-amt num">${won(t.amount)}</p>
      <p class="demo-toss-to">${esc(to)}에게${account ? ` · ${esc(account)}` : ''}</p>
      <p class="demo-toss-note">실제로는 받는 사람·계좌·금액이 채워진 토스 송금 화면이 열리고, 보내기는 토스에서 직접 해요. 데모라서 열지 않았고 돈도 움직이지 않아요.</p>
      <button type="button" class="btn" style="width:100%" data-toss="back">보냈다 치고 돌아가기</button>
    </section>`;
  tossRoot.hidden = false;
  tossOpen = true;
  document.dispatchEvent(new Event('visibilitychange'));
  tossRoot.querySelector('.demo-toss').focus();
}
function closeToss() {
  if (location.hash.startsWith('#demo-toss=')) history.replaceState(history.state, '', location.pathname + location.search);
  if (!tossOpen) return;
  tossRoot.hidden = true;
  tossOpen = false;
  document.dispatchEvent(new Event('visibilitychange'));
}
tossRoot.addEventListener('click', (e) => { if (e.target.closest('[data-toss="back"]')) closeToss(); });
document.addEventListener('keydown', (e) => { if (tossOpen && e.key === 'Escape') closeToss(); });
addEventListener('hashchange', showToss);
showToss();
