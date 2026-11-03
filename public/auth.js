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
export const currentUser = () => instance?.currentUser || null;
export async function token() { await initAuth(); return instance?.currentUser?.getIdToken() || null; }
export async function login() {
  await initAuth();
  if (!instance) throw new Error('Google 로그인을 준비 중이에요. 지금은 데모를 이용할 수 있어요');
  return sdk.signInWithPopup(instance, new sdk.GoogleAuthProvider());
}
export async function reauthenticate() {
  if (!currentUser()) throw new Error('로그인이 필요해요');
  await sdk.reauthenticateWithPopup(currentUser(), new sdk.GoogleAuthProvider());
  await currentUser().getIdToken(true);
}
export async function logout() {
  if (instance) await sdk.signOut(instance);
  localStorage.removeItem('agent-settlement.uid');
  location.href = './';
}
export function onSessionChange(callback) {
  return instance ? sdk.onAuthStateChanged(instance, callback) : () => {};
}
