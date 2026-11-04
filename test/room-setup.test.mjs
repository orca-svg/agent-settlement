// #4 방 만들기·참가 화면(public/room-setup.js)과 로그인 뒤 돌아갈 곳. 로그인(#2)한 계정의 프로필로 들어가고, 이름은 따로 받지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHtml, joinHtml, setupHtml, datesLabel } from '../public/room-setup.js';
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
  assert.match(html, /type="date"[^>]*data-cf="start"/, '기간은 달력에서 고른다');
  assert.match(html, /type="date"[^>]*data-cf="end"/);
  assert.match(html, /원화/, '지금은 원화 지출만 남길 수 있다고 알린다');
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

  const inn = joinHtml(invite, { agree: false }, { profile, dev: false });
  assert.match(inn, /data-action="join-room"/);
  assert.match(inn, /data-jf="agree"/);
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
  const alone = setupHtml({ room: { members: [me], policy: 'actual', policyAgreedBy: ['me'], status: 'ready' }, me, avatar });
  assert.ok(!alone.includes('preview-note'), '주황 안내 상자를 쓰지 않는다');
  assert.ok(!alone.includes('동의함'), '모두 동의했으면 멤버별 동의 목록을 펼치지 않는다');
  assert.match(alone, /data-action="edit-policy"/);
  assert.match(alone, /실제 낸 원화/);

  const waiting = setupHtml({ room: { members: [me, { uid: 'cs', name: '철수' }], policy: 'actual', policyAgreedBy: ['me'], status: 'ready' }, me, avatar });
  assert.match(waiting, /동의 전/, '아직 동의하지 않은 사람이 있으면 누가 남았는지 보여 준다');
  assert.ok(!waiting.includes('preview-note'));
});

test('로그인 뒤 돌아갈 곳은 이 서비스의 방·초대 주소만 받는다', () => {
  assert.equal(nextAfterLogin('?next=room.html%3Froom%3Dr-1a2b3c4d'), 'room.html?room=r-1a2b3c4d');
  assert.equal(nextAfterLogin('?next=room.html%3Finvite%3DAbCdEfGhIjKlMnOpQrStUv_-'), 'room.html?invite=AbCdEfGhIjKlMnOpQrStUv_-');
  for (const bad of ['?next=https%3A%2F%2Fevil.example', '?next=%2F%2Fevil.example', '?next=room.html%3Froom%3D%22%3E', '?next=account.html', '']) {
    assert.equal(nextAfterLogin(bad), null, bad);
  }
});
