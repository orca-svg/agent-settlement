import { randomUUID } from 'node:crypto';
import { HttpError, readJson } from './http.mjs';
import { expenseWindow, kstTime, timelineSummary } from '../public/timeline.js';

const consentId = (roomId, uid) => JSON.stringify([roomId, uid]);
const DAY = 86400000;
// 이의를 마무리할 때까지 요약을 두는 기간. 지나면 요약을 지우고 그 요약을 쓴 미확정 중재안을 다시 열린 이의로 돌린다
const KEEP = 7 * DAY;
// 요약마다 붙인 뒤 7일(PRIVACY.md '붙인 뒤 7일'). 이 필드가 없는 예전 기록은 붙인 시각으로 센다
const expiresOf = e => Date.parse(e.expiresAt ?? '') || Date.parse(e.createdAt) + KEEP;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIELDS = ['agree', 'expenseId', 'leftAt', 'nextAt', 'nextHome', 'stayedUntil'];

// #7 위치 근거: 이의를 낼 때 사용자가 고른 Google 지도 타임라인 파일에서 브라우저가 찾은 시각만 받는다(public/timeline.js).
// 파일·좌표·장소 이름은 서버에 오지 않는다. 본인이 낸 자료라 위변조할 수 있으므로 늘 사람 확인이 필요한 근거로 다룬다.
export function createLocationService({ store, clock }) {
  // only를 주면 그 요약만(기한이 지난 것), 없으면 그 방의 내 요약 전부(철회·동의 끝)를 지운다
  async function purge(uid, roomId, only) {
    const all = await store.list('locationEvidence', { uid, roomId });
    const docs = only ? all.filter(only) : all;
    if (!docs.length) return;
    const ids = new Set(docs.map(d => d.id));
    for (const d of docs) await store.delete('locationEvidence', d.id);
    for (const d of await store.list('disputes', { roomId })) {
      if (!(d.evidence || []).some(e => ids.has(e.locationId))) continue;
      const next = { ...d, evidence: d.evidence.filter(e => !ids.has(e.locationId)) };
      if (d.status === 'proposed') { next.status = 'open'; next.agreedBy = []; }
      delete next.proposal;
      await store.put('disputes', next);
    }
    // 청구서에는 요약 글이 없고 붙었다는 표시만 있으니, 그 방에 남은 내 요약이 없으면 그 표시도 거둔다
    if (docs.length === all.length) for (const i of await store.list('invoices', { roomId })) {
      if (i.to === uid && i.hasLocationSummary) await store.put('invoices', { ...i, hasLocationSummary: false });
    }
    await store.appendEvent(roomId, {
      at: clock().toISOString(), from: 'system', to: 'all', kind: 'location_removed',
      text: '보관 기간이 끝났거나 동의를 철회해 위치 요약을 지웠어요. 열린 이의를 다시 확인해 주세요.',
    });
    // 위치에서 나온 행동은 이벤트에 일반 문구로만 남겨, 철회 뒤 지울 수 없는 기록에 요약이 남지 않게 한다
  }
  async function active(uid, roomId) {
    const c = await store.get('locationConsents', consentId(roomId, uid));
    const now = clock().getTime();
    if (!c || Date.parse(c.expiresAt) <= now) {
      await purge(uid, roomId);
      if (c) await store.delete('locationConsents', c.id);
      return null;
    }
    await purge(uid, roomId, e => expiresOf(e) <= now); // 동의가 남아 있어도 기한이 지난 요약은 하나씩 지운다
    return c;
  }
  async function evidenceFor(uid, expense, room) {
    if (!await active(uid, room.id)) return [];
    const records = await store.list('locationEvidence', { uid, roomId: room.id });
    // 떠난 시각은 중재가 그 뒤 주문에서 그 사람을 빼는 left_at으로, 결제까지 머문 사실은 글로 넘긴다.
    // 예전 체크인·체크아웃 기록(source 없음)은 근거로 쓰지 않는다
    return records.filter(e => e.expenseId === expense.id && e.source === 'timeline_export').map(e => ({
      ...(e.leftAt ? { kind: 'left_at', time: e.leftAt } : { kind: 'text', stayedUntil: e.stayedUntil }),
      summary: e.summary, locationId: e.id, source: 'timeline_export', requiresHumanApproval: true,
    }));
  }
  // 끝난 동의를 정리한다. roomId를 주면 그 방만(방 요청은 그 방의 줄 안에서 부른다), 없으면 모든 방(주기 작업)
  async function sweep(roomId) {
    for (const c of await store.list('locationConsents', roomId ? { roomId } : {})) await active(c.uid, c.roomId);
  }
  // 정리할 것이 있는지만 본다(쓰지 않는다). 줄에 서지 않고 읽는 요청이 이것으로 줄에 설지 정한다
  async function hasExpired(roomId) {
    const now = clock().getTime();
    return (await store.list('locationConsents', { roomId })).some(c => Date.parse(c.expiresAt) <= now)
      || (await store.list('locationEvidence', { roomId })).some(e => expiresOf(e) <= now);
  }

  // 받은 시각이 그 지출 시간대(첫 주문~결제) 안에서 나올 수 있는 값인지. 요약 글은 서버가 같은 규칙으로 다시 만든다
  function checkResult(input, exp) {
    const { from, until } = expenseWindow(exp);
    if (input.stayedUntil !== undefined) {
      if (input.leftAt !== undefined || input.stayedUntil !== kstTime(until)) throw new HttpError(400, '결제 시각까지 머문 기록만 보낼 수 있어요');
      return { stayedUntil: input.stayedUntil };
    }
    if (!HHMM.test(input.leftAt ?? '')) throw new HttpError(400, '떠난 시각을 확인해 주세요');
    // 자정을 넘긴 지출이면 떠난 시각이 결제일의 전날일 수 있다
    const left = [0, -DAY].map(d => Date.parse(`${exp.date}T${input.leftAt}:00+09:00`) + d).find(ms => ms > from && ms < until);
    if (left === undefined) throw new HttpError(400, '떠난 시각이 그 지출의 첫 주문과 결제 사이가 아니에요');
    if (input.nextAt != null && !HHMM.test(input.nextAt)) throw new HttpError(400, '도착 시각을 확인해 주세요');
    return { leftAt: input.leftAt, nextAt: input.nextAt ?? null, nextHome: input.nextHome === true };
  }

  function register(routes, member) {
    routes.get('/api/rooms/:id/location', async ({ req, params }) => {
      const { me } = await member(req, params.id);
      const consent = await active(me.uid, params.id);
      return { consent, records: consent ? await store.list('locationEvidence', { uid: me.uid, roomId: params.id }) : [] };
    });
    routes.post('/api/rooms/:id/location/revoke', async ({ req, params }) => {
      const { me } = await member(req, params.id);
      await purge(me.uid, params.id);
      await store.delete('locationConsents', consentId(params.id, me.uid));
      return { deleted: true };
    });
    // 이의를 낼 때 타임라인에서 찾은 결과를 붙인다. 붙이는 이 순간에 동의를 받고, 요약은 7일 동안 둔다
    routes.post('/api/rooms/:id/location/timeline', async ({ req, params }) => {
      const { room, me } = await member(req, params.id);
      const input = await readJson(req);
      if (input?.agree !== true) throw new HttpError(400, '위치 요약을 보내는 데 동의해 주세요');
      if (Object.keys(input).some(k => !FIELDS.includes(k))) throw new HttpError(400, '타임라인에서 찾은 시각만 보낼 수 있어요');
      const exp = await store.get('expenses', input.expenseId);
      if (!exp || exp.roomId !== room.id || !exp.present.includes(me.uid)) throw new HttpError(400, '내가 함께 있던 지출을 골라 주세요');
      const result = checkResult(input, exp);
      await active(me.uid, room.id); // 기한이 지난 요약을 먼저 지워, 그 지출에 다시 붙일 수 있게 한다
      const mine = await store.list('locationEvidence', { uid: me.uid, roomId: room.id });
      if (mine.some(e => e.expenseId === exp.id)) throw new HttpError(409, '이 지출에는 이미 위치 요약을 붙였어요. 지우고 다시 붙여 주세요');
      // 요약마다 자기 기한(붙인 뒤 7일)을 갖는다. 동의는 가장 늦게 붙인 요약이 끝날 때까지 이어지고,
      // 먼저 붙인 요약은 동의가 이어져도 자기 기한에 지워진다(active)
      const now = clock();
      const expiresAt = new Date(now.getTime() + KEEP).toISOString();
      await store.put('locationConsents', { id: consentId(room.id, me.uid), uid: me.uid, roomId: room.id, expiresAt });
      const record = await store.put('locationEvidence', {
        id: randomUUID(), uid: me.uid, roomId: room.id, expenseId: exp.id, source: 'timeline_export',
        ...result, summary: timelineSummary(result, exp), createdAt: now.toISOString(), expiresAt,
      });
      return { record };
    });
  }
  return { register, evidenceFor, sweep, hasExpired, purge };
}
