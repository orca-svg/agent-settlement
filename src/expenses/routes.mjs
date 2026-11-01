// 지출 API. member(req, roomId)는 app.mjs가 넘겨주는 멤버 확인 함수다.
import { randomUUID } from 'node:crypto';
import { readJson, send, HttpError } from '../http.mjs';
import { toKrw, won } from '../../public/core.js';
import { subj } from '../../public/ui.js';
import { validateExpense } from './validate.mjs';
import { extractReceipt } from './receipt.mjs';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function registerExpenseRoutes(routes, { store, gemini, member, overLimit }) {
  routes.post('/api/rooms/:id/expenses', async ({ req, res, params }) => {
    const { room, me } = await member(req, params.id);
    const checked = validateExpense((await readJson(req)).expense, room);
    if (!checked.ok) throw new HttpError(400, checked.errors.join(' '));
    const expense = { ...checked.expense, id: `${room.id}-${randomUUID().slice(0, 8)}`, roomId: room.id, createdBy: me.uid };
    await store.put('expenses', expense);
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
    const { image } = await readJson(req, { limit: 2_100_000 });
    if (!IMAGE_TYPES.includes(image?.mimeType) || typeof image?.data !== 'string' || !image.data) throw new HttpError(400, '사진 파일이 아니에요');
    const started = Date.now();
    const draft = await extractReceipt(gemini, { image: { mimeType: image.mimeType, data: image.data }, room });
    console.log(`[receipts/extract] ${draft.source} ok=${draft.ok} ${Date.now() - started}ms`);
    return { draft };
  });
}
