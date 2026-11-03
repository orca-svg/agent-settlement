// 실제 방 화면이 서버와 이야기하는 곳. 팀원 확장 지점:
//   #2 로그인: initAuth 이후 currentUid()는 Firebase uid. api()만 ID 토큰을 붙인다.
//   setCurrentUid()는 명시적인 비운영 시드 모드에서만 동작한다.
//   #3 Firestore: subscribeRoom()은 서버가 Firestore면 onSnapshot, 아니면 폴링(호출 방식은 같다)
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

// 비서 기록 중 새 것만 onEvents에 넘긴다. 돌려준 함수를 부르면 멈춘다.
// 서버가 Firestore를 쓰고 로그인했으면 rooms/{roomId}/events를 onSnapshot으로 받고(#3), 아니면 2초마다 가져온다.
// 실시간 연결이 막히면(규칙 미배포, 권한 없음 등) 받은 곳부터 폴링으로 이어 간다.
export function subscribeRoom(roomId, onEvents, { intervalMs = 2000 } = {}) {
  let stopped = false;
  let stop = () => {};
  let after = 0;
  const deliver = (events) => {
    const fresh = events.filter((e) => e.seq > after).sort((a, b) => a.seq - b.seq);
    if (!fresh.length || stopped) return;
    after = fresh.at(-1).seq;
    onEvents(fresh);
  };
  const poll = () => {
    let timer = 0;
    const tick = async () => {
      try {
        deliver((await api(`/api/rooms/${encodeURIComponent(roomId)}/events?after=${after}`)).events);
      } catch {}
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick();
    stop = () => clearTimeout(timer);
  };
  (async () => {
    const db = await realtimeDb().catch(() => null);
    if (stopped) return;
    if (!db) return poll();
    const { collection, query, orderBy, onSnapshot } = db.sdk;
    stop = onSnapshot(
      query(collection(db.instance, 'rooms', roomId, 'events'), orderBy('seq')),
      (snap) => deliver(snap.docChanges().filter((c) => c.type === 'added').map((c) => c.doc.data())),
      () => { if (!stopped) poll(); },
    );
  })();
  return () => {
    stopped = true;
    stop();
  };
}

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/13.1.0';
let realtimeStarting;
// 로그인(#2)이 만든 Firebase 앱에 Firestore를 붙인다. 실시간을 못 쓰면 null
function realtimeDb() {
  return realtimeStarting ??= (async () => {
    await initAuth();
    const config = await (await fetch(`${API_BASE}/api/config`)).json();
    if (!config.realtime?.firestore || !currentUser()) return null;
    const [{ getApp }, sdk] = await Promise.all([import(`${FIREBASE_SDK}/firebase-app.js`), import(`${FIREBASE_SDK}/firebase-firestore.js`)]);
    const instance = sdk.getFirestore(getApp());
    const emulator = config.realtime.emulator;
    if (emulator && ['localhost', '127.0.0.1'].includes(location.hostname)) {
      const [host, port] = emulator.split(':');
      sdk.connectFirestoreEmulator(instance, host, Number(port));
    }
    return { sdk, instance };
  })();
}
