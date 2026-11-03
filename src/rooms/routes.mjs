// 방 API(#4): 방 만들기. 이후 초대·참가·환율 정책 동의도 이 파일에 더한다.
import { randomUUID } from 'node:crypto';
import { readJson, send, HttpError } from '../http.mjs';
import { identify } from '../identity.mjs';
import { POLICIES } from '../../public/data.js';
import { subj } from '../../public/ui.js';

const POLICY_IDS = POLICIES.map((p) => p.id); // 'actual' | 'payday' | 'settle'

export function registerRoomRoutes(routes, { store }) {
  // 방 만들기. 만든 사람이 첫 멤버가 되고, 고른 환율 정책에 이미 동의한 것으로 친다.
  routes.post('/api/rooms', async ({ req, res }) => {
    const who = await identify(req, store);
    if (!who) throw new HttpError(401, '누구인지 알려 주세요');

    const body = await readJson(req);
    const name = String(body.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new HttpError(400, '방 이름을 적어 주세요');
    if (name.length > 40) throw new HttpError(400, '방 이름은 40자까지예요');
    const policy = body.policy ?? 'actual';
    if (!POLICY_IDS.includes(policy)) throw new HttpError(400, '환율 정책을 다시 골라 주세요');

    const room = {
      id: `r-${randomUUID().slice(0, 8)}`,
      name,
      dates: String(body.dates ?? '').trim().slice(0, 40),
      members: [{ uid: who.uid, name: who.name }],
      currency: 'KRW',
      fx: null, // 외화 방(환율 표)은 나중 단계에서
      policy,
      policyAgreedBy: [who.uid],
      status: 'ready',
      version: 1,
      createdBy: who.uid,
    };
    await store.put('rooms', room);
    await store.appendEvent(room.id, { from: 'system', to: 'all', kind: 'room_created', text: `${subj(who.name)} 방을 만들었어요` });
    send(res, 201, { room });
  });
}
