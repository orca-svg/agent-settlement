// 실제 방 화면이 서버와 이야기하는 곳. 팀원 확장 지점:
//   #2 로그인: initAuth 이후 currentUid()는 Firebase uid. api()만 ID 토큰을 붙인다.
//   setCurrentUid()는 명시적인 비운영 시드 모드에서만 동작한다.
//   #3 Firestore: subscribeRoom()을 onSnapshot으로 바꾼다
import { API_BASE } from './api.js';
import { initAuth, currentUser, authOptions, token } from './auth.js';

const UID_KEY = 'agent-settlement.uid';

export function currentUid() {
  if (!authOptions().dev) return currentUser()?.uid || null;
  try {
    return localStorage.getItem(UID_KEY);
  } catch {
    return null;
  }
}

export function setCurrentUid(uid) {
  if (!authOptions().dev) return;
  try {
    localStorage.setItem(UID_KEY, uid);
  } catch {}
}

// 신원 헤더는 여기서만 붙인다. 다른 곳에서 fetch로 서버를 직접 부르지 않는다.
export async function api(path, { method = 'GET', body, signal, keepalive = false } = {}) {
  await initAuth();
  const idToken = await token();
  const uid = currentUid();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(idToken ? { authorization: `Bearer ${idToken}` } : authOptions().dev && uid ? { 'x-demo-user': uid } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    keepalive, // 송금 앱으로 넘어가 페이지가 숨어도 요청이 끝나게
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `HTTP ${res.status}`), { status: res.status });
  return json;
}

// 비서 기록을 2초마다 가져와 새 것만 onEvents에 넘긴다. 돌려준 함수를 부르면 멈춘다.
export function subscribeRoom(roomId, onEvents, { intervalMs = 2000 } = {}) {
  let after = 0;
  let stopped = false;
  let timer = 0;
  const tick = async () => {
    try {
      const { events } = await api(`/api/rooms/${encodeURIComponent(roomId)}/events?after=${after}`);
      if (events.length && !stopped) {
        after = events.at(-1).seq;
        onEvents(events);
      }
    } catch {}
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
