// #4 방 만들기·참가 화면(public/room-setup.js)과 로그인 뒤 돌아갈 곳. 로그인(#2)한 계정의 프로필로 들어가고, 이름은 따로 받지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHtml, joinHtml, setupHtml, datesLabel, inviteSheetHtml, inviteButtonHtml, leaveSheetHtml } from '../public/room-setup.js';
import { roomTabs } from '../public/room-list.js';
import { nextAfterLogin } from '../public/ui.js';

const profile = { name: '<재윤>', color: '#34c759' };
const empty = { name: '', dates: '', policy: 'actual' };
const invite = { room: { id: 'r-1', name: '오사카', dates: '11월 7일 – 9일', policy: 'actual', members: [{ name: '재윤' }] }, alreadyMember: false, settling: false };

test('방 만들기: 로그인 전에는 그 자리의 Google 로그인만 있고, 만들기 버튼은 없다', () => {
  const html = createRoomHtml(empty, { profile: null, dev: false });
  assert.match(html, /data-action="sign-in"/);
  assert.ok(!html.includes('data-action="create-room"'));
});

test('방 만들기: 로그인하면 프로필 이름·색으로 들어가고, 이름 입력칸은 없다', () => {
  const html = createRoomHtml(empty, { profile, dev: false });
  assert.match(html, /data-action="create-room"/);
  assert.ok(!html.includes('data-cf="myName"'));
  assert.ok(html.includes('&lt;재윤&gt;') && !html.includes('<재윤>'), '프로필 이름을 이스케이프해 보여 준다');
  assert.ok(html.includes('#34c759'), '프로필 색');
  assert.ok(!html.includes('account.html#profile'), '프로필로 가는 버튼은 없다(가면 적던 내용을 잃는다)');
  assert.match(html, /data-action="range-toggle"/, '기간은 한 줄을 눌러 펼친 달력에서 고른다');
  assert.ok(!html.includes('type="date"'), '브라우저 기본 날짜 칸(연도. 월. 일.)은 쓰지 않는다');
  assert.match(html, /data-action="cf-foreign" data-id="no">원화만/, '쓴 돈의 통화는 원화만이 기본이다');
  assert.ok(!html.includes('data-action="seed"'), '배포에는 개발용 데모 방이 없다');
});

test('방 만들기: 개발용 서버는 로그인 없이 만들 수 있고 데모 방 버튼이 있다', () => {
  const html = createRoomHtml(empty, { profile: null, dev: true });
  assert.match(html, /data-action="create-room"/);
  assert.match(html, /data-action="seed"/);
  assert.ok(!html.includes('data-action="sign-in"'));
});

test('참가: 로그인 전에는 방 미리보기와 Google 로그인, 로그인 뒤에는 프로필로 참가한다', () => {
  const out = joinHtml(invite, { agree: false }, { profile: null, dev: false });
  assert.ok(out.includes('오사카') && out.includes('재윤'));
  assert.match(out, /data-action="sign-in"/);
  assert.ok(!out.includes('data-action="join-room"'));

  const inn = joinHtml(invite, {}, { profile, dev: false });
  assert.match(inn, /data-action="join-room"[^>]*>동의하고 참가하기</, '동의는 체크박스가 아니라 무엇에 동의하는지 적은 버튼으로 받는다');
  assert.ok(!inn.includes('type="checkbox"'), '체크박스는 없다(iOS에는 체크박스가 없다)');
  assert.match(inn, /멤버들에게 보여요/, '버튼 바로 위에 무엇이 보이게 되는지 적는다');
  assert.ok(!inn.includes('data-jf="name"'), '이름 입력칸은 없다');
  assert.ok(inn.includes('&lt;재윤&gt;') && inn.includes('#34c759'));
  assert.ok(!inn.includes('account.html#profile'));
});

test('기간 글자: 달력에서 고른 두 날짜를 짧게 쓴다', () => {
  assert.equal(datesLabel('2026-11-07', '2026-11-09'), '11월 7일 – 9일');
  assert.equal(datesLabel('2026-11-30', '2026-12-02'), '11월 30일 – 12월 2일');
  assert.equal(datesLabel('2026-12-31', '2027-01-02'), '2026년 12월 31일 – 2027년 1월 2일');
  assert.equal(datesLabel('2026-11-07', '2026-11-07'), '11월 7일');
  assert.equal(datesLabel('2026-11-07', ''), '11월 7일');
  assert.equal(datesLabel('', ''), '');
});

