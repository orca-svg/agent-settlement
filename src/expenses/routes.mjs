// 지출 API. member(req, roomId)는 app.mjs가 넘겨주는 멤버 확인 함수다.
import { randomUUID } from 'node:crypto';
import { readJson, send, HttpError } from '../http.mjs';
import { toKrw, won } from '../../public/core.js';
import { subj, topic, obj, whose } from '../../public/ui.js';
import { MAX_RECEIPT } from '../http.mjs';
import { allocateWithGemini, publicReason } from '../agents/allocate.mjs';
import { roomMemory, memoryKey } from '../agents/memory.mjs';
import { isFlagged } from '../actions.mjs';
import { supersedeDisputes } from '../agents/disputes.mjs';
import { validateExpense } from './validate.mjs';
import { extractReceipt } from './receipt.mjs';
import { isDone } from '../rooms/policy.mjs';
import { withDayRate } from '../rooms/fx.mjs';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// 정산이 끝난 방은 닫힌다(#55). 지출을 바꾸면 이미 '받았어요'로 끝난 돈을 다시 나눠 또 보내게 된다
function open(room) {
  if (isDone(room)) throw new HttpError(409, '정산이 끝난 방이라 지출을 더 남기거나 고칠 수 없어요');
}

export function registerExpenseRoutes(routes, { store, gemini, member, overLimit, allocCache, fx }) {
  routes.post('/api/rooms/:id/expenses', async ({ req, res, params }) => {
    const { room: found, me } = await member(req, params.id);
    open(found);
    const body = await readJson(req, { limit: MAX_RECEIPT });
    const room = await withDayRate(fx, found, body.expense); // 외화 지출이면 결제일 환율을 받아 방 표에 넣는다(#55)
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

  async function roomExpense(req, roomId, eid, { read = false } = {}) {
    const { room, me } = await member(req, roomId);
    if (!read) open(room);
    const exp = await store.get('expenses', eid);
    if (!exp || exp.roomId !== room.id) throw new HttpError(404, '지출을 찾을 수 없어요');
    return { room, me, exp };
  }

  // 지출 고치기. 같은 검증을 거쳐 덮어쓴다. 줄·함께한 사람이 바뀌면 메뉴 배분은 지우고 다시 나누게 한다.
  routes.post('/api/rooms/:id/expenses/:eid', async ({ req, params }) => {
    const { room: found, me, exp } = await roomExpense(req, params.id, params.eid);
    const input = (await readJson(req)).expense ?? {};
    const room = await withDayRate(fx, found, input);
    const checked = validateExpense({ ...input, source: exp.source }, room);
    if (!checked.ok) throw new HttpError(400, checked.errors.join(' '));
    const next = checked.expense;
    const lineKey = (e) => JSON.stringify((e.items ?? []).map((it) => [it.id, it.qty, it.unit]));
    const keepAlloc = exp.alloc && next.items && lineKey(next) === lineKey(exp) && next.present.join() === exp.present.join();
    const saved = { ...next, id: exp.id, roomId: room.id, createdBy: exp.createdBy, ...(exp.hasReceipt ? { hasReceipt: true } : {}), ...(keepAlloc ? { alloc: exp.alloc, allocMemory: exp.allocMemory } : {}) };
    await store.put('expenses', saved);
    await store.put('rooms', { ...room, version: room.version + 1 });
    await store.appendEvent(room.id, { from: 'system', to: 'all', kind: 'expense_edited', text: `${subj(me.name)} ${obj(`‘${saved.title}’`)} 고쳤어요` });
    await supersedeDisputes(store, room.id, exp, saved);
    return { expense: saved };
  });

  // 지출 지우기. 영수증 사진도 함께 지운다
  routes.post('/api/rooms/:id/expenses/:eid/delete', async ({ req, params }) => {
    const { room, me, exp } = await roomExpense(req, params.id, params.eid);
    await store.delete('expenses', exp.id);
    await store.delete('receipts', exp.id);
    await store.put('rooms', { ...room, version: room.version + 1 });
    await store.appendEvent(room.id, { from: 'system', to: 'all', kind: 'expense_deleted', text: `${subj(me.name)} ${obj(`‘${exp.title}’`)} 지웠어요` });
    await supersedeDisputes(store, room.id, exp);
    return { deleted: exp.id };
  });

  // 영수증 사진 보기(방 멤버만)
  routes.get('/api/rooms/:id/expenses/:eid/receipt', async ({ req, params }) => {
    const { exp } = await roomExpense(req, params.id, params.eid, { read: true });
    const photo = await store.get('receipts', exp.id);
    if (!photo) throw new HttpError(404, '저장된 영수증 사진이 없어요');
    return { mimeType: photo.mimeType, data: photo.data };
  });

  // 비서들이 공유한 기억(#5의 agents 문서)으로 영수증 줄을 나눈다. 근거 없는 줄은 지출을 남긴 사람에게 묻는다.
  routes.post('/api/rooms/:id/expenses/:eid/allocate', async ({ req, params }) => {
    const { room, me, exp } = await roomExpense(req, params.id, params.eid);
    if (!exp.items?.length) throw new HttpError(400, '영수증 줄이 있는 지출만 나눌 수 있어요');
    const memory = await roomMemory(store, room);
    // 이미 나눴고 그때와 기억이 같으면 같은 답이 나올 뿐이다. 다시 나누면 확인한 줄이 지워지고 버전이 올라
    // 보낸 청구서까지 밀려나니, 아무것도 바꾸지 않는다(화면은 allocFresh로 버튼을 미리 막는다)
    if (exp.alloc && exp.allocMemory === memoryKey(memory)) throw new HttpError(409, '바뀐 것이 없어 다시 나누지 않았어요. 지출을 고치거나 비서의 기억이 바뀌면 다시 나눌 수 있어요');
    if (overLimit(`uid:${me.uid}`)) throw new HttpError(429, '요청이 너무 많아요. 10분 뒤에 다시 시도해 주세요.');
    const started = Date.now();
    const out = await allocateWithGemini(gemini, exp, room, memory, { cache: allocCache });
    const latencyMs = Date.now() - started;
    // 묻지 않아도 정해진 배분(obvious)의 이유는 사람 수·줄 수뿐이라 그대로 두고, 나머지는 기억이 새지 않는 이유로 바꾼다
    const reasonOf = (id, a) => (out.how === 'obvious' ? a.reason : publicReason(exp.items.find((it) => it.id === id), a, exp, room));
    const alloc = Object.fromEntries(Object.entries(out.alloc).map(([id, a]) => [id, { consumers: a.consumers, confidence: a.confidence, reason: reasonOf(id, a) }]));
    const saved = { ...exp, split: 'items', alloc, allocMemory: memoryKey(memory) };
    await store.put('expenses', saved);
    await store.put('rooms', { ...room, version: room.version + 1 });
    const used = Object.values(memory).reduce((n, list) => n + list.length, 0);
    const label = out.source === 'rules' ? '규칙' : out.source;
    await store.appendEvent(room.id, {
      from: exp.createdBy, to: 'all', kind: 'allocated',
      text: out.how === 'obvious' ? `${topic(`‘${exp.title}’`)} ${out.why}` : `${exp.title} 영수증 ${exp.items.length}줄을 비서들이 공유한 기억 ${used}개로 나눴어요.`,
      meta: out.how === 'obvious' ? '나눈 방법: AI 없이 규칙으로'
        : out.how === 'cache' ? `나눈 방법: ${label} · 이전 답 재사용`
        : `나눈 방법: ${label} · ${(latencyMs / 1000).toFixed(1)}초 걸렸어요`,
    });
    for (const it of exp.items.filter((x) => isFlagged(alloc[x.id]))) {
      await store.appendEvent(room.id, {
        from: exp.createdBy, to: exp.createdBy, kind: 'confirm_line',
        text: `${topic(`‘${it.name}’`)} 어떻게 나눌지 비서들의 기억에 근거가 없어요. 짐작하지 않고 물어볼게요.`,
        action: { type: 'confirm_line', ref: `${exp.id}:${it.id}`, for: exp.createdBy },
      });
    }
    await supersedeDisputes(store, room.id, exp, saved);
    console.log(`[allocate] ${out.how} ${out.source} ${latencyMs}ms`);
    return { expense: saved, source: out.source, how: out.how, latencyMs };
  });

  // 비서가 짐작한 배분을 그대로 확정한다(줄마다 누르는 번거로움을 덜려고). 근거가 약해 사람에게 물은 줄만 확정하고,
  // 아직 나누지 않은 줄은 짐작이 없어 건드리지 않는다. edits: 화면에서 고쳐 둔 줄 { 줄 id: 먹은 사람 }은 짐작 대신 그 값으로
  function confirmGuesses(exp, uid, edits = {}) {
    const lines = (exp.items ?? []).filter((it) => isFlagged(exp.alloc?.[it.id]));
    if (!lines.length) return null;
    const alloc = { ...exp.alloc };
    for (const it of lines) {
      const picked = Array.isArray(edits[it.id]) && edits[it.id].length ? exp.present.filter((u) => edits[it.id].includes(u)) : null;
      if (picked && !picked.length) throw new HttpError(400, '함께 있지 않았던 사람은 고를 수 없어요');
      alloc[it.id] = { ...alloc[it.id], ...(picked ? { consumers: picked, reason: '직접 고쳤어요' } : {}), confirmed: true, confirmedBy: uid };
    }
    return { before: exp, saved: { ...exp, split: 'items', alloc }, count: lines.length };
  }
  // 확정한 지출을 저장하고 방 version은 한 번만 올린다(청구서는 한 번만 다시 보내면 된다)
  async function saveGuesses(room, me, done) {
    if (!done.length) return { expenses: [], confirmed: 0 };
    for (const { saved } of done) await store.put('expenses', saved);
    await store.put('rooms', { ...room, version: room.version + 1 });
    const count = done.reduce((n, d) => n + d.count, 0);
    const what = done.length === 1 ? `‘${done[0].saved.title}’의 ${count}줄을` : `지출 ${done.length}건의 ${count}줄을`;
    await store.appendEvent(room.id, { from: me.uid, to: 'all', kind: 'lines_confirmed', text: `${what} 비서가 짐작한 대로 확인했어요` });
    for (const { before, saved } of done) await supersedeDisputes(store, room.id, before, saved);
    return { expenses: done.map((d) => d.saved), confirmed: count };
  }

  // 지출 하나의 확인할 줄을 모두 짐작대로(고쳐 둔 줄은 고친 대로) 확정한다. { edits? }
  routes.post('/api/rooms/:id/expenses/:eid/confirm-guesses', async ({ req, params }) => {
    const { room, me, exp } = await roomExpense(req, params.id, params.eid);
    const { edits } = await readJson(req);
    const done = confirmGuesses(exp, me.uid, edits && typeof edits === 'object' ? edits : {});
    return saveGuesses(room, me, done ? [done] : []);
  });

  // 방의 모든 지출에서 확인할 줄을 짐작대로 확정한다(청구서 보내기가 막혔을 때 한 번에)
  routes.post('/api/rooms/:id/confirm-guesses', async ({ req, params }) => {
    const { room, me } = await member(req, params.id);
    open(room);
    const done = (await store.list('expenses', { roomId: room.id })).map((e) => confirmGuesses(e, me.uid)).filter(Boolean);
    return saveGuesses(room, me, done);
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
    await store.appendEvent(room.id, { from: me.uid, to: 'all', kind: 'line_confirmed', text: `${topic(`‘${item.name}’`)} ${whose(names)} 몫으로 확인했어요` });
    await supersedeDisputes(store, room.id, exp, saved);
    return { expense: saved };
  });
}
