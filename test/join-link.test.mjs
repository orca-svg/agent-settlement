// #4 앱 안에서 참가하기: '내 방'의 '초대 링크로 참가하기'에 받은 링크를 붙여 넣으면 이 서비스의 초대 화면으로 간다.
// 카톡 안 브라우저에서 로그인이 막혀도, 링크를 복사해 앱(기본 브라우저)에서 이어서 참가할 수 있게 한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteTokenFrom, joinLinkHtml } from '../public/join-link.js';

const token = 'AbCdEfGhIjKlMnOpQrStUv_-';

test('붙여 넣은 것에서 초대 토큰만 꺼낸다: 링크·다른 주소의 같은 링크·토큰만·카톡 메시지 통째', () => {
  assert.equal(inviteTokenFrom(`http://localhost:4562/room.html?invite=${token}`), token);
  assert.equal(inviteTokenFrom(`https://orca-svg.github.io/agent-settlement/room.html?invite=${token}&utm=kakao`), token);
  assert.equal(inviteTokenFrom(`  ${token}\n`), token);
  assert.equal(inviteTokenFrom(`‘오사카’ 정산 방에 초대해요 https://orca-svg.github.io/agent-settlement/room.html?invite=${token} 들어와!`), token);
});

test('초대 링크가 아니면 null: 방 주소·다른 사이트·짧은 글자·이상한 문자', () => {
  for (const bad of ['', '오사카', 'room.html?room=r-1a2b3c4d', 'https://evil.example/?next=room.html', `room.html?invite=${token}<script>`, 'invite=abc', null, undefined]) {
    assert.equal(inviteTokenFrom(bad), null, String(bad));
  }
});

test('접힌 줄: 무엇을 하는 줄인지 알리고, 누르면 그 자리에 입력칸이 펼쳐진다', () => {
  const html = joinLinkHtml();
  assert.match(html, /id="join-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="join-link"/);
  assert.match(html, /초대 링크로 참가하기/);
  assert.match(html, /<form[^>]*id="join-link"[^>]*hidden/, '처음엔 입력칸을 숨긴다');
  assert.match(html, /<input[^>]*id="join-input"[^>]*aria-label="받은 초대 링크"/);
  assert.match(html, /<button[^>]*type="submit"[^>]*>참가 화면 열기</);
  assert.match(html, /id="join-error"[^>]*role="alert"/, '알아볼 수 없을 때 입력칸 바로 아래에 알린다');
});
