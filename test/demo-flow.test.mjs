// 체험용 데모(public/demo/)의 브라우저 안 서버를 Node에서 돌려, 방문자('나')가 task 1~5를 끝까지 따라갈 수 있는지 본다.
// 친구들(철수·영희·민수)은 진행자(director.js)가 실제 API로 움직인다. 진행자의 기다림은 바로 지나가게 한다
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer, DEMO_CONFIG } from '../public/demo/server.js';
import { readFileSync } from 'node:fs';
import { tripDays, fakeRate, friendExpenses, roomDraft } from '../public/demo/scenario.js';
import { tasks, nextStep } from '../public/demo/guide.js';

// boot.js의 snapshot()과 같은 모양: '나'가 마지막으로 만든 방 기준
async function snapshot(server) {
  const { store } = server;
  const room = await server.focusRoom();
  const list = async (col) => (room ? store.list(col, { roomId: room.id }) : []);
  return {
    room, invite: room && (await store.get('invites', room.id)),
    expenses: await list('expenses'), invoices: await list('invoices'), disputes: await list('disputes'), transfers: await list('transfers'),
    location: (await list('locationEvidence')).filter((e) => e.uid === 'me'), agent: await store.get('agents', 'me'),
  };
}

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const NOW = new Date('2026-11-06T03:00:00Z'); // Demo Market 날 정오(KST)

function demo(storage = memoryStorage()) {
  const server = createDemoServer({ storage, clock: () => NOW, schedule: (fn) => setImmediate(fn) });
  const call = async (method, path, body) => {
    const out = await server.handle(method, path, { body });
    await server.idle();
    return out;
  };
  const ok = async (method, path, body) => {
    const out = await call(method, path, body);
    assert.ok(out.status < 400, `${method} ${path} → ${out.status} ${out.body?.error ?? ''}`);
    return out.body;
  };
  return { server, storage, call, ok };
}

test('데모 설정: Firebase 없이 나로 로그인한 것처럼, 화면에는 데모라고 알린다', async () => {
  const { ok } = demo();
  assert.deepEqual(await ok('GET', '/api/config'), DEMO_CONFIG);
  const { profile } = await ok('GET', '/api/me');
  assert.equal(profile.name, '나');
  assert.deepEqual((await ok('GET', '/api/rooms')).rooms, []);
});