test('방 화면: 모두 동의한 정책은 한 줄과 바꾸기만, 안내는 경고색이 아니다', () => {
  const me = { uid: 'me', name: '재윤' };
  const avatar = () => '';
  const fx = { currency: 'JPY' }; // 환율 정책은 외화 방에만 있다(#55)
  const alone = setupHtml({ room: { members: [me], fx, policy: 'actual', policyAgreedBy: ['me'], status: 'ready' }, me, avatar });
  assert.ok(!alone.includes('preview-note'), '주황 안내 상자를 쓰지 않는다');
  assert.ok(!alone.includes('동의함'), '모두 동의했으면 멤버별 동의 목록을 펼치지 않는다');
  assert.match(alone, /data-action="edit-policy"/);
  assert.match(alone, /실제 낸 원화/);

  const waiting = setupHtml({ room: { members: [me, { uid: 'cs', name: '철수' }], fx, policy: 'actual', policyAgreedBy: ['me'], status: 'ready' }, me, avatar });
  assert.match(waiting, /동의 전/, '아직 동의하지 않은 사람이 있으면 누가 남았는지 보여 준다');
  assert.ok(!waiting.includes('preview-note'));
});

test('친구 초대는 방 본문(환율·지출 사이)에 두지 않고, 참여자 줄 끝의 + 버튼으로 연다', () => {
  const me = { uid: 'me', name: '재윤' };
  const room = { members: [me], policy: 'actual', policyAgreedBy: ['me'], status: 'ready' };
  const body = setupHtml({ room, me, avatar: () => '', invite: { token: 'AbCdEfGhIjKlMnOpQrStUv_-', expiresAt: '2026-11-11T03:00:00Z' } });
  assert.ok(!body.includes('copy-invite') && !body.includes('친구 초대'), '본문에는 초대 칸이 없다');
  assert.match(inviteButtonHtml(), /<button[^>]*data-action="open-invite"[^>]*aria-label="친구 초대"/);
});

test('초대 시트: 링크 줄(복사·공유 아이콘), 친구에게 보일 초대 화면, 참가하면 바로 보일 참여자 목록', () => {
  globalThis.location ??= { origin: 'http://localhost:4562', pathname: '/room.html' };
  const me = { uid: 'me', name: '재윤' };
  const room = { name: '오사카 2박 3일', dates: '11월 7일 – 9일', members: [me], fx: { currency: 'JPY' }, policy: 'actual', policyAgreedBy: ['me'], status: 'ready' };
  const invite = { token: 'AbCdEfGhIjKlMnOpQrStUv_-', expiresAt: '2026-11-11T03:00:00Z' };
  const sheet = inviteSheetHtml({ room, me, avatar: () => '<i></i>', invite, canShare: true });
  assert.match(sheet, /친구에게 이렇게 보여요/);
  assert.match(sheet, /오사카 2박 3일/);
  assert.match(sheet, /실제 낸 원화/, '친구가 참가 전에 볼 환율 정책');
  assert.match(sheet, /지금 1명/);
  assert.match(sheet, /참가하면 여기에 바로 보여요/);
  assert.match(inviteSheetHtml({ room, me, avatar: () => '', invite: null }), /링크를 만드는 중/, '링크가 없으면 여는 순간 만든다');
  const html = sheet;
  assert.match(html, /<button[^>]*class="icon-btn"[^>]*data-action="copy-invite"[^>]*aria-label="링크 복사"/);
  assert.match(html, /<button[^>]*class="icon-btn"[^>]*data-action="share-invite"[^>]*aria-label="공유하기"/);
  assert.ok(!html.includes('>링크 복사<') && !html.includes('>공유하기<'), '글자 버튼은 없다');
  assert.match(html, /<input[^>]*readonly[^>]*data-select-all/, '링크는 눌러서 통째로 고를 수 있다');
  assert.match(html, /11월 11일까지 열 수 있어요/);
  assert.match(html, /class="text-btn"[^>]*data-action="make-invite"[^>]*>새 링크 만들기/);
  const copied = inviteSheetHtml({ room, me, avatar: () => '', invite, copied: true, canShare: false });
  assert.match(copied, /class="icon-btn done"[^>]*data-action="copy-invite"[^>]*aria-label="복사했어요"/, '복사하면 그 버튼이 체크로 바뀌고 읽어 주기도 바뀐다');
  assert.ok(!copied.includes('share-invite'), '공유를 못 하는 브라우저에는 공유 버튼이 없다');
});

