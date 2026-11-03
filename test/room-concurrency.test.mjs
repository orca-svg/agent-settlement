// 방 요청의 줄 세우기(#30 리뷰): 느린 Gemini 호출이나 느리게 오는 본문은 그 방의 쓰기만 기다리게 한다.
// 읽기·다른 방·영수증 읽기는 기다리지 않고, 여러 방에 걸친 탈퇴는 진행 중인 방 작업이 끝난 뒤에 돈다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';

// 중재·나누기 호출은 open()을 부를 때까지 붙잡는 가짜 Gemini. 사진을 읽는 호출은 바로 실패시킨다(초안은 '못 읽음'으로 온다)
function gatedGemini() {
  let open;
  const opened = new Promise((r) => { open = r; });
  let called;
  const firstCall = new Promise((r) => { called = r; });
  return {
    model: 'gemini-test-flash',
    firstCall,
    open,
    async generate({ schema, images }) {
      if (images) throw new Error('사진은 읽지 않는 가짜');
      called();
      await opened;
      const props = schema.properties.lines.items.properties;
      return { summary: '모두 함께 나눠요.', lines: props.id.enum.map((id) => ({ id, consumers: props.consumers.items.enum, confidence: 0.9, reason: '테스트' })) };
    },
  };
}

const UIDS = ['me', 'cs', 'yh', 'ms', 'outsider'];

async function setup(t) {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: 'room-one' });
  await seedDemoRoom(store, { id: 'room-two' });
  const gemini = gatedGemini();
  const auth = {
    async verifyIdToken(token) {
      if (!UIDS.includes(token)) throw new Error('invalid');
      return { uid: token, name: token, auth_time: Date.now() / 1000 };
    },
    async deleteUser() {},
  };
  const server = createApp({ store, auth, gemini });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { gemini.open(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { uid = 'me', body } = {}) => fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${uid}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // 지출을 낸 사람이 아닌 멤버가 이의를 내고 중재로 넘긴다. 중재가 Gemini에서 멈추면 그 요청을 { response }로 돌려준다
  // (async 함수가 응답 약속을 그대로 돌려주면 그 응답까지 기다리게 되므로 객체로 감싼다)
  async function blockOnGemini(roomId) {
    const room = await store.get('rooms', roomId);
    const exp = (await store.list('expenses', { roomId })).find((e) => (e.items?.length ?? 0) > 1);
    const by = room.members.find((m) => m.uid !== exp.payer).uid;
    const raised = request(`/api/rooms/${roomId}/disputes`, { uid: by, body: { expenseId: exp.id, claim: '다시 나눠 주세요' } });
    // 낸 사람이 중재를 맡겨 두었으면 이의가 곧바로 중재로 이어져 여기서 멈춘다
    const first = await Promise.race([gemini.firstCall.then(() => 'blocked'), raised.then(() => 'returned')]);
    if (first === 'blocked') return { response: raised };
    const dispute = await (await raised).json();
    const mediated = request(`/api/rooms/${roomId}/disputes/${dispute.id}/mediate`, { uid: exp.payer, body: {} });
    await gemini.firstCall;
    return { response: mediated };
  }
  return { store, gemini, base, request, blockOnGemini };
}

// ms 안에 응답이 오면 그 응답, 아니면 null
const within = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))]);
// 같은 방의 가벼운 쓰기 예: 내 위치 요약 지우기(지울 것이 없어도 200)
const revoke = (roomId) => `/api/rooms/${roomId}/location/revoke`;

test('한 방의 중재가 Gemini를 기다리는 동안에도 같은 방 읽기, 다른 방 읽기·쓰기, 영수증 읽기는 바로 끝난다', async (t) => {
  const { gemini, request, blockOnGemini } = await setup(t);
  const slow = await blockOnGemini('room-one');
  for (const [label, pending] of [
    ['같은 방 화면', request('/api/rooms/room-one', { uid: 'ms' })],
    ['같은 방 기록', request('/api/rooms/room-one/events?after=0', { uid: 'yh' })],
    ['다른 방 화면', request('/api/rooms/room-two', { uid: 'ms' })],
    ['다른 방 쓰기', request(revoke('room-two'), { uid: 'ms', body: {} })],
    ['같은 방 영수증 읽기', request('/api/rooms/room-one/receipts/extract', { uid: 'cs', body: { image: { mimeType: 'image/jpeg', data: 'AAAA' } } })],
  ]) {
    const res = await within(pending, 1000);
    assert.ok(res, `${label}이 중재를 기다렸어요`);
    assert.equal(res.status, 200, label);
  }
  gemini.open();
  assert.equal((await slow.response).status, 200);
});

test('같은 방의 쓰기는 진행 중인 중재가 끝난 뒤에 처리한다', async (t) => {
  const { gemini, request, blockOnGemini } = await setup(t);
  const slow = await blockOnGemini('room-one');
  const write = request(revoke('room-one'), { uid: 'ms', body: {} });
  assert.equal(await within(write, 200), null);
  gemini.open();
  assert.equal((await slow.response).status, 200);
  assert.equal((await write).status, 200);
});

test('여러 방에 걸친 탈퇴는 진행 중인 중재가 끝나기를 기다린다(AI 결과가 지운 데이터를 되살리지 않게)', async (t) => {
  const { gemini, request, blockOnGemini } = await setup(t);
  const slow = await blockOnGemini('room-one');
  const erase = request('/api/me/delete', { uid: 'outsider', body: {} });
  assert.equal(await within(erase, 200), null);
  gemini.open();
  assert.equal((await slow.response).status, 200);
  assert.equal((await erase).status, 200);
});

test('본문을 느리게 보내는 요청이 같은 방의 다른 쓰기를 붙잡지 않는다', async (t) => {
  const { base, request } = await setup(t);
  const json = JSON.stringify({ note: '본문을 천천히 보내요' });
  const slowBody = http.request(`${base}${revoke('room-one')}`, {
    method: 'POST',
    headers: { authorization: 'Bearer ms', 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) },
  });
  const slowDone = new Promise((resolve, reject) => {
    slowBody.on('response', (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    slowBody.on('error', reject);
  });
  slowBody.write(json.slice(0, 5)); // 나머지는 아직 보내지 않는다
  await new Promise((r) => setTimeout(r, 50));
  const other = await within(request(revoke('room-one'), { uid: 'me', body: {} }), 1000);
  assert.ok(other, '느린 본문을 기다렸어요');
  assert.equal(other.status, 200);
  slowBody.end(json.slice(5));
  assert.equal(await slowDone, 200);
});
