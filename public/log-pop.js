// 좁은 화면(920px 이하)에서 비서끼리 기록을 이 방의 알림처럼 상단바 종에서 연다. 데모 화면과 실제 방 화면이 함께 쓴다.
// 넓은 화면은 오른쪽 기록(#channel)을 그대로 쓰고, CSS가 둘 중 하나만 보이게 한다.
// 최신 기록이 위에 오고, 마지막으로 연 뒤 생긴 기록에 점을 찍는다. 할 일은 맨 위 카드로, 이어진 같은 종류의 기록은 묶는다.
import { esc, groupRuns } from './ui.js';

const $ = (s) => document.querySelector(s);

// events는 오래된 것부터 [{ seq, kind?, action?, text, ... }].
// itemHtml(e, { unread, extraHtml })은 기록 한 줄, timeOf(e)는 묶음 안의 시각, todosHtml()은 맨 위 할 일 카드를 그린다.
// seen.get/set은 마지막으로 본 seq를 읽고 쓴다.
// counts(e)는 종 배지에 셀 기록이다(실제 방은 주인의 알림 수준을 따른다, #5). 기록 목록에는 모두 보인다.
export function createLogPop({ itemHtml, timeOf, todosHtml = () => '', seen, emptyText = '아직 기록이 없어요.', counts = () => true }) {
  const root = $('#log-pop-root');
  const pop = $('#log-pop');
  const bell = $('#nav-bell');
  const badge = $('#bell-badge');
  let events = [];
  let isOpen = false;
  let seenAtOpen = 0;
  const lastSeq = () => events.at(-1)?.seq ?? 0;

  function renderBell() {
    const n = isOpen ? 0 : events.filter((e) => e.seq > seen.get() && counts(e)).length;
    badge.hidden = !n;
    badge.textContent = n > 99 ? '99+' : String(n);
    bell.setAttribute('aria-label', n ? `비서끼리 기록, 새 기록 ${n}개` : '비서끼리 기록');
    bell.setAttribute('aria-expanded', String(isOpen));
  }

  const runHtml = ([e, ...rest], unread) => itemHtml(e, {
    unread,
    extraHtml: rest.length
      ? `<details class="more"><summary>비슷한 기록 ${rest.length}개 더 보기</summary>
        <ol>${rest.map((x) => `<li><span>${esc(x.text)}</span><time>${esc(timeOf(x))}</time></li>`).join('')}</ol></details>`
      : '',
  });

  function render() {
    const top = pop.scrollTop;
    const newest = [...events].reverse();
    const fresh = newest.filter((e) => e.seq > seenAtOpen);
    const old = newest.filter((e) => e.seq <= seenAtOpen);
    const list = (items, unread) => (items.length ? `<ol class="log">${groupRuns(items).map((run) => runHtml(run, unread)).join('')}</ol>` : '');
    pop.innerHTML = `<div class="pop-head"><h2>비서끼리</h2><span>${fresh.length ? `새 기록 ${fresh.length}개` : '새 기록 없음'}</span></div>
      ${todosHtml()}
      ${events.length
        ? `${list(fresh, true)}${fresh.length && old.length ? '<p class="divider">이전 기록</p>' : ''}${list(old, false)}`
        : `<p class="empty">${esc(emptyText)}</p>`}`;
    pop.scrollTop = top;
  }

  function open() {
    isOpen = true;
    seenAtOpen = seen.get();
    seen.set(lastSeq());
    root.hidden = false;
    document.body.classList.add('pop-open');
    render();
    pop.scrollTop = 0;
    void root.offsetWidth; // 숨김을 푼 뒤 한 번 배치해야 종에서 펼쳐지는 전환이 보인다
    root.classList.add('open');
    renderBell();
    pop.focus();
  }

  function close(restoreFocus = true) {
    if (!isOpen) return;
    isOpen = false;
    seen.set(lastSeq());
    root.classList.remove('open');
    document.body.classList.remove('pop-open');
    setTimeout(() => { if (!isOpen) root.hidden = true; }, 220);
    renderBell();
    if (restoreFocus) bell.focus();
  }

  return {
    // 기록이나 할 일이 바뀌면 부른다. 열려 있으면 새 기록도 본 것으로 친다
    update(list) {
      events = list;
      if (isOpen) {
        seen.set(lastSeq());
        render();
      }
      renderBell();
    },
    show(visible) {
      bell.hidden = !visible;
    },
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    get isOpen() {
      return isOpen;
    },
  };
}