test('방 기간 글에서 여행 사흘을 읽는다(당일·1박은 마지막 날에 멈춘다)', () => {
  assert.deepEqual(tripDays('11월 7일 – 9일', '2026-11-06'), ['2026-11-07', '2026-11-08', '2026-11-09']);
  assert.deepEqual(tripDays('12월 31일 – 1월 1일', '2026-12-20'), ['2026-12-31', '2027-01-01', '2027-01-01']);
  assert.deepEqual(tripDays('2026년 12월 31일 – 2027년 1월 2일', '2026-11-06'), ['2026-12-31', '2027-01-01', '2027-01-02']);
  assert.deepEqual(tripDays('', '2026-11-06'), ['2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(fakeRate('JPY', '2026-11-07'), fakeRate('JPY', '2026-11-07'));
});

test('원화 방에서도 친구들의 지출은 원으로 들어간다', () => {
  const list = friendExpenses({ dates: '11월 7일 – 9일', fx: null }, ['me', 'cs', 'yh', 'ms'], '2026-11-06');
  assert.equal(list.length, 6);
  assert.ok(list.every(({ input }) => input.currency === 'KRW'));
  assert.ok(list.every(({ input }) => (input.items ?? [input]).every((x) => Number.isInteger(x.unit ?? x.amount))));
});

// 팀 점검(11/5): 방 이름·기간을 매번 적지 않게 미리 채운다. 오늘부터 2박 3일이라 Demo Market 날이면 금~일이다
test('체험 데모의 새 방은 오사카 2박 3일, 오늘부터 사흘로 미리 채운다', () => {
  assert.deepEqual(roomDraft('2026-11-06'), { name: '오사카 2박 3일', start: '2026-11-06', end: '2026-11-08', preset: true });
  assert.deepEqual(tripDays('11월 6일 – 8일', '2026-11-06'), ['2026-11-06', '2026-11-07', '2026-11-08'], '친구들의 지출도 그 사흘에 들어간다');
  const room = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');
  assert.match(room, /authOptions\(\)\.demo[^\n]*roomDraft\(todayIso\(\)\)/, '방 화면은 체험 데모일 때만 미리 채운다');
  assert.match(room, /inviteSheetHtml\(\{[^\n]*demo: authOptions\(\)\.demo/, '초대 시트에도 체험 데모인지 알린다');
});

// 팀 점검(11/5): 받을 계좌를 정한 뒤 지출을 남기는 편이 자연스럽다. 또 ＋를 누르고 '이걸 어떻게 보내지' 하고 나가지 않게,
// 데모에서는 누르기만 하면 친구가 들어온다고 그 단계에서 바로 알린다
test('task 순서와 안내: 계좌·비서 범위가 지출 남기기보다 먼저, ＋는 누르기만 하면 된다고 바로 알린다', () => {
  const room = { id: 'r-1', members: [{ uid: 'me', name: '나' }], version: 1, fx: null };
  const s = { room, invite: null, expenses: [], invoices: [{ to: 'me', status: 'accepted', decidedBy: 'agent', version: 1 }], disputes: [], transfers: [], location: [], agent: null };
  const list = tasks(s);
  assert.deepEqual(list.map((t) => t.title), ['여행 방 만들고 친구 초대하기', '내 계좌와 비서에게 맡길 범위 정하기', '지출 남기기', '맞지 않는 몫 바로잡기', '보내고 마무리하기']);
  assert.match(list[0].steps[0].note, /미리 채워/);
  const plus = list[0].steps.find((st) => st.show === '[data-action="open-invite"]');
  assert.match(plus.text, /＋/);
  assert.match(`${plus.text} ${plus.note}`, /알아서 들어와요/);
  assert.match(plus.note, /보내지 않아도/);
  // 다른 task를 번호로 가리키는 안내는 바뀐 순서를 따른다
  const nOf = (re) => list.find((t) => re.test(t.title)).n;
  assert.match(list[1].steps[0].note, new RegExp(`task ${nOf(/맞지 않는 몫/)}에서 비서가 먼저`));
  assert.match(list[3].steps.find((st) => st.skipped).note, new RegExp(`task ${nOf(/맡길 범위/)}에서 한도를 낮추면`));
});

// 첫 화면(public/index.html)의 다섯 task 목록은 체크리스트와 같은 순서·같은 이름이어야 한다(같은 개념은 같은 단어로)
test('첫 화면의 다섯 task 목록은 체크리스트와 같은 순서·이름이다', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const list = html.match(/<ol class="list intro-tasks">([\s\S]*?)<\/ol>/)[1];
  const titles = [...list.matchAll(/<span class="title">([^<]+)<\/span>/g)].map((m) => m[1]);
  const s = { room: null, invite: null, expenses: [], invoices: [], disputes: [], transfers: [], location: [], agent: null };
  assert.deepEqual(titles, tasks(s).map((t) => t.title));
  assert.match(list, /미리 채운 방 이름·기간/);
  assert.match(list, /＋만 누르면/);
});

test('task 1~5: 방 만들기부터 이의·중재, 송금, 정산 완료와 나가기까지', async () => {
  const { ok, call, server, storage } = demo();
  const base = (id) => `/api/rooms/${encodeURIComponent(id)}`;

  // 처음에는 task 1만 열려 있고, 다음에 할 일은 '새 방 만들기'다
  let list = tasks(await snapshot(server));
  assert.deepEqual(list.map((t) => t.done), [false, false, false, false, false]);
  assert.match(nextStep(list[0]).text, /새 방 만들기/);

  // task 1. 엔화 방을 만들고 초대 링크를 만들면 셋이 들어와 환율 정책에 동의하고, 각자의 지출을 남긴다
  const { room } = await ok('POST', '/api/rooms', { name: '오사카 2박 3일', dates: '11월 7일 – 9일', currency: 'JPY', policy: 'actual' });
  await ok('POST', `${base(room.id)}/invite`, {});
  let view = await ok('GET', base(room.id));
  assert.deepEqual(view.room.members.map((m) => m.name), ['나', '철수', '영희', '민수']);
  assert.deepEqual([...view.room.policyAgreedBy].sort(), ['cs', 'me', 'ms', 'yh']);
  assert.equal(view.expenses.length, 6);
  const bar = view.expenses.find((e) => e.title === '2차 바');
  assert.equal(bar.payer, 'cs');
  assert.ok(bar.alloc, '철수의 비서가 2차 바 영수증 줄을 나눴다');
  assert.ok(view.expenses.every((e) => e.date >= '2026-11-07' && e.date <= '2026-11-09'));
  list = tasks(await snapshot(server));
  assert.deepEqual(list.map((t) => t.done), [true, false, false, false, false], 'task 1이 끝났다');
  assert.equal(list[1].steps[0].go.href, `account.html?from=${room.id}&sheet=agent#agent`, 'task 2의 내 계정 버튼은 돌아올 방을 싣는다(저장하고 뒤로를 누르면 방의 내 비서로)');

  // task 2. 내 계좌와 비서 기본 설정, 이 방에서만 쓸 규칙
  await ok('POST', '/api/me/agent/onboarding', { rules: { autoAccept: 50_000, sendWhen: 'now', onDispute: 'ask', notify: 'actions' } });
  await ok('POST', '/api/me/payout', { bank: '토스뱅크', accountNo: '100000000001', holder: '나' });
  await ok('POST', `${base(room.id)}/agent/rules`, { sendWhen: 'manual' });
  view = await ok('GET', base(room.id));
  assert.ok(view.myAgent, '방 화면에 내 비서 요약이 온다');
  list = tasks(await snapshot(server));
  assert.deepEqual(list.map((t) => t.done), [true, true, false, false, false], 'task 2가 끝났다');

  // task 3. 영수증 사진을 읽으면 샘플 영수증 초안이 오고, 그대로 남긴 뒤 비서에게 나누기를 맡긴다
  const { draft } = await ok('POST', `${base(room.id)}/receipts/extract`, { image: { mimeType: 'image/jpeg', data: 'AAAA' } });
  assert.equal(draft.ok, true);
  assert.equal(draft.currency, 'JPY');
  assert.equal(draft.date, '2026-11-07');
  assert.match(draft.warnings.join(' '), /샘플 영수증/);
  const { expense } = await ok('POST', `${base(room.id)}/expenses`, { expense: {
    title: draft.merchant, kind: 'food', date: draft.date, time: draft.time, payer: 'me', method: 'cash', currency: draft.currency,
    items: draft.items, present: ['me', 'cs', 'yh', 'ms'], source: 'receipt',
  } });
  await ok('POST', `${base(room.id)}/expenses/${encodeURIComponent(expense.id)}/allocate`, {});
  await call('POST', `${base(room.id)}/expenses/${encodeURIComponent(expense.id)}/confirm-guesses`, {});
  list = tasks(await snapshot(server));
  assert.deepEqual(list.map((t) => t.done), [true, true, true, false, false], 'task 3이 끝났다');

  // task 4. 청구서를 보내면 한도를 넘은 내 청구서는 비서가 나에게 묻는다. 타임라인으로 2차 바에 이의를 낸다
  await ok('POST', `${base(room.id)}/invoices/send`, {});
  view = await ok('GET', base(room.id));
  const mine = view.invoices.find((i) => i.to === 'me' && i.version === view.room.version);
  assert.equal(mine.status, 'asked');
  assert.ok(view.invoices.filter((i) => i.to !== 'me').every((i) => i.status === 'accepted'), '친구들의 청구서는 받았다(민수는 진행자가 대신 확인)');
  await ok('POST', `${base(room.id)}/location/timeline`, { agree: true, expenseId: bar.id, leftAt: '22:55', nextAt: '23:08', nextHome: false });
  await ok('POST', `${base(room.id)}/invoices/${encodeURIComponent(mine.id)}/answer`, { decision: 'dispute', disputes: [{ expenseId: bar.id, claim: '먼저 숙소로 돌아갔어요' }] });
  view = await ok('GET', base(room.id));
  let dispute = view.disputes.find((d) => d.by === 'me');
  assert.equal(dispute.status, 'proposed', '철수의 비서가 규칙대로 중재 비서에게 맡겼다');
  const late = bar.items.filter((it) => it.time > '22:55');
  assert.ok(late.length && late.every((it) => !dispute.proposal.alloc[it.id].consumers.includes('me')), '떠난 뒤 주문에서 나는 빠진다');
  await ok('POST', `${base(room.id)}/disputes/${encodeURIComponent(dispute.id)}/agree`, {});
  view = await ok('GET', base(room.id));
  dispute = view.disputes.find((d) => d.id === dispute.id);
  assert.equal(dispute.status, 'resolved', '철수도 진행자가 동의해 다시 나눴다');
  const again = view.invoices.find((i) => i.to === 'me' && i.version === view.room.version);
  assert.equal(again.status, 'asked');
  await ok('POST', `${base(room.id)}/invoices/${encodeURIComponent(again.id)}/answer`, { decision: 'accept' });

  // task 5. 내 송금은 토스 대신 데모 안내로 열고, 보냈다고 하면 철수가 받았다고 한다. 모두 끝나면 방이 완료되고 나갈 수 있다
  view = await ok('GET', base(room.id));
  const live = view.transfers.filter((t) => t.version === view.room.version);
  const pay = live.find((t) => t.from === 'me');
  assert.deepEqual(live.filter((t) => t.from === 'me').map((t) => t.to), ['cs'], '내 송금은 철수에게 한 번이다');
  assert.match(pay.link, /^#demo-toss=/, '송금 링크는 토스가 아니라 데모 안내다');
  assert.ok(live.filter((t) => t.from !== 'me').every((t) => ['sent', 'confirmed'].includes(t.status)), '친구들은 진행자가 보냈다');
  await ok('POST', `${base(room.id)}/transfers/${encodeURIComponent(pay.id)}/approve`, {});
  await ok('POST', `${base(room.id)}/transfers/${encodeURIComponent(pay.id)}/sent`, {});
  view = await ok('GET', base(room.id));
  assert.equal(view.room.status, 'done');
  assert.ok(view.transfers.filter((t) => t.version === view.room.version).every((t) => t.status === 'confirmed'));
  await ok('POST', `${base(room.id)}/leave`, {});
  assert.equal((await call('GET', base(room.id))).status, 403);
  list = tasks(await snapshot(server));
  assert.deepEqual(list.map((t) => t.done), [true, true, true, true, true], '다섯 task가 모두 끝났다');

  // 저장소는 sessionStorage에 남아 다른 페이지에서 이어진다
  const next = createDemoServer({ storage, clock: () => NOW, schedule: (fn) => setImmediate(fn) });
  assert.equal((await next.handle('GET', '/api/rooms')).body.rooms.length, 0, '나간 방은 내 방 목록에서 빠진다');
  assert.equal((await next.store.get('rooms', room.id)).status, 'done');
  server.reset();
  assert.equal(storage.getItem('agent-settlement.demo.v1'), null);
});

test('원화만 쓰는 방: 친구들의 지출도, 샘플 영수증도 원화로 들어간다', async () => {
  const { ok } = demo();
  const base = (id) => `/api/rooms/${encodeURIComponent(id)}`;
  const { room } = await ok('POST', '/api/rooms', { name: '부산 1박 2일', dates: '11월 7일 – 8일' });
  assert.equal(room.fx, null);
  await ok('POST', `${base(room.id)}/invite`, {});
  const view = await ok('GET', base(room.id));
  assert.equal(view.room.members.length, 4);
  assert.equal(view.expenses.length, 6);
  assert.ok(view.expenses.every((e) => e.currency === 'KRW'));
  const { draft } = await ok('POST', `${base(room.id)}/receipts/extract`, { image: { mimeType: 'image/jpeg', data: 'AAAA' } });
  assert.equal(draft.ok, true, draft.reason);
  assert.equal(draft.currency, 'KRW');
  assert.ok(draft.items.every((it) => Number.isInteger(it.unit) && it.unit > 0));
  assert.ok(!draft.items.some((it) => it.name === '차액 조정'), '줄의 합과 합계가 같다');
  const { expense } = await ok('POST', `${base(room.id)}/expenses`, { expense: {
    title: draft.merchant, kind: 'food', date: draft.date, time: draft.time, payer: 'me', method: 'card', currency: draft.currency,
    items: draft.items, present: ['me', 'cs', 'yh', 'ms'], source: 'receipt',
  } });
  assert.equal(expense.currency, 'KRW');
});

test('데모에서는 계정을 지울 수 없다', async () => {
  const { call } = demo();
  const out = await call('POST', '/api/me/delete', {});
  assert.equal(out.status, 400);
  assert.match(out.body.error, /처음부터 다시/);
});
