// #4 방 만들기·참가 화면(public/room-setup.js)과 로그인 뒤 돌아갈 곳. 로그인(#2)한 계정의 프로필로 들어가고, 이름은 따로 받지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomHtml, joinHtml } from '../public/room-setup.js';
import { nextAfterLogin } from '../public/ui.js';

const profile = { name: '<재윤>', color: '#34c759' };
const empty = { name: '', dates: '', policy: 'actual' };
const invite = { room: { id: 'r-1', name: '오사카', dates: '11월 7일 – 9일', policy: 'actual', members: [{ name: '재윤' }] }, alreadyMember: false, settling: false };

test('방 만들기: 로그인 전에는 그 자리의 Google 로그인만 있고, 만들기 버튼은 없다', () => {
  const html = createRoomHtml(empty, { profile: null, dev: false });
  assert.match(html, /data-action="sign-in"/);
  assert.ok(!html.includes('data-action="create-room"'));
  assert.ok(html.includes('href="account.html"'), '내 방 목록으로 나가는 길이 있다');
});

test('방 만들기: 로그인하면 프로필 이름·색으로 들어가고, 이름 입력칸은 없다', () => {
  const html = createRoomHtml(empty, { profile, dev: false });
  assert.match(html, /data-action="create-room"/);
  assert.ok(!html.includes('data-cf="myName"'));
  assert.ok(html.includes('&lt;재윤&gt;') && !html.includes('<재윤>'), '프로필 이름을 이스케이프해 보여 준다');
  assert.ok(html.includes('#34c759'), '프로필 색');
  assert.ok(html.includes('href="account.html#profile"'), '이름·색은 프로필에서 바꾼다');
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
});

test('로그인 뒤 돌아갈 곳은 이 서비스의 방·초대 주소만 받는다', () => {
  assert.equal(nextAfterLogin('?next=room.html%3Froom%3Dr-1a2b3c4d'), 'room.html?room=r-1a2b3c4d');
  assert.equal(nextAfterLogin('?next=room.html%3Finvite%3DAbCdEfGhIjKlMnOpQrStUv_-'), 'room.html?invite=AbCdEfGhIjKlMnOpQrStUv_-');
  for (const bad of ['?next=https%3A%2F%2Fevil.example', '?next=%2F%2Fevil.example', '?next=room.html%3Froom%3D%22%3E', '?next=account.html', '']) {
    assert.equal(nextAfterLogin(bad), null, bad);
  }
});
