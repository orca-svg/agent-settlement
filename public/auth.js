import { API_BASE } from './api.js';
let instance = null;
let sdk = null;
let options = { dev: false, firebase: null };
let starting;
export function initAuth() {
  return starting ??= (async () => {
    const response = await fetch(`${API_BASE}/api/config`);
    if (!response.ok) throw new Error('로그인 설정을 불러오지 못했어요');
    options = (await response.json()).auth || options;
    if (!options.firebase) return options;
    const [app, auth] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),
    ]);
    sdk = auth;
    instance = auth.getAuth(app.initializeApp(options.firebase));
    if (options.emulator && ['localhost', '127.0.0.1'].includes(location.hostname)) auth.connectAuthEmulator(instance, `http://${options.emulator}`);
    await instance.authStateReady();
    return options;
  })().catch(error => {
    // A temporary config/CDN failure must not poison every later API request.
    starting = undefined;
    throw error;
  });
}
export const authOptions = () => options;
// 체험 데모(public/demo/)는 Firebase 없이 '나'로 로그인한 것처럼 둔다. 토큰은 없고, 요청은 브라우저 안의 데모 서버가 받는다
const DEMO_USER = Object.freeze({ uid: 'me', displayName: '나' });
export const currentUser = () => instance?.currentUser || (options.demo ? DEMO_USER : null);
export async function token() { await initAuth(); return instance?.currentUser?.getIdToken() || null; }
export async function login() {
  await initAuth();
  if (!instance) throw new Error('Google 로그인을 준비 중이에요. 지금은 데모를 이용할 수 있어요');
  return sdk.signInWithPopup(instance, new sdk.GoogleAuthProvider());
}
// 로그아웃하면 첫 화면(데모)이 아니라 다시 로그인할 수 있는 '내 계정' 화면으로 간다
export async function logout(to = 'account.html') {
  if (instance) await sdk.signOut(instance);
  localStorage.removeItem('agent-settlement.uid');
  // 정산당 한 번 올린 타임라인 방문 시각도 이 기기에서 지운다(room.js)
  for (const key of Object.keys(localStorage)) if (key.startsWith('agent-settlement.timeline.')) localStorage.removeItem(key);
  location.href = to;
}
export function onSessionChange(callback) {
  return instance ? sdk.onAuthStateChanged(instance, callback) : () => {};
}
