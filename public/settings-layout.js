// 내 계정의 웹 설정 배치. 모든 설정을 한 페이지에 두고, 넓은 화면은 왼쪽에 스크롤을 따라오는 목차를 둔다.
// 목차 링크는 주소의 #(account.html#payout 등)으로 가서 공유·뒤로가기가 되고, 방의 '기본 설정 바꾸기'(#agent)도 같은 길로 온다.
// 한 줄은 '이름·설명 | 컨트롤' 두 칸이고 좁은 화면에서는 위아래로 쌓인다. import할 때 DOM을 건드리지 않는다
import { esc } from './ui.js';

export const SETTINGS_TOC = [
  { id: 'profile', label: '프로필' },
  { id: 'agent', label: '내 비서 기본 설정', children: [
    { id: 'payout', label: '받을 계좌' },
    { id: 'rules', label: '비서 규칙' },
    { id: 'notify', label: '알림' },
  ] },
  { id: 'account', label: '계정' },
];
// 문서 순서 그대로. 목차의 지금 위치는 이 순서로 위에서부터 찾는다
export const SETTINGS_IDS = SETTINGS_TOC.flatMap((s) => [s.id, ...(s.children ?? []).map((c) => c.id)]);

export function tocHtml(toc = SETTINGS_TOC) {
  const item = ({ id, label, children }) => `<li><a href="#${id}" data-toc="${id}">${esc(label)}</a>${children ? `<ol>${children.map(item).join('')}</ol>` : ''}</li>`;
  return `<nav class="settings-toc" aria-label="내 계정 목차"><ol>${toc.map(item).join('')}</ol></nav>`;
}

// label·desc는 화면에 박힌 글이라 이스케이프하지 않는다(사용자 값은 부르는 쪽이 이스케이프해 넘긴다). 입력칸이 하나면 forId로 이름을 그 칸의 label로 잇는다.
// action: 값을 고르는 줄이 아니라 버튼 하나로 하는 일(로그아웃·탈퇴). 버튼을 오른쪽 끝, 줄 가운데 높이에 둔다
export function settingRow({ label, desc = '', control, forId = '', action = false }) {
  const name = forId ? `<label class="set-name" for="${forId}">${label}</label>` : `<span class="set-name">${label}</span>`;
  return `<div class="set-row${action ? ' set-action' : ''}"><div class="set-label">${name}${desc ? `<p class="set-desc">${desc}</p>` : ''}</div><div class="set-control">${control}</div></div>`;
}

// 설정 묶음: 제목·설명 아래에 카드. level 2는 맨 위 묶음(프로필·계정), 3은 '내 비서 기본 설정' 아래 칸.
// body를 배열로 주면 카드를 나눠 담는다(되돌릴 수 없는 일을 일상적인 일과 떨어뜨릴 때)
export function settingsSection({ id, title, desc = '', body, level = 3 }) {
  const cards = [].concat(body).map((b) => `<div class="set-card">${b}</div>`).join('');
  return `<section class="set-section" id="${id}" aria-labelledby="${id}-title"><h${level} class="set-title" id="${id}-title">${title}</h${level}>${desc ? `<p class="set-intro">${desc}</p>` : ''}${cards}</section>`;
}
