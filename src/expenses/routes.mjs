// 지출 API. member(req, roomId)는 app.mjs가 넘겨주는 멤버 확인 함수다.
import { randomUUID } from 'node:crypto';
import { readJson, send, HttpError } from '../http.mjs';
import { toKrw, won } from '../../public/core.js';
import { subj } from '../../public/ui.js';
import { validateExpense } from './validate.mjs';

export function registerExpenseRoutes(routes, { store, member }) {
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
}
