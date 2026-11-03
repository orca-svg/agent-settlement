// #10 Firestore 보안 규칙: 다른 방의 데이터를 읽거나 쓸 수 없는지. 화면(브라우저)처럼 REST로 직접 요청해 본다.
// 기본 확인(문서 하나 읽기, 멤버의 쓰기 금지, 송금 당사자, 이의 직접 읽기 차단)은 firestore.test.mjs에 있다.
// 여기는 그 바깥을 본다: 목록 조회(화면의 onSnapshot), 다른 방 멤버, 청구서 읽기와 지우기, 규칙에 적히지 않은 컬렉션.
// Firestore 에뮬레이터가 있을 때만 돈다(docs/firestore-setup.md). 없으면 건너뛴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const skip = !process.env.FIRESTORE_EMULATOR_HOST && 'Firestore 에뮬레이터 없음';

// 방 A(ra): alice·bob, 방 B(rb): sam.
// firestore.test.mjs의 규칙 테스트(rr, a, b, x …)와 같은 (default) 데이터베이스를 쓰므로 이름이 겹치지 않게 한다.
// 서버 길(Admin SDK, 규칙을 거치지 않음)로 심어야 rooms의 _memberUids가 실제와 같이 채워진다.
// 모두 덮어쓰기라 켜 둔 에뮬레이터에서 다시 돌려도 같은 상태가 된다.
let ready;
function setup() {
  ready ??= (async () => {
    const { emulatorStore, rulesClient } = await import('./helpers/firestore-emulator.mjs');
    const store = emulatorStore({}, '(default)');
    const api = rulesClient();
    await api.loadRules();
    await store.put('rooms', { id: 'ra', name: '방 A', members: [{ uid: 'alice', name: '앨리스' }, { uid: 'bob', name: '밥' }] });
    await store.put('rooms', { id: 'rb', name: '방 B', members: [{ uid: 'sam', name: '샘' }] });
    await store.put('expenses', { id: 'ra-e', roomId: 'ra', amount: 100 });
    await store.put('expenses', { id: 'rb-e', roomId: 'rb', amount: 200 });
    await store.put('invoices', { id: 'ra-i', roomId: 'ra', to: 'bob', amount: 50 });
    await store.put('transfers', { id: 'ra:t', roomId: 'ra', from: 'alice', to: 'bob', amount: 50 });
    // 기록은 1번을 직접 둔다. appendEvent는 다시 돌리면 2번을 만들어 '2번은 없다' 확인을 깬다
    for (const roomId of ['ra', 'rb']) {
      await store.db.doc(`rooms/${roomId}/events/1`).set({ seq: 1, roomId, from: 'system', to: 'all', kind: 'x', text: 'hi', at: new Date(0).toISOString() });
    }
    // 규칙에 적히지 않은 컬렉션. 모두 alice(방 A 멤버)의 것이라 '주인이어도 못 읽는다'를 볼 수 있다
    await store.put('agents', { id: 'alice', uid: 'alice', memory: [] });
    await store.put('disputes', { id: 'ra-d', roomId: 'ra', expenseId: 'ra-e', by: 'alice', status: 'open', claim: '확인해 주세요', evidence: [] });
    await store.put('locationEvidence', { id: 'ra-loc', roomId: 'ra', uid: 'alice', summary: '체크아웃 · 지정 장소 밖' });
    await store.put('locationConsents', { id: 'ra-consent', roomId: 'ra', uid: 'alice' });
    await store.put('deletedUsers', { id: 'alice' });
    // #4(PR #45)의 초대 모양: 문서 id = 방 id, token이 곧 참가 열쇠
    await store.put('invites', { id: 'ra', roomId: 'ra', token: 'join-secret', expiresAt: new Date(0).toISOString(), createdBy: 'alice' });
    return { store, api };
  })();
  return ready;
}

test('규칙: 청구서는 그 방 멤버만 읽고, 멤버라도 화면에서 방의 문서를 지울 수 없다', { skip }, async () => {
  const { store, api } = await setup();
  for (const [uid, want] of [['alice', 200], ['bob', 200], ['sam', 403], [null, 403]]) {
    assert.equal(await api.get('invoices/ra-i', uid), want, `${uid ?? '비로그인'}: invoices/ra-i 읽기`);
  }
  const roomDocs = ['rooms/ra', 'rooms/ra/events/1', 'expenses/ra-e', 'invoices/ra-i', 'transfers/ra:t'];
  for (const path of roomDocs) assert.equal(await api.remove(path, 'alice'), 403, `멤버 alice: ${path} 지우기`);
  for (const path of roomDocs) assert.ok((await store.db.doc(path).get()).exists, `지우기 뒤에도 남아 있어야 해요: ${path}`);
});

test('규칙: 다른 방 멤버는 이 방의 문서를 읽지도, 쓰지도, 지우지도 못한다(멤버 목록에 끼어들기 포함)', { skip }, async () => {
  const { store, api } = await setup();
  // 대조군: sam의 토큰이 멀쩡하다는 증거(자기 방은 열린다)
  for (const path of ['rooms/rb', 'expenses/rb-e']) assert.equal(await api.get(path, 'sam'), 200, `대조군 sam: 자기 방 ${path} 읽기`);
  for (const path of ['rooms/ra', 'rooms/ra/events/1', 'expenses/ra-e', 'invoices/ra-i', 'transfers/ra:t']) {
    assert.equal(await api.get(path, 'sam'), 403, `방 B의 sam: ${path} 읽기`);
  }
  assert.equal(await api.write('expenses/ra-e', 'sam', { roomId: 'ra', amount: 999 }), 403, 'sam: 방 A 지출 고치기');
  assert.equal(await api.write('expenses/ra-new', 'sam', { roomId: 'ra', amount: 999 }), 403, 'sam: 방 A에 지출 만들기');
  assert.equal(await api.write('rooms/ra/events/2', 'sam', { roomId: 'ra', text: '가짜 기록' }), 403, 'sam: 방 A에 기록 만들기');
  assert.equal(await api.write('rooms/ra', 'sam', { _memberUids: ['alice', 'bob', 'sam'] }, ['_memberUids']), 403, 'sam: 방 A 멤버 목록에 자기를 끼워 넣기');
  assert.equal(await api.remove('expenses/ra-e', 'sam'), 403, 'sam: 방 A 지출 지우기');

  // 서버 길로 다시 읽어 아무것도 바뀌지 않았는지
  assert.deepEqual((await store.db.doc('rooms/ra').get()).get('_memberUids'), ['alice', 'bob']);
  assert.equal((await store.db.doc('expenses/ra-e').get()).get('amount'), 100);
  assert.equal((await store.db.doc('expenses/ra-new').get()).exists, false);
  assert.equal((await store.db.doc('rooms/ra/events/2').get()).exists, false);
});