test('로그인 뒤 돌아갈 곳은 이 서비스의 방·초대 주소만 받는다', () => {
  assert.equal(nextAfterLogin('?next=room.html%3Froom%3Dr-1a2b3c4d'), 'room.html?room=r-1a2b3c4d');
  assert.equal(nextAfterLogin('?next=room.html%3Finvite%3DAbCdEfGhIjKlMnOpQrStUv_-'), 'room.html?invite=AbCdEfGhIjKlMnOpQrStUv_-');
  for (const bad of ['?next=https%3A%2F%2Fevil.example', '?next=%2F%2Fevil.example', '?next=room.html%3Froom%3D%22%3E', '?next=account.html', '']) {
    assert.equal(nextAfterLogin(bad), null, bad);
  }
});

// ---------------------------------------------------------------- #55 환율 정책은 외화 방에만
test('방 만들기: 원화만 쓰는 방(기본)에는 환율 정책을 묻지도 보이지도 않는다', () => {
  const html = createRoomHtml(empty, { profile, dev: false });
  assert.ok(!html.includes('data-action="cf-policy"'), '정책 고르기가 없다');
  assert.ok(!html.includes('환율'), html.match(/.{20}환율.{20}/)?.[0]);
  assert.ok(!html.includes('data-cf="fxCurrency"'), '외화 고르기도 접혀 있다');
});

test('방 만들기: 외화도 있어요를 고르면 어느 외화인지와 환율 정책을 펼친다', () => {
  const html = createRoomHtml({ ...empty, foreign: true, fxCurrency: 'USD', policy: 'payday' }, { profile, dev: false });
  assert.match(html, /data-action="cf-foreign" data-id="yes">외화도 있어요/);
  assert.match(html, /aria-checked="true" data-action="cf-foreign" data-id="yes"/);
  assert.match(html, /<select data-cf="fxCurrency">[\s\S]*<option value="USD" selected>미국 달러 \(USD\)/);
  assert.match(html, /role="radio" aria-checked="true" data-action="cf-policy" data-id="payday"/);
  assert.match(html, /유럽중앙은행\(ECB\) 기준 환율/, '환율을 어디서 언제 받는지 알린다');
});

test('참가 화면·초대 미리보기: 원화 방은 환율 정책 칸이 없고, 외화 방만 보인다', () => {
  globalThis.location ??= { origin: 'http://localhost:4562', pathname: '/room.html' };
  const krw = { room: { id: 'r-1', name: '회식', dates: '', members: [{ name: '재윤' }] }, alreadyMember: false, settling: false };
  assert.ok(!joinHtml(krw, {}, { profile }).includes('환율'));
  const jpy = { ...invite, room: { ...invite.room, currency: 'JPY', policy: 'actual' } };
  assert.match(joinHtml(jpy, {}, { profile }), /이 방의 환율 정책[\s\S]*엔로 쓴 돈[\s\S]*실제 낸 원화/);
  assert.ok(!joinHtml(invite, {}, { profile }).includes('환율 정책'), '정책 값이 와도 통화가 없으면(원화 방) 보이지 않는다');
  assert.match(joinHtml({ ...krw, settling: true, done: true }, {}, { profile }), /이미 정산이 끝난 방이라 들어갈 수 없어요/);

  const me = { uid: 'me', name: '재윤' };
  const sheet = inviteSheetHtml({ room: { name: '회식', members: [me], policy: 'actual', policyAgreedBy: ['me'], fx: null }, me, avatar: () => '', invite: null });
  assert.ok(!sheet.includes('환율'), '예전 원화 방에 남은 정책 값도 보이지 않는다');
});

test('방 화면: 원화 방에는 환율 정책 칸·동의 버튼이 없다(예전 방에 남은 값도 무시)', () => {
  const me = { uid: 'me', name: '재윤' };
  const legacy = { members: [me, { uid: 'cs', name: '철수' }], fx: null, policy: 'actual', policyAgreedBy: ['me'], status: 'ready' };
  assert.equal(setupHtml({ room: legacy, me: { uid: 'cs', name: '철수' }, avatar: () => '' }), '');
  assert.match(setupHtml({ room: legacy, me, avatar: () => '', error: '링크를 만들지 못했어요' }), /링크를 만들지 못했어요/, '다른 설정 오류는 그대로 보인다');
});

