import { randomUUID } from 'node:crypto';
import { HttpError, readJson } from './http.mjs';

const consentId = (roomId, uid) => JSON.stringify([roomId, uid]);
const DAY = 86400000;
// User-supplied browser measurements are supporting evidence, never proof of absence.
export function createLocationService({ store, clock }) {
  async function purge(uid, roomId) {
    const docs = await store.list('locationEvidence', { uid, roomId });
    const ids = new Set(docs.map(d => d.id));
    for (const d of docs) await store.delete('locationEvidence', d.id);
    for (const d of await store.list('disputes', { roomId })) {
      if (!(d.evidence || []).some(e => ids.has(e.locationId))) continue;
      const next = { ...d, evidence: d.evidence.filter(e => !ids.has(e.locationId)) };
      if (d.status === 'proposed') { next.status = 'open'; next.agreedBy = []; }
      delete next.proposal;
      await store.put('disputes', next);
    }
    // Events contain only generic wording for location-derived actions, so no
    // location summary is left in the immutable event stream after revocation.
  }
  async function active(uid, roomId) {
    const c = await store.get('locationConsents', consentId(roomId, uid));
    if (!c || Date.parse(c.expiresAt) <= clock().getTime()) {
      await purge(uid, roomId);
      if (c) await store.delete('locationConsents', c.id);
      return null;
    }
    return c;
  }
  async function evidenceFor(uid, expense, room) {
    if (!await active(uid, room.id)) return [];
    const records = await store.list('locationEvidence', { uid, roomId: room.id });
    return records.filter(e => e.expenseId === expense.id && e.action === 'checkout').map(e => ({ kind: 'text', summary: e.summary, locationId: e.id, source: 'browser_self_report', uncertain: true }));
  }
  async function sweep() {
    for (const c of await store.list('locationConsents')) await active(c.uid, c.roomId);
  }
  function register(routes, member) {
    routes.get('/api/rooms/:id/location', async ({ req, params }) => {
      const { me } = await member(req, params.id);
      const consent = await active(me.uid, params.id);
      return { consent, records: consent ? await store.list('locationEvidence', { uid: me.uid, roomId: params.id }) : [] };
    });
    routes.post('/api/rooms/:id/location/consent', async ({ req, params }) => {
      const { me } = await member(req, params.id);
      const input = await readJson(req);
      if (input?.agree !== true) throw new HttpError(400, '위치 요약 공유에 동의해 주세요');
      const expires = Date.parse(input.expiresAt);
      if (!Number.isFinite(expires) || expires <= clock().getTime() || expires > clock().getTime() + DAY) throw new HttpError(400, '동의 기간은 지금부터 최대 24시간이에요');
      await purge(me.uid, params.id);
      const consent = await store.put('locationConsents', { id: consentId(params.id, me.uid), uid: me.uid, roomId: params.id, expiresAt: new Date(expires).toISOString() });
      return { consent };
    });
    routes.post('/api/rooms/:id/location/revoke', async ({ req, params }) => {
      const { me } = await member(req, params.id);
      await purge(me.uid, params.id);
      await store.delete('locationConsents', consentId(params.id, me.uid));
      return { deleted: true };
    });
    routes.post('/api/rooms/:id/location', async ({ req, params }) => {
      const { room, me } = await member(req, params.id);
      const input = await readJson(req);
      if (!await active(me.uid, room.id)) throw new HttpError(403, '위치 요약 공유에 먼저 동의해 주세요');
      // Reject raw coordinates and arbitrary free text: only this tiny contract crosses the network.
      if (!input || Object.keys(input).some(k => !['expenseId', 'action', 'observedAt', 'relation'].includes(k))) throw new HttpError(400, '좌표 원본은 전송할 수 없어요');
      if (!['checkin', 'checkout'].includes(input.action) || !['near', 'away', 'uncertain'].includes(input.relation)) throw new HttpError(400, '위치 확인 결과가 올바르지 않아요');
      const when = Date.parse(input.observedAt);
      if (!Number.isFinite(when) || Math.abs(clock().getTime() - when) > 120000) throw new HttpError(400, '지금 측정한 위치만 사용할 수 있어요');
      const exp = await store.get('expenses', input.expenseId);
      if (!exp || exp.roomId !== room.id || !exp.present.includes(me.uid)) throw new HttpError(400, '내가 참여한 지출을 골라 주세요');
      const local = new Date(when + 9 * 3600000).toISOString();
      if (exp.date !== local.slice(0, 10)) throw new HttpError(400, '오늘 지출에만 체크인할 수 있어요. 과거 참석 여부는 추정하지 않아요');
      const relation = { near: '지정 장소 근처', away: '지정 장소 밖', uncertain: '위치 불확실' }[input.relation];
      const summary = `${local.slice(0, 10)} ${local.slice(11, 16)} (한국 시각) ${input.action === 'checkout' ? '체크아웃' : '체크인'} · ${relation} · 사용자 기기 보고, 참석·귀가 확정 아님`;
      // One record per action/expense/person. Replacing invalidates any old proposal.
      const old = (await store.list('locationEvidence', { uid: me.uid, roomId: room.id })).find(e => e.expenseId === exp.id && e.action === input.action);
      if (old) throw new HttpError(409, '이미 기록했어요. 철회·삭제 후 다시 동의하면 새로 기록할 수 있어요');
      const record = await store.put('locationEvidence', { id: randomUUID(), uid: me.uid, roomId: room.id, expenseId: exp.id, action: input.action, summary, observedAt: new Date(when).toISOString() });
      return { record };
    });
  }
  return { register, evidenceFor, sweep, purge };
}
