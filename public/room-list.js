// 내 방 목록의 '진행 중 | 끝남' 탭(#55). 정산이 끝난(status 'done') 방을 진행 중인 방(준비·정산 중)과 나눠 보인다.
// 끝난 방이 하나도 없으면 나눌 것이 없어 탭을 두지 않는다. 화면(account.js)이 고른 탭을 기억했다가 다시 넘긴다
import { esc, CHEVRON } from './ui.js';
import { STEPS } from './progress.js';

const TABS = [['live', '진행 중'], ['done', '끝남']];

export function roomTabs(rooms, tab = 'live') {
  const done = rooms.filter((r) => r.status === 'done');
  const live = rooms.filter((r) => r.status !== 'done');
  const current = tab === 'done' && done.length ? 'done' : 'live';
  const count = { live: live.length, done: done.length };
  const html = done.length
    ? `<div class="seg" role="radiogroup" aria-label="방 보기" data-seg="rooms-tab"><span class="seg-thumb"></span>
      ${TABS.map(([id, label]) => `<button type="button" role="radio" aria-checked="${id === current}" data-id="${id}">${label} ${count[id]}</button>`).join('')}</div>`
    : '';
  // 진행 중인 방이 없을 때는 끝난 방이 어디 있는지 알려 준다
  const empty = done.length
    ? { title: '진행 중인 방이 없어요', meta: '정산이 끝난 방은 ‘끝남’에서 볼 수 있어요.' }
    : { title: '아직 참여한 방이 없어요', meta: '새 방을 만들거나 친구에게 받은 초대 링크로 참가하면 여기에 보여요.' };
  return { tab: current, rooms: current === 'done' ? done : live, html, empty };
}

// 방 줄. 평소에는 방으로 들어가는 링크(이름 | 기간 | 화살표)이고, '편집' 중에는 들어가지 않고 화살표 자리에 '나가기'가 온다.
// 나가기 버튼은 어느 방인지 이름 칸으로 읽힌다(aria-describedby). 누른 뒤의 확인·한 번 더 누르기는 화면(account.js)이 맡는다.
// 진행 중인 방은 이름 아래에 몇 번째 단계인지와 내 할 일(없으면 무엇을 기다리는지), 그 아래 진행 막대를 둔다(progress.js).
// 내 할 일이 있는 방의 막대만 강조색이라, 목록에서 어디부터 들어갈지 고를 수 있다
const stepLine = (p) => (p && p.step < STEPS.length
  ? `<span class="room-step">${p.extra ? '추가 정산 · ' : ''}${p.step}/${STEPS.length} ${esc(p.label)} · ${p.mine ? `내 할 일 ${p.mine}개` : esc(p.summary)}</span>`
    + `<span class="meter${p.mine ? ' mine' : ''}" aria-hidden="true"><i style="width:${Math.round(p.ratio * 100)}%"></i></span>`
  : '');

export function roomRowsHtml(rooms, { editing = false } = {}) {
  return `<ul class="room-table">${rooms.map((r, i) => {
    const cells = `<span class="room-main"><span class="room-name" id="room-name-${i}">${esc(r.name)}</span>${stepLine(r.progress)}</span><span class="room-dates">${esc(r.dates || '')}</span>`;
    return editing
      ? `<li><div class="room-row">${cells}<button type="button" class="btn sm danger" data-leave="${esc(r.id)}" aria-describedby="room-name-${i}">나가기</button></div></li>`
      : `<li><a href="room.html?room=${encodeURIComponent(r.id)}">${cells}${CHEVRON}</a></li>`;
  }).join('')}</ul>`;
}
