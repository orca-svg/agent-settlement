// 방 API(#4): 방 만들기, 초대 링크, 참가하기, 환율 정책 바꾸기·동의. #55: 나가기·내보내기, 외화 방.
// 환율 정책은 외화 방에만 있다. 원화 방은 정책을 묻지도 받지도 않는다(isForeign).
// '정산 시작'(청구서 보내기)은 외화 방이면 전원이 정책에 동의해야 열린다. 그 잠금은 src/agents/routes.mjs가 policy.mjs로 건다.
import { randomUUID, randomBytes } from 'node:crypto';
import { readJson, send, HttpError } from '../http.mjs';
import { profileOf } from '../accounts.mjs';
import { POLICIES } from '../../public/data.js';
import { subj, obj } from '../../public/ui.js';
import { active, isForeign } from '../../public/core.js';
import { currencyOf, CARD_FEE } from '../../public/currencies.js';
import { hasStarted, isDone, leaveBlock } from './policy.mjs';

const POLICY_IDS = POLICIES.map((p) => p.id); // 'actual' | 'payday' | 'settle'
const policyLabel = (id) => POLICIES.find((p) => p.id === id)?.label ?? id;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 초대 링크는 7일 뒤 만료
const startedText = (room, what) => (isDone(room) ? `정산이 끝난 방에는 ${what}` : `정산을 시작한 방에는 ${what}`);

// 방에 보일 이름·색은 따로 받지 않고 내 프로필(#2, users 문서)을 쓴다. 프로필을 바꾸면 모든 방의 멤버가 함께 바뀐다(POST /api/me)
const memberOf = async (store, who) => {
  const { name, color } = await profileOf(store, who);
  return { uid: who.uid, name, color };
};

// 초대 문서는 방마다 하나(id = roomId). 다시 만들면 덮어써서 이전 링크는 바로 무효가 된다.
// 토큰은 18바이트 난수(base64url 24자)라 추측할 수 없다. 클라이언트는 이 컬렉션을 직접 읽지 못한다(서버만).
async function findInvite(store, token, now) {
  if (!/^[A-Za-z0-9_-]{24}$/.test(String(token))) return null;
  const [inv] = await store.list('invites', { token });
  if (!inv || new Date(inv.expiresAt) <= now) return null;
  const room = await store.get('rooms', inv.roomId);
  return room ? { inv, room } : null;
}

// 참가 화면에 보여 줄 것만. 비서 기억·계좌·지출은 넣지 않는다. 환율 정책은 외화 방에만 있다
const preview = (room) => ({
  id: room.id,
  name: room.name,
  dates: room.dates ?? '',
  ...(isForeign(room) ? { currency: room.fx.currency, policy: room.policy } : {}),
  members: room.members.filter(active).map((m) => ({ name: m.name })),
});

