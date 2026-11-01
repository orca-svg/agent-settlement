// 지출 API. member(req, roomId)는 app.mjs가 넘겨주는 멤버 확인 함수다.
import { randomUUID } from 'node:crypto';
import { readJson, send, HttpError } from '../http.mjs';
import { toKrw, won } from '../../public/core.js';
import { subj, topic, obj } from '../../public/ui.js';
import { MAX_RECEIPT } from '../http.mjs';
import { allocateWithGemini } from '../agents/allocate.mjs';
import { isFlagged } from '../actions.mjs';
import { validateExpense } from './validate.mjs';
import { extractReceipt } from './receipt.mjs';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function registerExpenseRoutes(routes, { store, gemini, member, overLimit }) {
  routes.post('/api/rooms/:id/expenses', async ({ req, res, params }) => {
    const { room, me } = await member(req, params.id);
    const body = await readJson(req, { limit: MAX_RECEIPT });
    const checked = validateExpense(body.expense, room);
    if (!checked.ok) throw new HttpError(400, checked.errors.join(' '));
    const photo = checked.expense.source === 'receipt' && IMAGE_TYPES.includes(body.receipt?.mimeType) && typeof body.receipt?.data === 'string' && body.receipt.data ? body.receipt : null;
    const expense = { ...checked.expense, id: `${room.id}-${randomUUID().slice(0, 8)}`, roomId: room.id, createdBy: me.uid, ...(photo ? { hasReceipt: true } : {}) };
    await store.put('expenses', expense);
    // 영수증 사진은 지출과 따로 둔다(목록을 불러올 때마다 사진을 싣지 않도록). #3에서 Firebase Storage로 옮긴다
    if (photo) await store.put('receipts', { id: expense.id, roomId: room.id, mimeType: photo.mimeType, data: photo.data });
    await store.put('rooms', { ...room, version: room.version + 1 });
    await store.appendEvent(room.id, {
      from: 'system',
      to: 'all',
      kind: 'expense_added',
      text: `${subj(me.name)} ${expense.title} ${won(toKrw(expense, room, room.policy).krw)}을 남겼어요`,
    });
    send(res, 201, { expense });
  });

  // 영수증 사진 → 초안. 저장하지 않는다. 화면은 긴 변 1600px JPEG로 줄여서 보낸다(본문 2 MB 한도)
  routes.post('/api/rooms/:id/receipts/extract', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    if (overLimit(`uid:${me.uid}`)) throw new HttpError(429, '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.');
    const { image } = await readJson(req, { limit: MAX_RECEIPT });
    if (!IMAGE_TYPES.includes(image?.mimeType) || typeof image?.data !== 'string' || !image.data) throw new HttpError(400, '사진 파일이 아니에요');
    const started = Date.now();
    const draft = await extractReceipt(gemini, { image: { mimeType: image.mimeType, data: image.data }, room });
    console.log(`[receipts/extract] ${draft.source} ok=${draft.ok} ${Date.now() - started}ms`);
    return { draft };
  });

  async function roomExpense(req, roomId, eid) {
    const { room, me } = await member(req, roomId);
    const exp = await store.get('expenses', eid);
    if (!exp || exp.roomId !== room.id) throw new HttpError(404, '지출을 찾을 수 없어요');
    return { room, me, exp };
  }

  // 지출 고치기. 같은 검증을 거쳐 덮어쓴다. 줄·함께한 사람이 바뀌면 메뉴 배분은 지우고 다시 나누게 한다.
  routes.post('/api/rooms/:id/expenses/:eid', async ({ req, params }) => {
    const { room, me, exp } = await roomExpense(req, params.id, params.eid);
    const input = (await readJson(req)).expense ?? {};
    const checked = validateExpense({ ...input, source: exp.source }, room);
    if (!checked.ok) throw new HttpError(400, checked.errors.join(' '));
    const next = checked.expense;
    const lineKey = (e) => JSON.stringify((e.items ?? []).map((it) => [it.id, it.qty, it.unit]));
    const keepAlloc = exp.alloc && next.items && lineKey(next) === lineKey(exp) && next.present.join() === exp.present.join();
    const saved = { ...next, id: exp.id, roomId: room.id, createdBy: exp.createdBy, ...(exp.hasReceipt ? { hasReceipt: true } : {}), ...(keepAlloc ? { alloc: exp.alloc } : {}) };
    await store.put('expenses', saved);
    await store.put('rooms', { ...room, version: room.version + 1 });
    await store.appendEvent(room.id, { from: 'system', to: 'all', kind: 'expense_edited', text: `${subj(me.name)} ${obj(`‘${saved.title}’`)} 고쳤어요` });
    return { expense: saved };
  });

  // 지출 지우기. 영수증 사진도 함께 지운다
  routes.post('/api/rooms/:id/expenses/:eid/delete', async ({ req, params }) => {
    const { room, me, exp } = await roomExpense(req, params.id, params.eid);
    await store.delete('expenses', exp.id);
    await store.delete('receipts', exp.id);
    await store.put('rooms', { ...room, version: room.version + 1 });
    await store.appendEvent(room.id, { from: 'system', to: 'all', kind: 'expense_deleted', text: `${subj(me.name)} ${obj(`‘${exp.title}’`)} 지웠어요` });
    return { deleted: exp.id };
  });

  // 영수증 사진 보기(방 멤버만)
  routes.get('/api/rooms/:id/expenses/:eid/receipt', async ({ req, params }) => {
    const { exp } = await roomExpense(req, params.id, params.eid);
    const photo = await store.get('receipts', exp.id);
    if (!photo) throw new HttpError(404, '저장된 영수증 사진이 없어요');
    return { mimeType: photo.mimeType, data: photo.data };
  });

  // 비서들이 공유한 기억(#5의 agents 문서)으로 영수증 줄을 나눈다. 근거 없는 줄은 지출을 남긴 사람에게 묻는다.
  routes.post('/api/rooms/:id/expenses/:eid/allocate', async ({ req, params }) => {
    const { room, me, exp } = await roomExpense(req, params.id, params.eid);
    if (!exp.items?.length) throw new HttpError(400, '영수증 줄이 있는 지출만 나눌 수 있어요');
    if (overLimit(`uid:${me.uid}`)) throw new HttpError(429, '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.');
    const memory = Object.fromEntries(await Promise.all(room.members.map(async (m) => [m.uid, (await store.get('agents', m.uid))?.memory ?? []])));
    const started = Date.now();
    const out = await allocateWithGemini(gemini, exp, room, memory);
    const latencyMs = Date.now() - started;
    const alloc = Object.fromEntries(Object.entries(out.alloc).map(([id, a]) => [id, { consumers: a.consumers, confidence: a.confidence, reason: a.reason }]));
    const saved = { ...exp, split: 'items', alloc };
    await store.put('expenses', saved);
    await store.put('rooms', { ...room, version: room.version + 1 });
    const used = Object.values(memory).reduce((n, list) => n + list.length, 0);
    const label = out.source === 'rules' ? '규칙' : out.source;
    await store.appendEvent(room.id, {
      from: exp.createdBy, to: 'all', kind: 'allocated',
      text: `${exp.title} 영수증 ${exp.items.length}줄을 비서들이 공유한 기억 ${used}개로 나눴어요.`,
      meta: `allocate · ${label} · ${(latencyMs / 1000).toFixed(1)}초`,
    });
    for (const it of exp.items.filter((x) => isFlagged(alloc[x.id]))) {
      await store.appendEvent(room.id, {
        from: exp.createdBy, to: exp.createdBy, kind: 'confirm_line',
        text: `${topic(`‘${it.name}’`)} 누가 먹었는지 기억에 없어요. 짐작하지 않고 물어볼게요.`,
        action: { type: 'confirm_line', ref: `${exp.id}:${it.id}`, for: exp.createdBy },
      });
    }
    console.log(`[allocate] ${out.source} ${latencyMs}ms`);
    return { expense: saved, source: out.source, latencyMs };
  });

  // 줄 하나를 사람이 확정한다. 확정한 줄은 확신도와 관계없이 더 묻지 않는다.
  routes.post('/api/rooms/:id/expenses/:eid/lines/:itemId', async ({ req, params }) => {
    const { room, me, exp } = await roomExpense(req, params.id, params.eid);
    const item = exp.items?.find((it) => it.id === params.itemId);
    if (!item) throw new HttpError(404, '영수증 줄을 찾을 수 없어요');
    const picked = (await readJson(req)).consumers;
    if (!Array.isArray(picked) || !picked.length) throw new HttpError(400, '적어도 한 명은 골라 주세요');
    if (picked.some((u) => !exp.present.includes(u))) throw new HttpError(400, '함께 있지 않았던 사람은 고를 수 없어요');
    const consumers = exp.present.filter((u) => picked.includes(u));
    const prev = exp.alloc?.[item.id] ?? { confidence: 1, reason: '' };
    // 비서가 짐작한 그대로 확인했으면 그 이유를 남기고, 사람이 바꿨으면 바꿨다고 남긴다
    const same = prev.consumers && prev.consumers.length === consumers.length && prev.consumers.every((u) => consumers.includes(u));
    const reason = same ? prev.reason : '직접 고쳤어요';
    const saved = { ...exp, split: 'items', alloc: { ...exp.alloc, [item.id]: { ...prev, consumers, reason, confirmed: true, confirmedBy: me.uid } } };
    await store.put('expenses', saved);
    await store.put('rooms', { ...room, version: room.version + 1 });
    const names = consumers.map((u) => room.members.find((m) => m.uid === u)?.name ?? u).join('·');
    await store.appendEvent(room.id, { from: me.uid, to: 'all', kind: 'line_confirmed', text: `${topic(`‘${item.name}’`)} ${subj(names)} 먹은 걸로 확인했어요` });
    return { expense: saved };
  });
}
