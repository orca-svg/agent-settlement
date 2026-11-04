// #4 앱 안에서 참가하기. '내 방'의 '초대 링크로 참가하기'에 친구에게 받은 링크(카톡 메시지 통째도)를 붙여 넣으면
// 이 서비스의 초대 화면(room.html?invite=…)으로 간다. 붙여 넣은 주소로 보내지 않고 토큰만 꺼내 쓰므로 다른 곳으로 새지 않는다
import { CHEVRON, ICON_LINK } from './ui.js';

const TOKEN = '[A-Za-z0-9_-]{16,64}';

export function inviteTokenFrom(text) {
  const s = String(text ?? '').trim();
  if (new RegExp(`^${TOKEN}$`).test(s)) return s;
  const m = s.match(new RegExp(`[?&]invite=(${TOKEN})(?=[&#\\s]|$)`));
  return m ? m[1] : null;
}

// 줄을 누르면 그 자리에 입력칸이 펼쳐진다(새 화면으로 가지 않는다). 알아볼 수 없으면 입력칸 바로 아래에 알린다
export function joinLinkHtml() {
  return `<button type="button" class="row new-room" id="join-toggle" aria-expanded="false" aria-controls="join-link">
      <span class="new-room-icon" aria-hidden="true">${ICON_LINK}</span><span class="grow"><span class="title">초대 링크로 참가하기</span>
      <span class="meta" style="display:block">친구에게 받은 링크를 붙여 넣어요</span></span>${CHEVRON}</button>
    <form class="row join-link" id="join-link" hidden novalidate>
      <input id="join-input" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…/room.html?invite=…" aria-label="받은 초대 링크" aria-describedby="join-error">
      <button type="submit" class="btn sm">참가 화면 열기</button>
      <p class="join-error" id="join-error" role="alert"></p></form>`;
}