export function registerRoomRoutes(routes, { store, clock, member, authenticate }) {
  // 방 만들기. 만든 사람이 첫 멤버가 된다. 외화 방(currency: 'JPY' 등)이면 고른 환율 정책에 이미 동의한 것으로 친다.
  // 원화 방은 policy를 보내도 쓰지 않는다. 로그인한 사람만(탈퇴 처리 중인 계정은 막는다, authenticate)
  routes.post('/api/rooms', async ({ req, res }) => {
    const who = await authenticate(req);

    const body = await readJson(req);
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new HttpError(400, '방 이름을 적어 주세요');
    if (name.length > 40) throw new HttpError(400, '방 이름은 40자까지예요');
    const currency = String(body.currency ?? 'KRW');
    const foreign = currency !== 'KRW';
    if (foreign && !currencyOf(currency)) throw new HttpError(400, '외화를 다시 골라 주세요');
    const policy = foreign ? body.policy ?? 'actual' : null;
    if (foreign && !POLICY_IDS.includes(policy)) throw new HttpError(400, '환율 정책을 다시 골라 주세요');
    const me = await memberOf(store, who);

    const room = {
      id: `r-${randomUUID().slice(0, 8)}`,
      name,
      dates: String(body.dates ?? '').trim().slice(0, 40),
      members: [me],
      currency: 'KRW', // 정산(송금)은 늘 원화로 한다. 외화 방은 fx.currency로 쓴 돈을 원화로 바꾼다
      // 환율 표는 지출을 남길 때(결제일), 청구서를 처음 보낼 때(정산일) 채운다(src/rooms/fx.mjs)
      fx: foreign ? { currency, base: {}, settle: null, cardFee: CARD_FEE, cash: {} } : null,
      policy,
      policyAgreedBy: foreign ? [who.uid] : [],
      status: 'ready',
      version: 1,
      createdBy: who.uid,
    };
    await store.put('rooms', room);
    await store.appendEvent(room.id, { from: 'system', to: 'all', kind: 'room_created', text: `${subj(me.name)} 방을 만들었어요` });
    send(res, 201, { room });
  });

  // 초대 링크 만들기·다시 만들기(멤버 누구나). 이전 링크는 무효가 된다
  routes.post('/api/rooms/:id/invite', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    if (hasStarted(room)) throw new HttpError(409, startedText(room, '더 초대할 수 없어요'));
    const token = randomBytes(18).toString('base64url');
    const expiresAt = new Date(clock().getTime() + INVITE_TTL_MS).toISOString();
    await store.put('invites', { id: room.id, roomId: room.id, token, expiresAt, createdBy: me.uid });
    return { token, expiresAt };
  });

  // 지금 살아 있는 초대 링크(멤버만). 없거나 만료됐으면 null
  routes.get('/api/rooms/:id/invite', async ({ req, params }) => {
    const { room } = await member(req, params.id);
    const inv = await store.get('invites', room.id);
    if (!inv || new Date(inv.expiresAt) <= clock()) return { invite: null };
    return { invite: { token: inv.token, expiresAt: inv.expiresAt } };
  });

  // 참가 화면: 링크만 있으면 볼 수 있다(토큰이 곧 열쇠). 신원이 있으면 이미 멤버인지도 알려 준다
  routes.get('/api/invites/:token', async ({ req, params }) => {
    const found = await findInvite(store, params.token, clock());
    if (!found) throw new HttpError(404, '만료되었거나 잘못된 초대 링크예요');
    const who = await authenticate(req).catch(() => null); // 링크만 보고 들어온 사람은 아직 로그인 전일 수 있다
    const alreadyMember = !!who && found.room.members.some((m) => m.uid === who.uid && active(m));
    return { room: preview(found.room), expiresAt: found.inv.expiresAt, alreadyMember, settling: hasStarted(found.room), done: isDone(found.room) };
  });

  // 참가하기. 참가 동의(agree: true)가 있어야 한다. 이미 멤버면 그대로 방 id를 돌려준다
  routes.post('/api/invites/:token/join', async ({ req, params }) => {
    const who = await authenticate(req);
    const found = await findInvite(store, params.token, clock());
    if (!found) throw new HttpError(404, '만료되었거나 잘못된 초대 링크예요');
    const { room } = found;
    if (room.members.some((m) => m.uid === who.uid && active(m))) return { roomId: room.id };
    const body = await readJson(req);
    if (body.agree !== true) throw new HttpError(400, '참가에 동의해 주세요');
    if (hasStarted(room)) throw new HttpError(409, isDone(room) ? '이미 정산이 끝난 방이에요' : '이미 정산을 시작한 방이에요');

    const joined = await memberOf(store, who);
    const { name } = joined;
    // 나갔던 사람이 다시 들어오면 예전 칸을 되살린다(같은 uid의 칸이 둘이 되지 않게). 정책 동의는 처음부터 다시 받는다
    const back = room.members.some((m) => m.uid === who.uid);
    await store.put('rooms', { ...room, members: back ? room.members.map((m) => (m.uid === who.uid ? joined : m)) : [...room.members, joined] });
    await store.appendEvent(room.id, {
      from: 'system',
      to: 'all',
      kind: 'member_joined',
      text: isForeign(room) ? `${subj(name)} 방에 들어왔어요. 환율 정책 ‘${policyLabel(room.policy)}’에 동의하면 정산을 시작할 수 있어요` : `${subj(name)} 방에 들어왔어요`,
    });
    return { roomId: room.id };
  });

  // 환율 정책 바꾸기(외화 방만). 바꾸면 동의를 처음부터 다시 받는다(바꾼 사람만 동의한 상태)
  routes.post('/api/rooms/:id/policy', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    if (!isForeign(room)) throw new HttpError(409, '원화 방에는 환율 정책이 없어요');
    const { policy } = await readJson(req);
    if (!POLICY_IDS.includes(policy)) throw new HttpError(400, '환율 정책을 다시 골라 주세요');
    if (hasStarted(room)) throw new HttpError(409, '정산을 시작한 뒤에는 환율 정책을 바꿀 수 없어요');
    if (policy === room.policy) return { room };
    const next = { ...room, policy, policyAgreedBy: [me.uid] };
    await store.put('rooms', next);
    await store.appendEvent(room.id, {
      from: 'system',
      to: 'all',
      kind: 'policy_changed',
      text: `${subj(me.name)} 환율 정책을 ‘${policyLabel(policy)}’로 바꿨어요. 모두 다시 동의해 주세요`,
    });
    return { room: next };
  });

  // 지금 정책에 동의하기(외화 방만). 두 번 눌러도 한 번만 들어간다
  routes.post('/api/rooms/:id/policy/agree', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    if (!isForeign(room)) throw new HttpError(409, '원화 방에는 환율 정책이 없어요');
    if (room.policyAgreedBy.includes(me.uid)) return { room };
    const next = { ...room, policyAgreedBy: [...room.policyAgreedBy, me.uid] };
    await store.put('rooms', next);
    await store.appendEvent(room.id, { from: 'system', to: 'all', kind: 'policy_agreed', text: `${subj(me.name)} 환율 정책 ‘${policyLabel(room.policy)}’에 동의했어요` });
    return { room: next };
  });

  // 방에서 빼기(#55). 정산이 끝나지 않은 돈이 남아 있으면 이유와 함께 막는다(policy.mjs의 leaveBlock).
  // 멤버 칸은 지우지 않고 left로 표시한다. 지출·송금 기록이 그 사람을 가리키고, 그 사람이 탈퇴하면 이 방의 기록도 익명으로 바꿔야 해서다.
  // 빠진 사람은 방을 읽지 못한다(app.mjs의 member, Firestore 규칙의 _memberUids)
  async function removeMember(room, uid, { self, by }) {
    const [expenses, invoices, disputes, transfers] = await Promise.all(['expenses', 'invoices', 'disputes', 'transfers'].map((col) => store.list(col, { roomId: room.id })));
    const why = leaveBlock({ room, expenses, invoices, disputes, transfers }, uid, { self });
    if (why) throw new HttpError(409, why);
    const name = room.members.find((m) => m.uid === uid).name;
    const next = { ...room, members: room.members.map((m) => (m.uid === uid ? { ...m, left: true } : m)), policyAgreedBy: (room.policyAgreedBy ?? []).filter((u) => u !== uid) };
    await store.put('rooms', next);
    await store.appendEvent(room.id, {
      from: 'system',
      to: 'all',
      kind: self ? 'member_left' : 'member_removed',
      text: self ? `${subj(name)} 방에서 나갔어요` : `${subj(by.name)} ${obj(name)} 방에서 내보냈어요`,
    });
    return next;
  }

  // 나가기: 멤버 누구나 자기 자신을
  routes.post('/api/rooms/:id/leave', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    await removeMember(room, me.uid, { self: true });
    return { left: true };
  });

  // 내보내기: 방을 만든 사람만, 잘못 들어온 사람을. 자기 자신은 나가기로 나간다
  routes.post('/api/rooms/:id/members/:uid/remove', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    if (room.createdBy !== me.uid) throw new HttpError(403, '방을 만든 사람만 내보낼 수 있어요');
    if (params.uid === me.uid) throw new HttpError(400, '나는 나가기로 방을 나가요');
    if (!room.members.some((m) => m.uid === params.uid && active(m))) throw new HttpError(404, '이 방에 없는 사람이에요');
    return { room: await removeMember(room, params.uid, { self: false, by: me }) };
  });
}
