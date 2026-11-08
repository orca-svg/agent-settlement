import { HttpError, readJson } from './http.mjs';
import { revokeQrLinks, revokeUserQr } from './payments/qr.mjs';
import { randomProfileColor } from '../public/profile-colors.js';
import { forgetVerified } from './identity.mjs';
import { pendingActions } from './actions.mjs';
import { progressOf, overallRatio } from '../public/progress.js';

const VIEW = ['expenses', 'invoices', 'disputes', 'transfers'];
// 내 방 목록의 진행 줄: 몇 번째 단계인지(progress.js)와 내 할 일 수. 방 화면과 같은 판정이다.
// 끝난 방은 목록을 읽지 않아도 '끝'이다. 진행 중인 방은 방 화면과 같은 네 목록을 읽는데,
// Firestore 읽기가 방 수만큼 늘지만 읽기 캐시(#53)가 반복 요청을 메모리에서 답한다
async function progressIn(store, room, uid) {
  const view = { room };
  if (room.status !== 'done') {
    const lists = await Promise.all(VIEW.map((col) => store.list(col, { roomId: room.id })));
    VIEW.forEach((col, i) => { view[col] = lists[i]; });
  }
  const p = progressOf(view, uid);
  return { step: p.step, label: p.label, summary: p.summary, ratio: overallRatio(p), mine: pendingActions(view).filter((a) => a.for === uid).length, extra: Boolean(p.extra) };
}
// 내 프로필(방에 보일 이름·색). 처음 들어온 사람은 로그인 이름과 견본 중 무작위 색으로 시작한다.
// 저장해 두어 다시 열어도 같은 색이고, 동시에 와도 하나로 정해지게 없을 때만 넣는다. 방 만들기·참가(#4)도 이 값을 멤버에 넣는다
export const profileOf = async (store, me) => await store.get('users', me.uid) || await store.putIfAbsent('users', { id: me.uid, name: me.name, color: randomProfileColor() });

export function registerAccountRoutes(routes, { store, authenticate, auth, clock, onErased = () => {} }) {
  routes.get('/api/me/deletion', async ({ req }) => {
    const me = await authenticate(req, { allowDeleting: true });
    return { pending: Boolean(await store.get('deletedUsers', me.uid)) };
  });
  routes.get('/api/me', async ({ req }) => {
    const me = await authenticate(req);
    return { profile: await profileOf(store, me) };
  });
  routes.post('/api/me', async ({ req }) => {
    const me = await authenticate(req);
    const input = await readJson(req);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40 || !/^#[0-9a-f]{6}$/i.test(input.color)) throw new HttpError(400, '이름(1~40자)과 프로필 색을 확인해 주세요');
    const profile = await store.put('users', { id: me.uid, name: input.name.trim(), color: input.color });
    for (const room of await store.roomsOf(me.uid)) {
      await store.put('rooms', { ...room, members: room.members.map(m => m.uid === me.uid ? { ...m, name: profile.name, color: profile.color } : m) });
      await store.appendEvent(room.id, { at: clock().toISOString(), from: 'system', to: 'all', kind: 'profile_updated', text: '참여자 프로필이 바뀌었어요.' });
    }
    return { profile };
  });
  routes.get('/api/rooms', async ({ req }) => {
    const me = await authenticate(req);
    // 서비스의 모든 방이 아니라 내가 멤버인 방만 읽는다(Firestore는 읽은 문서 수가 비용, #3).
    // status로 화면이 진행 중인 방과 끝난 방('done', #55)을 나눈다. 없으면 준비 중이다
    const rooms = await store.roomsOf(me.uid);
    return { rooms: await Promise.all(rooms.map(async (room) => ({ id: room.id, name: room.name, dates: room.dates, status: room.status ?? 'ready', progress: await progressIn(store, room, me.uid) }))) };
  });
  routes.post('/api/me/delete', async ({ req }) => {
    const me = await authenticate(req, { allowDeleting: true });
    // 검증된 토큰(취소 여부까지 확인)만 받는다. 다시 로그인 창은 띄우지 않고, 되돌릴 수 없으니 화면에서 한 번 확인을 받는다
    if (!auth) throw new HttpError(401, '로그인이 필요해요');
    if (typeof store.eraseUser !== 'function') throw new HttpError(503, '현재 저장소의 계정 삭제 연결이 필요해요');
    await store.put('deletedUsers', { id: me.uid });
    const { removedLinks } = await store.eraseUser(me.uid);
    revokeQrLinks(removedLinks);
    revokeUserQr(me.uid);
    onErased();
    try { await auth.deleteUser(me.uid); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    forgetVerified(auth, me.uid);
    return { deleted: true, sharedHistory: 'anonymized' };
  });
}