// ---------------------------------------------------------------- #55 나가기·내보내기
test('초대 시트: 방을 만든 사람만 낀 돈이 없는 사람을 내보낼 수 있고, 한 번 더 눌러야 내보낸다', () => {
  globalThis.location ??= { origin: 'http://localhost:4562', pathname: '/room.html' };
  const me = { uid: 'me', name: '재윤' };
  const room = { name: '회식', members: [me, { uid: 'cs', name: '철수' }, { uid: 'yh', name: '영희' }, { uid: 'ms', name: '민수', left: true }], createdBy: 'me', status: 'ready', fx: null };
  const expenses = [{ id: 'e1', title: '저녁', payer: 'me', present: ['me', 'cs'] }];
  const sheet = inviteSheetHtml({ room, me, avatar: () => '', invite: null, expenses });
  assert.match(sheet, /지금 3명/, '나간 사람은 세지 않는다');
  assert.ok(!sheet.includes('민수'));
  assert.match(sheet, /data-action="remove-member" data-id="yh">내보내기/);
  assert.ok(!sheet.includes('data-id="cs">내보내기'), '낀 지출이 있는 사람은 버튼 대신 까닭');
  assert.match(sheet, /철수<span class="meta"[^>]*>지출에 몫이 있어 내보낼 수 없어요/);
  assert.ok(!sheet.includes('data-id="me"'), '나는 내보내기가 아니라 나가기로');
  assert.match(inviteSheetHtml({ room, me, avatar: () => '', invite: null, expenses, armed: 'yh' }), /class="btn sm danger armed"[^>]*data-id="yh">한 번 더 누르면 내보내요/);
  assert.match(inviteSheetHtml({ room, me, avatar: () => '', invite: null, expenses, removeError: { uid: 'yh', message: '바뀌었어요' } }), /영희[\s\S]*role="alert"[^>]*>바뀌었어요/, '막힌 까닭은 누른 줄 바로 아래에');
  const asFriend = inviteSheetHtml({ room, me: { uid: 'cs', name: '철수' }, avatar: () => '', invite: null, expenses });
  assert.ok(!asFriend.includes('remove-member') && !asFriend.includes('내보낼 수 없어요'), '방을 만든 사람이 아니면 내보내기가 없다');
});

test('나가기 시트: 돈이 남아 있으면 까닭만 보이고 나가기 버튼이 없다', () => {
  const blocked = leaveSheetHtml({ room: { status: 'settling' }, why: '정산이 끝나지 않아 나갈 수 없어요. 남은 일: 재윤에게 보낼 ₩15,000' });
  assert.match(blocked, /재윤에게 보낼 ₩15,000/);
  assert.ok(!blocked.includes('data-action="leave-room"'));
  const ready = leaveSheetHtml({ room: { status: 'ready' }, why: null });
  assert.match(ready, /class="btn danger" data-action="leave-room"[^>]*>이 방에서 나가기/);
  assert.match(ready, /내 방 목록에서도 빠져요[\s\S]*초대 링크를 다시/, '무엇을 잃는지 버튼 위에 적는다');
  const done = leaveSheetHtml({ room: { status: 'done' }, why: null, error: '이미 나갔어요' });
  assert.match(done, /정산이 끝난 방이라 나갈 수 있어요/);
  assert.ok(!done.includes('초대 링크를 다시'), '끝난 방은 다시 들어올 수 없다');
  assert.match(done, /role="alert">이미 나갔어요/);
  assert.match(leaveSheetHtml({ room: {}, why: null, busy: true }), /disabled>나가는 중…/);
});

// ---------------------------------------------------------------- #55 내 방 목록
test('내 방 목록: 끝난 방이 있을 때만 진행 중 | 끝남 탭으로 나눈다', () => {
  const live = [{ id: 'a', status: 'ready' }, { id: 'b', status: 'settling' }];
  const none = roomTabs(live);
  assert.equal(none.html, '', '끝난 방이 없으면 탭이 없다');
  assert.deepEqual(none.rooms.map((r) => r.id), ['a', 'b']);

  const rooms = [...live, { id: 'c', status: 'done' }];
  const first = roomTabs(rooms);
  assert.equal(first.tab, 'live');
  assert.deepEqual(first.rooms.map((r) => r.id), ['a', 'b']);
  assert.match(first.html, /aria-checked="true" data-id="live">진행 중 2/);
  assert.match(first.html, /aria-checked="false" data-id="done">끝남 1/);
  assert.deepEqual(roomTabs(rooms, 'done').rooms.map((r) => r.id), ['c']);
  assert.equal(roomTabs(live, 'done').tab, 'live', '끝난 방이 없어지면 진행 중으로 돌아온다');
  assert.match(roomTabs([{ id: 'c', status: 'done' }]).empty, /‘끝남’에서 볼 수 있어요/);
});
