import { HttpError, readJson } from './http.mjs';
import { revokeQrLinks, revokeUserQr } from './payments/qr.mjs';
import { randomProfileColor } from '../public/profile-colors.js';
export function registerAccountRoutes(routes, { store, authenticate, auth, clock, onErased = () => {} }) {
  routes.get('/api/me/deletion', async ({ req }) => {
    const me = await authenticate(req, { allowDeleting: true });
    return { pending: Boolean(await store.get('deletedUsers', me.uid)) };
  });
  routes.get('/api/me', async ({ req }) => {
    const me = await authenticate(req);
    // 처음 들어온 사람은 견본 중 무작위 색으로 시작한다. 저장해 두어 다시 열어도 같은 색이다
    const profile = await store.get('users', me.uid) || await store.put('users', { id: me.uid, name: me.name, color: randomProfileColor() });
    return { profile };
  });
  routes.post('/api/me', async ({ req }) => {
    const me = await authenticate(req);
    const input = await readJson(req);
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40 || !/^#[0-9a-f]{6}$/i.test(input.color)) throw new HttpError(400, '이름(1~40자)과 프로필 색을 확인해 주세요');
    const profile = await store.put('users', { id: me.uid, name: input.name.trim(), color: input.color });
    for (const room of await store.list('rooms')) {
      if (room.members.some(m => m.uid === me.uid)) {
        await store.put('rooms', { ...room, members: room.members.map(m => m.uid === me.uid ? { ...m, name: profile.name, color: profile.color } : m) });
        await store.appendEvent(room.id, { at: clock().toISOString(), from: 'system', to: 'all', kind: 'profile_updated', text: '참여자 프로필이 바뀌었어요.' });
      }
    }
    return { profile };
  });
  routes.get('/api/rooms', async ({ req }) => {
    const me = await authenticate(req);
    return { rooms: (await store.list('rooms')).filter(r => r.members.some(m => m.uid === me.uid)).map(({ id, name, dates }) => ({ id, name, dates })) };
  });
  routes.post('/api/me/delete', async ({ req }) => {
    const me = await authenticate(req, { allowDeleting: true });
    if (!auth || !Number.isFinite(me.authTime) || clock().getTime() / 1000 - me.authTime > 300) throw new HttpError(401, '탈퇴하려면 Google 계정으로 다시 로그인해 주세요');
    if (typeof store.eraseUser !== 'function') throw new HttpError(503, '현재 저장소의 계정 삭제 연결이 필요해요');
    await store.put('deletedUsers', { id: me.uid });
    const { removedLinks } = await store.eraseUser(me.uid);
    revokeQrLinks(removedLinks);
    revokeUserQr(me.uid);
    onErased();
    try { await auth.deleteUser(me.uid); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; }
    return { deleted: true, sharedHistory: 'anonymized' };
  });
}
