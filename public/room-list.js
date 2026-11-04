// 내 방 목록의 '진행 중 | 끝남' 탭(#55). 정산이 끝난(status 'done') 방을 진행 중인 방(준비·정산 중)과 나눠 보인다.
// 끝난 방이 하나도 없으면 나눌 것이 없어 탭을 두지 않는다. 화면(account.js)이 고른 탭을 기억했다가 다시 넘긴다
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
  const empty = done.length ? '진행 중인 방이 없어요. 정산이 끝난 방은 ‘끝남’에서 볼 수 있어요.' : '아직 참여한 방이 없어요. 새 방을 만들거나 친구에게 초대 링크를 받으면 여기에 보여요.';
  return { tab: current, rooms: current === 'done' ? done : live, html, empty };
}
