// #55 방 마무리: 나가기·내보내기, 정산 완료 상태, 그리고 '환율 정책은 외화 방에만'.
// 완료 기준: 정산이 끝나지 않은 방에서 나가려 하면 이유와 함께 막힌다 / 모든 송금이 확인되면 방이 '완료'로 바뀌고 내 방 목록에서 따로 보인다.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { memoryOf } from '../src/agents/memory.mjs';

const store = new MemoryStore();
const now = new Date('2026-11-03T10:00:00Z'); // 한국 시각 11/3 19:00
let fxDown = false;
const fxRates = { rateOn: async () => { if (fxDown) throw new Error('down'); return 905.5; } };
let server;
let base;
before(async () => {
  server = createApp({ store, gemini: null, clock: () => now, env: { DEV_SEED: '1' }, fxRates });
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = async (method, path, uid, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(uid ? { 'x-demo-user': uid } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const post = (path, uid, body = {}) => call('POST', path, uid, body);
const get = (path, uid) => call('GET', path, uid);

const NAMES = { me: '재윤', cs: '철수', yh: '영희', ms: '민수' };
// 모두 프로필이 있고, 청구서는 비서가 바로 받는다(자동 수락 한도 넉넉히)
async function people(uids) {
  for (const uid of uids) {
    await post('/api/me', uid, { name: NAMES[uid], color: '#3478f6' });
    await store.put('agents', { id: uid, uid, rules: { autoAccept: 1_000_000, sendWhen: 'now', onDispute: 'ask', notify: 'actions' } });
  }
}
// 첫 사람이 방을 만들고 나머지가 초대 링크로 들어온다. 외화 방이면 모두 정책에 동의한다
async function roomOf(uids, { currency = 'KRW', policy } = {}) {
  await people(uids);
  const { json } = await post('/api/rooms', uids[0], { name: '여행', currency, policy });
  const roomId = json.room.id;
  const { json: inv } = await post(`/api/rooms/${roomId}/invite`, uids[0]);
  for (const uid of uids.slice(1)) {
    await post(`/api/invites/${inv.token}/join`, uid, { agree: true });
    if (currency !== 'KRW') await post(`/api/rooms/${roomId}/policy/agree`, uid);
  }
  return { roomId, token: inv.token };
}
const spend = (roomId, payer, present, extra = {}) =>
  post(`/api/rooms/${roomId}/expenses`, payer, { expense: { title: '저녁', amount: 30000, currency: 'KRW', payer, method: 'card', present, date: '2026-11-03', time: '19:00', ...extra } });
const room = (roomId) => store.get('rooms', roomId);
const kinds = async (roomId) => (await store.listEvents(roomId)).map((e) => e.kind);

// ---------------------------------------------------------------- 환율 정책은 외화 방에만
test('원화 방은 환율 정책을 받지 않고(409), 정책 동의 없이 정산을 시작한다', async () => {
  const { roomId, token } = await roomOf(['me', 'cs']);
  assert.equal((await post(`/api/rooms/${roomId}/policy/agree`, 'cs')).status, 409);
  assert.equal((await post(`/api/rooms/${roomId}/policy`, 'me', { policy: 'settle' })).status, 409);
  const preview = (await get(`/api/invites/${token}`)).json.room;
  assert.ok(!('policy' in preview) && !('currency' in preview), '참가 화면에도 정책이 없다');
  const joined = (await store.listEvents(roomId)).find((e) => e.kind === 'member_joined');
  assert.ok(!joined.text.includes('환율'), joined.text);
  await spend(roomId, 'me', ['me', 'cs']);
  assert.equal((await post(`/api/rooms/${roomId}/invoices/send`, 'me')).status, 200);
  assert.equal((await room(roomId)).status, 'settling');
});

test('운영에 남은 예전 원화 방(policy: actual, 일부만 동의)도 정책을 무시하고 정산을 시작한다', async () => {
  await people(['me', 'cs']);
  await store.put('rooms', {
    id: 'r-legacy', name: '회식', dates: '', currency: 'KRW', fx: null, policy: 'actual', policyAgreedBy: ['me'],
    members: [{ uid: 'me', name: '재윤' }, { uid: 'cs', name: '철수' }], status: 'ready', version: 1, createdBy: 'me',
  });
  await spend('r-legacy', 'me', ['me', 'cs']);
  assert.equal((await get('/api/rooms/r-legacy', 'cs')).status, 200);
  assert.equal((await post('/api/rooms/r-legacy/policy/agree', 'cs')).status, 409);
  assert.equal((await post('/api/rooms/r-legacy/invoices/send', 'me')).status, 200);
});

test('외화 방은 여전히 전원이 정책에 동의해야 정산을 시작한다', async () => {
  await people(['me', 'cs']);
  const { json } = await post('/api/rooms', 'me', { name: '오사카', currency: 'JPY' });
  const { json: inv } = await post(`/api/rooms/${json.room.id}/invite`, 'me');
  await post(`/api/invites/${inv.token}/join`, 'cs', { agree: true });
  const joined = (await store.listEvents(json.room.id)).find((e) => e.kind === 'member_joined');
  assert.match(joined.text, /환율 정책 ‘실제 낸 원화’/);
  const blocked = await post(`/api/rooms/${json.room.id}/invoices/send`, 'me');
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /철수/);
});

test("'정산일 기준율' 외화 방은 청구서를 처음 보낼 때 그날 환율을 정해 두고, 못 받으면 보내지 않는다", async () => {
  const { roomId } = await roomOf(['me', 'cs'], { currency: 'JPY', policy: 'settle' });
  assert.equal((await spend(roomId, 'me', ['me', 'cs'], { currency: 'JPY', amount: 3000, date: '2026-11-02' })).status, 201);
  assert.equal((await room(roomId)).fx.base['2026-11-02'], 905.5, '결제일 환율은 지출을 남길 때 받았다');
  fxDown = true;
  try {
    assert.equal((await post(`/api/rooms/${roomId}/invoices/send`, 'me')).status, 503);
    assert.equal((await room(roomId)).status, 'ready');
    assert.equal((await room(roomId)).fx.settle, null);
  } finally {
    fxDown = false;
  }
  assert.equal((await post(`/api/rooms/${roomId}/invoices/send`, 'me')).status, 200);
  assert.deepEqual((await room(roomId)).fx.settle, { date: '2026-11-03', rate: 905.5 });
});

// ---------------------------------------------------------------- 나가기
test('완료 기준 1(정산 전): 내가 낀 지출이 있으면 나가기가 이유와 함께 막히고, 낀 돈이 없으면 나간다', async () => {
  const { roomId } = await roomOf(['me', 'cs', 'yh']);
  await spend(roomId, 'me', ['me', 'cs']);
  const blocked = await post(`/api/rooms/${roomId}/leave`, 'cs');
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /‘저녁’ 지출에 내 몫이 있어요/);

  assert.equal((await post(`/api/rooms/${roomId}/leave`, 'yh')).status, 200);
  const saved = await room(roomId);
  assert.deepEqual(saved.members.find((m) => m.uid === 'yh').left, true, '칸은 남기고 나갔다고 표시한다');
  assert.equal((await get(`/api/rooms/${roomId}`, 'yh')).status, 403, '나간 사람은 방을 읽지 못한다');
  assert.equal((await get(`/api/rooms/${roomId}/events`, 'yh')).status, 403);
  assert.ok(!(await get('/api/rooms', 'yh')).json.rooms.some((r) => r.id === roomId), '내 방 목록에서도 빠진다');
  assert.ok((await kinds(roomId)).includes('member_left'));
  assert.equal((await spend(roomId, 'me', ['me', 'yh'])).status, 400, '나간 사람은 지출에 넣을 수 없다');
});

test('완료 기준 1·2: 정산 중에는 남은 송금을 알려 주며 막고, 모든 송금이 확인되면 완료로 바뀌어 나갈 수 있다', async () => {
  const { roomId } = await roomOf(['me', 'cs']);
  await spend(roomId, 'me', ['me', 'cs']); // 철수가 재윤에게 ₩15,000
  await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  const [t] = await store.list('transfers', { roomId });

  const cs = await post(`/api/rooms/${roomId}/leave`, 'cs');
  assert.equal(cs.status, 409);
  assert.match(cs.json.error, /재윤에게 보낼 ₩15,000/);
  assert.match((await post(`/api/rooms/${roomId}/leave`, 'me')).json.error, /철수에게서 받을 ₩15,000/);
  assert.equal((await get('/api/rooms', 'me')).json.rooms.find((r) => r.id === roomId).status, 'settling');

  assert.equal((await post(`/api/rooms/${roomId}/transfers/${encodeURIComponent(t.id)}/confirm`, 'me')).status, 200);
  const done = await room(roomId);
  assert.equal(done.status, 'done');
  assert.equal(done.doneAt, now.toISOString());
  assert.ok((await kinds(roomId)).includes('room_done'));
  assert.equal((await get('/api/rooms', 'me')).json.rooms.find((r) => r.id === roomId).status, 'done', '내 방 목록이 끝난 방을 가려낸다');

  assert.equal((await post(`/api/rooms/${roomId}/leave`, 'cs')).status, 200, '끝난 방은 나갈 수 있다');
  assert.equal((await get(`/api/rooms/${roomId}`, 'me')).status, 200, '남은 사람은 그대로 기록을 본다');
});

test('주고받을 돈이 없으면 청구서를 보내자마자 완료된다', async () => {
  const { roomId } = await roomOf(['me', 'cs']);
  await spend(roomId, 'me', ['me']); // 혼자 쓴 돈
  await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  assert.equal((await room(roomId)).status, 'done');
});

test('정산이 끝난 방은 이의·초대를 더 받지 않는다(늦게 찾은 지출은 추가 정산으로 받는다)', async () => {
  const { roomId, token } = await roomOf(['me', 'cs']);
  const { json } = await spend(roomId, 'me', ['me']);
  await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  assert.equal((await room(roomId)).status, 'done');
  assert.equal((await post(`/api/rooms/${roomId}/disputes`, 'cs', { expenseId: json.expense.id, claim: '안 먹었어요' })).status, 409);
  assert.equal((await post(`/api/rooms/${roomId}/invite`, 'me')).status, 409);
  const preview = await get(`/api/invites/${token}`);
  assert.equal(preview.json.done, true);
  assert.equal((await post(`/api/invites/${token}/join`, 'yh', { agree: true })).status, 409);
});

// ---------------------------------------------------------------- 늦게 찾은 지출(추가 정산)
// 끝난 방에 지출을 남기면 추가 정산이 열린다. 이미 오간 돈은 그대로 두고 차액만 다시 청구·송금한다
async function settledRoom() {
  const { roomId } = await roomOf(['me', 'cs']);
  await spend(roomId, 'me', ['me', 'cs']); // 철수가 재윤에게 ₩15,000
  await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  const [t] = await store.list('transfers', { roomId });
  await post(`/api/rooms/${roomId}/transfers/${encodeURIComponent(t.id)}/confirm`, 'me');
  assert.equal((await room(roomId)).status, 'done');
  return roomId;
}
const currentTransfers = async (roomId) => {
  const { version } = await room(roomId);
  return (await store.list('transfers', { roomId })).filter((t) => t.version === version).map((t) => [t.from, t.to, t.amount]);
};

test('끝난 방에 지출을 남기면 추가 정산이 열리고, 이미 오간 돈은 두고 차액만 보낸다', async () => {
  const roomId = await settledRoom();
  const late = await spend(roomId, 'cs', ['me', 'cs'], { title: '택시', amount: 10000 });
  assert.equal(late.status, 201);
  const reopened = await room(roomId);
  assert.equal(reopened.status, 'settling');
  assert.equal(reopened.doneAt, undefined);
  assert.ok((await kinds(roomId)).includes('room_reopened'));
  assert.equal((await get('/api/rooms', 'me')).json.rooms.find((r) => r.id === roomId).status, 'settling', '내 방 목록의 끝남에서 다시 진행 중으로');
  await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  assert.deepEqual(await currentTransfers(roomId), [['me', 'cs', 5000]], '택시 ₩10,000의 재윤 몫만큼만 재윤이 철수에게');
});

test('나간 사람이 낀 지출은 끝난 방에서도 지울 수 없다(나간 사람의 몫이 바뀐다)', async () => {
  const { roomId } = await roomOf(['me', 'cs', 'yh']);
  const { json } = await spend(roomId, 'me', ['me', 'cs']);
  await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  const [t] = await store.list('transfers', { roomId });
  await post(`/api/rooms/${roomId}/transfers/${encodeURIComponent(t.id)}/confirm`, 'me');
  assert.equal((await post(`/api/rooms/${roomId}/leave`, 'cs')).status, 200);
  const del = await post(`/api/rooms/${roomId}/expenses/${json.expense.id}/delete`, 'me');
  assert.equal(del.status, 409);
  assert.match(del.json.error, /나간 사람/);
  assert.equal((await room(roomId)).status, 'done');
});

// 각자 낸 돈·몫이 그대로인 수정(제목 고치기 등)은 방 version을 올리지 않는다. 보낸 청구서가 그대로 살아 있다
test('금액이 그대로인 수정은 방 version을 올리지 않아, 보낸 청구서를 다시 보내지 않아도 된다', async () => {
  const { roomId } = await roomOf(['me', 'cs']);
  const { json } = await spend(roomId, 'me', ['me', 'cs']);
  await post(`/api/rooms/${roomId}/invoices/send`, 'me');
  const before = await room(roomId);
  const edit = await post(`/api/rooms/${roomId}/expenses/${json.expense.id}`, 'me', { expense: { ...json.expense, title: '저녁 식사' } });
  assert.equal(edit.status, 200);
  assert.equal((await store.get('expenses', json.expense.id)).title, '저녁 식사');
  assert.equal((await room(roomId)).version, before.version);
  const amount = await post(`/api/rooms/${roomId}/expenses/${json.expense.id}`, 'me', { expense: { ...json.expense, amount: 40000 } });
  assert.equal(amount.status, 200);
  assert.equal((await room(roomId)).version, before.version + 1, '금액이 바뀌면 올린다');
});

test('끝난 방에서 금액이 그대로인 수정은 추가 정산을 열지 않는다', async () => {
  const roomId = await settledRoom();
  const [exp] = await store.list('expenses', { roomId });
  assert.equal((await post(`/api/rooms/${roomId}/expenses/${exp.id}`, 'me', { expense: { ...exp, title: '늦은 저녁' } })).status, 200);
  assert.equal((await room(roomId)).status, 'done');
});

// ---------------------------------------------------------------- 내보내기
test('내보내기: 방을 만든 사람만, 낀 돈이 없는 사람만 내보낼 수 있다', async () => {
  const { roomId } = await roomOf(['me', 'cs', 'yh']);
  await spend(roomId, 'me', ['me', 'cs']);
  assert.equal((await post(`/api/rooms/${roomId}/members/yh/remove`, 'cs')).status, 403);
  const blocked = await post(`/api/rooms/${roomId}/members/cs/remove`, 'me');
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error, /철수의 몫이 있어요.*내보낼 수 있어요/);
  assert.equal((await post(`/api/rooms/${roomId}/members/me/remove`, 'me')).status, 400);
  assert.equal((await post(`/api/rooms/${roomId}/members/nobody/remove`, 'me')).status, 404);

  const { status, json } = await post(`/api/rooms/${roomId}/members/yh/remove`, 'me');
  assert.equal(status, 200);
  assert.equal(json.room.members.find((m) => m.uid === 'yh').left, true);
  assert.equal((await get(`/api/rooms/${roomId}`, 'yh')).status, 403);
  const ev = (await store.listEvents(roomId)).at(-1);
  assert.equal(ev.kind, 'member_removed');
  assert.match(ev.text, /재윤이 영희를 방에서 내보냈어요/);
});

test('나갔던 사람이 링크로 다시 들어오면 예전 칸이 되살아난다(한 칸, 동의는 다시)', async () => {
  const { roomId, token } = await roomOf(['me', 'cs'], { currency: 'JPY' });
  await post(`/api/rooms/${roomId}/leave`, 'cs');
  assert.deepEqual((await room(roomId)).policyAgreedBy, ['me'], '나가면 동의도 빠진다');
  assert.equal((await get(`/api/invites/${token}`, 'cs')).json.alreadyMember, false);
  assert.equal((await post(`/api/invites/${token}/join`, 'cs', { agree: true })).status, 200);
  const saved = await room(roomId);
  assert.deepEqual(saved.members.filter((m) => m.uid === 'cs').map((m) => m.left), [undefined]);
  assert.equal((await get(`/api/rooms/${roomId}`, 'cs')).status, 200);
});

test('나가기와 그 사람을 넣은 지출 남기기가 겹쳐도 둘 다 되지는 않는다(방 상태 줄)', async () => {
  class SlowStore extends MemoryStore {
    async get(col, id) { await new Promise((r) => setTimeout(r, 5)); return super.get(col, id); }
  }
  const slow = new SlowStore();
  const app = createApp({ store: slow, gemini: null, clock: () => now, env: { DEV_SEED: '1' }, fxRates });
  await new Promise((r) => app.listen(0, r));
  const at = `http://localhost:${app.address().port}`;
  const send = (path, uid, body) => fetch(at + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-demo-user': uid }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  try {
    for (const uid of ['me', 'yh']) await send('/api/me', uid, { name: NAMES[uid], color: '#3478f6' });
    const { json } = await send('/api/rooms', 'me', { name: '회식' });
    const id = json.room.id;
    const { json: inv } = await send(`/api/rooms/${id}/invite`, 'me', {});
    await send(`/api/invites/${inv.token}/join`, 'yh', { agree: true });
    const [left, spent] = await Promise.all([
      send(`/api/rooms/${id}/leave`, 'yh', {}),
      send(`/api/rooms/${id}/expenses`, 'me', { expense: { title: '저녁', amount: 30000, currency: 'KRW', payer: 'me', method: 'card', present: ['me', 'yh'], date: '2026-11-03', time: '19:00' } }),
    ]);
    assert.ok(!(left.status === 200 && spent.status === 201), `둘 다 됐다: ${left.status} ${spent.status}`);
    assert.ok(left.status === 200 || spent.status === 201, '하나는 된다');
  } finally {
    app.close();
  }
});

// ---------------------------------------------------------------- 나간 뒤의 개인정보
test('나간 사람의 비서 기억은 그 방의 배분·중재에 쓰지 않는다', () => {
  const r = { id: 'r1', members: [{ uid: 'me', name: '재윤' }, { uid: 'cs', name: '철수', left: true }] };
  const agents = { me: { memory: ['술을 안 마셔요'] }, cs: { memory: ['회를 못 먹어요'] } };
  assert.deepEqual(memoryOf(r, agents), { me: ['술을 안 마셔요'], cs: [] });
});

test('나간 뒤에 탈퇴하면 나간 방의 기록도 익명으로 바뀐다', async () => {
  const { roomId } = await roomOf(['me', 'cs', 'ms']);
  await post(`/api/rooms/${roomId}/leave`, 'ms');
  await store.eraseUser('ms');
  const saved = await room(roomId);
  assert.ok(!saved.members.some((m) => m.uid === 'ms' || m.name === '민수'));
  assert.ok(saved.members.some((m) => m.deleted && m.name === '탈퇴한 사용자'));
});

// ---------------------------------------------------------------- 짐작한 대로 한꺼번에 확인
// 근거가 없어 비서가 물은 줄(규칙 배분은 확신 0.35)을 줄마다 누르지 않고 한 번에 확정한다
const lines = (n) => Array.from({ length: n }, (_, i) => ({ id: `l${i + 1}`, name: `정식 ${i + 1}`, qty: 1, unit: 1000 * (i + 1), tags: ['1인 식사'] }));
async function guessed(roomId, payer, present, n) {
  const { json } = await spend(roomId, payer, present, { amount: undefined, items: lines(n), source: 'receipt' });
  const { json: al } = await post(`/api/rooms/${roomId}/expenses/${json.expense.id}/allocate`, payer);
  assert.ok(Object.values(al.expense.alloc).every((a) => a.confidence < 0.7), '근거가 없어 모두 확인이 필요한 줄');
  return al.expense;
}

test('지출 하나의 확인할 줄을 짐작한 대로 한 번에 확정하고, 고쳐 둔 줄은 고친 대로 확정한다(방 version은 한 번)', async () => {
  const { roomId } = await roomOf(['me', 'cs']);
  const exp = await guessed(roomId, 'me', ['me', 'cs'], 3);
  const before = (await room(roomId)).version;
  const { status, json } = await post(`/api/rooms/${roomId}/expenses/${exp.id}/confirm-guesses`, 'cs', { edits: { l2: ['me'] } });
  assert.equal(status, 200);
  assert.equal(json.confirmed, 3);
  const saved = await store.get('expenses', exp.id);
  assert.ok(Object.values(saved.alloc).every((a) => a.confirmed && a.confirmedBy === 'cs'));
  assert.deepEqual(saved.alloc.l1.consumers, exp.alloc.l1.consumers, '짐작 그대로');
  assert.deepEqual(saved.alloc.l2.consumers, ['me'], '고친 줄은 고친 대로');
  assert.equal((await room(roomId)).version, before + 1);
  assert.match((await store.listEvents(roomId)).at(-1).text, /‘저녁’의 3줄을 비서가 짐작한 대로 확인했어요/);
  assert.equal((await post(`/api/rooms/${roomId}/expenses/${exp.id}/confirm-guesses`, 'cs', {})).json.confirmed, 0, '두 번 눌러도 다시 바꾸지 않는다');
  assert.equal((await post(`/api/rooms/${roomId}/expenses/${exp.id}/confirm-guesses`, 'cs', { edits: { l1: ['stranger'] } })).status, 200, '확인할 줄이 없으면 고친 값도 보지 않는다');
});

test('방의 모든 지출에서 확인할 줄을 한꺼번에 확정하면 청구서를 보낼 수 있다', async () => {
  const { roomId } = await roomOf(['me', 'cs']);
  await guessed(roomId, 'me', ['me', 'cs'], 2);
  await guessed(roomId, 'cs', ['me', 'cs'], 2); // 줄이 하나뿐이면 누구 몫인지 뻔해서(obvious) 묻지 않는다
  assert.equal((await post(`/api/rooms/${roomId}/invoices/send`, 'me')).status, 409, '확인할 줄이 있으면 막힌다');
  const { json } = await post(`/api/rooms/${roomId}/confirm-guesses`, 'me');
  assert.equal(json.confirmed, 4);
  assert.equal(json.expenses.length, 2);
  assert.match((await store.listEvents(roomId)).at(-1).text, /지출 2건의 4줄을 비서가 짐작한 대로 확인했어요/);
  assert.equal((await post(`/api/rooms/${roomId}/invoices/send`, 'me')).status, 200);
});

test('함께 있지 않았던 사람으로 고친 줄은 확정하지 않는다(400)', async () => {
  const { roomId } = await roomOf(['me', 'cs', 'yh']);
  const exp = await guessed(roomId, 'me', ['me', 'cs'], 2);
  assert.equal((await post(`/api/rooms/${roomId}/expenses/${exp.id}/confirm-guesses`, 'me', { edits: { l1: ['yh'] } })).status, 400);
  assert.ok(Object.values((await store.get('expenses', exp.id)).alloc).every((a) => !a.confirmed), '하나도 확정하지 않았다');
});
