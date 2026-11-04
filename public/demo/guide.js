// 체험 데모의 task 체크리스트. 다섯 task를 차례로 열고, 지금 task만 펼쳐 무엇을 누르면 되는지와 '보여 주기'를 둔다.
// 끝났는지는 방문자가 누른 기록이 아니라 데모 저장소의 지금 상태로 판단한다(같은 일을 다른 길로 해도 끝난다).
// 문구는 화면의 버튼 이름을 그대로 쓴다. tasks()는 DOM을 건드리지 않아 테스트에서 부른다
import { ME, FRIENDS } from './scenario.js';
import { isFlagged } from '#src/actions.mjs';
import { OPEN } from '#src/agents/disputes.mjs';
import { active } from '../core.js';
import { esc, ICON_DONE } from '../ui.js';
import { Spring, reduceMotion } from '../motion.js';

const roomHref = (room) => (room ? `room.html?room=${encodeURIComponent(room.id)}` : 'account.html');

// s: { room, invite, expenses, invoices, disputes, transfers, location, agent } — '나'가 마지막으로 만든 방 기준
export function tasks(s) {
  const { room } = s;
  const inRoom = room && { href: roomHref(room), label: '방으로 가기' };
  const mine = s.expenses.filter((e) => e.createdBy === ME);
  const withLines = mine.filter((e) => e.items?.length && e.split === 'items');
  const friendsIn = room ? FRIENDS.filter((f) => room.members.some((m) => m.uid === f.uid && active(m))).length : 0;
  const myInvoices = s.invoices.filter((i) => i.to === ME);
  const myDisputes = s.disputes.filter((d) => d.by === ME);
  const myPay = s.transfers.filter((t) => t.from === ME && t.version === room?.version);
  const left = Boolean(room?.members.some((m) => m.uid === ME && m.left));
  const autoAccepted = myInvoices.length > 0 && !myDisputes.length && myInvoices.every((i) => i.status === 'accepted' && i.decidedBy === 'agent');

  const list = [
    {
      title: '여행 방 만들고 친구 초대하기',
      steps: [
        { text: '내 방에서 ‘새 방 만들기’로 방을 만들어요', note: '기간은 ‘2박 3일’ 같은 빠른 선택으로 골라요.', done: Boolean(room), show: 'a.btn[href="room.html"], [data-action="create-room"]', go: { href: 'account.html', label: '내 방으로 가기' } },
        room && !room.fx
          ? { text: '원화만 쓰는 방이라 환율 정책은 건너뛰었어요', note: '엔화처럼 외화를 쓰는 방에만 환율 정책이 나와요.', skipped: true }
          : { text: '‘외화도 있어요’를 골라 엔화와 환율 정책을 정해요', note: '외화를 쓰는 방에만 환율 정책이 나와요. 정산은 늘 원화로 해요.', done: Boolean(room?.fx), show: '[data-action="cf-foreign"][data-id="yes"]' },
        { text: '참여자 줄 끝 ＋ 버튼으로 초대 링크를 만들어요', done: Boolean(s.invite) || friendsIn > 0, show: '[data-action="open-invite"]', go: inRoom },
        { text: '친구 셋이 링크로 들어와요', note: '데모에서는 링크가 생기면 철수·영희·민수가 몇 초 뒤 들어와 각자 쓴 돈을 남겨요.', done: friendsIn === FRIENDS.length },
      ],
    },
    {
      title: '지출 남기기',
      steps: [
        { text: '‘지출 남기기’에서 ‘영수증 사진’이나 ‘직접 입력’으로 남겨요', note: '사진은 ‘샘플 영수증으로 해 보기’로 읽어 볼 수 있어요. 통화가 엔이면 결제한 날의 환율로 원화를 셈해요. 함께한 사람도 골라요.', done: mine.length > 0, show: '#nav-add:not([hidden]), [data-action="add-expense"]', go: inRoom },
        mine.length && !withLines.length
          ? { text: '메뉴 줄이 없는 지출이라 1/N로 나눠요', skipped: true }
          : { text: '영수증 줄은 ‘나누러 가기’ › ‘비서에게 나누기 맡기기’로 메뉴별로 나눠요', note: '각자의 비서가 공유한 기억으로 나눠요. 근거가 약한 줄은 짐작한 것을 확인해 달라고 물어요.', done: withLines.length > 0 && withLines.every((e) => e.alloc && !e.items.some((it) => isFlagged(e.alloc[it.id]))), show: '.next [data-action="open-exp"], [data-action="allocate-exp"], [data-action="confirm-all-guesses"]' },
      ],
    },
    {
      title: '비서에게 맡길 범위 정하기',
      steps: [
        { text: '내 계정의 ‘내 비서 기본 설정’에서 ‘샘플 계좌·한도로 채우기’를 누르고 ‘저장’해요', note: '숫자를 직접 넣지 않아도 가짜 계좌와 5만 원 한도가 채워져요. 한도가 청구서보다 작아서 task 4에서 비서가 먼저 물어봐요. 보낼 시기(바로·지정일·편할 때)와 이의 처리도 골라 볼 수 있어요.', done: Boolean(s.agent?.onboardedAt), show: '[data-action="agent-sample"]', go: { href: 'account.html#agent', label: '내 계정으로 가기' } },
        { text: '방의 ‘내 계정’ 메뉴 › ‘이 방의 내 비서’에서 ‘이 방에서만’ 값을 정해 봐요', note: '이 방에만 다른 한도나 보낼 시기를 쓸 수 있어요. 고르지 않으면 기본 설정을 따라요.', optional: true, done: Object.keys(s.agent?.roomRules?.[room?.id] ?? {}).length > 0, show: '#nav-me', go: inRoom },
      ],
    },
    {
      title: '맞지 않는 몫 바로잡기',
      steps: [
        { text: '‘비서들에게 청구서 보내기’를 눌러요', note: '각자의 비서가 맡긴 규칙대로 받거나, 한도를 넘으면 주인에게 물어요.', done: s.invoices.length > 0, show: '[data-action="send-invoices"]', go: inRoom },
        autoAccepted
          ? { text: '자동 수락 한도 안이라 비서가 청구서를 바로 받았어요', note: '‘처음부터 다시’ 한 뒤 task 3에서 한도를 낮추면 비서가 먼저 물어봐요.', skipped: true }
          : { text: '내 청구서를 열고 ‘맞지 않는 지출이 있어요’를 눌러요', done: myDisputes.length > 0 || s.location.length > 0, show: '[data-action="open-invoice"]' },
        { text: '‘Google 지도 타임라인 올리기’ › ‘샘플 타임라인으로 해 보기’를 누르고, 골라 둔 ‘2차 바’를 그대로 ‘이의 보내기’', note: '타임라인에서 22:55쯤 자리를 떠난 걸 찾아 지출을 골라 두고, 맞지 않는 점도 채워 둬요.', done: myDisputes.length > 0, show: '[data-action="start-dispute"], [data-action="timeline-guide"]' },
        { text: '중재안을 보고 ‘중재안에 동의’를 눌러요', note: '철수의 비서는 이의를 중재 비서에게 맡기도록 정해 두었어요. 철수도 곧 동의해요.', done: myDisputes.some((d) => d.agreedBy.includes(ME) || !OPEN.includes(d.status)), show: '[data-action="open-dispute"]' },
      ],
    },
    {
      title: '보내고 마무리하기',
      steps: [
        { text: '다시 온 청구서를 ‘이대로 받기’로 받아요', note: '중재안대로 다시 나눈 금액이에요.', done: myPay.length > 0 || left, show: '[data-action="open-invoice"]', go: inRoom },
        { text: '‘보내러 가기’에서 밀어서 보내요', note: '실제로는 금액과 계좌가 채워진 토스 송금 화면이 열려요. 데모에서는 그 직전에 멈춰요.', done: myPay.some((t) => !['scheduled', 'due'].includes(t.status)) || left, show: '[data-action="open-transfer"]' },
        { text: '돌아와서 ‘보냈어요’를 누르면 철수가 ‘받았어요’로 확인해요', done: myPay.some((t) => ['sent', 'confirmed'].includes(t.status)) || left, show: '[data-action="mark-sent"]' },
        { text: '방이 ‘정산 완료’가 되면 정산 완료 카드의 ‘이 방에서 나가기’로 마무리해요', note: '나가지 않으면 끝난 방은 내 방의 ‘끝남’에 기록으로 남아요.', done: left, show: '.next.done [data-action="open-leave"]', go: !left && inRoom },
      ],
    },
  ];
  return list.map((t, i) => ({ ...t, n: i + 1, done: t.steps.every((st) => st.done || st.skipped || st.optional) }));
}

// 지금 task에서 다음에 할 한 가지(선택 단계는 앞 단계를 다 한 뒤에)
export const nextStep = (task) => task && (task.steps.find((st) => !st.done && !st.skipped && !st.optional) ?? task.steps.find((st) => !st.done && !st.skipped));

// ---------------------------------------------------------------- 화면
const OPEN_KEY = 'agent-settlement.demo.guide';
const CHEVRON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCK = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

const remember = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} };
const recall = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const here = (href) => new URL(href, location.href).href === location.href;

// 이 화면에 그 버튼이 있으면 '보여 주기', 다른 화면에 있으면 그리로 가는 링크
function actionHtml(st) {
  if (st.show && document.querySelector(st.show)) return `<button type="button" class="dg-show" data-dg="show" data-sel="${esc(st.show)}">보여 주기</button>`;
  return st.go && !here(st.go.href) ? `<a class="dg-show" href="${esc(st.go.href)}">${esc(st.go.label)}</a>` : '';
}

function stepHtml(st, current) {
  const action = current && !st.done && !st.skipped ? actionHtml(st) : '';
  const state = st.done ? '끝남' : st.skipped ? '건너뜀' : st.optional ? '선택' : '할 일';
  return `<li class="dg-step${st.done ? ' done' : ''}${st.skipped ? ' skipped' : ''}">
      <span class="dg-check" aria-hidden="true">${st.done ? ICON_DONE : st.skipped ? '–' : ''}</span>
      <span class="dg-step-body"><span class="dg-step-text"><span class="sr-only">${state}: </span>${esc(st.text)}${st.optional ? ' <span class="dg-optional">선택</span>' : ''}</span>
        ${st.note && !st.done ? `<span class="dg-step-note">${esc(st.note)}</span>` : ''}${action}</span></li>`;
}

// 데모 화면에 붙인다. snapshot()은 지금 저장소 상태(Promise), reset()은 처음부터 다시.
// 펼친 체크리스트는 화면을 가린다. 그래서 방문자가 화면을 누르기 시작하면 접히고, 접힌 머리에는 다음에 할 한 가지와 '보여 주기'만 남긴다.
// task 하나를 끝내면 다시 펼쳐 다음 task를 보여 준다
export function mountGuide({ snapshot, reset }) {
  const root = document.createElement('aside');
  root.className = 'demo-guide';
  root.setAttribute('aria-label', '체험 데모 task');
  document.body.append(root);
  let open = recall(OPEN_KEY, true);
  let peek = null; // 눌러서 펼쳐 본 task. 없으면 지금 task
  let armed = false;
  let lastCurrent = null;
  let html = '';
  let body = null;
  // 접고 펼 때 본문 높이를 스프링으로 옮긴다(감쇠 1, 튀지 않게). 움직임 줄이기면 바로 바뀐다
  const height = new Spring(0, (h) => { if (body) body.style.height = `${Math.max(0, h)}px`; });

  async function render() {
    const list = tasks(await snapshot());
    const current = list.find((t) => !t.done) ?? null;
    if ((current?.n ?? 0) !== lastCurrent) {
      if (lastCurrent !== null) open = true; // task 하나를 끝내면 다음 task를(모두 끝내면 끝난 것을) 펼쳐 보인다
      lastCurrent = current?.n ?? 0;
      peek = null;
    }
    const finished = list.filter((t) => t.done).length;
    const shown = peek ?? current?.n;
    const items = list.map((t) => {
      const locked = !t.done && t !== current;
      const expanded = !locked && t.n === shown;
      const head = `<span class="dg-num${t.done ? ' done' : ''}" aria-hidden="true">${t.done ? ICON_DONE : locked ? LOCK : t.n}</span>
        <span class="dg-task-title"><span class="dg-task-n">Task ${t.n}</span>${esc(t.title)}</span>`;
      return `<li class="dg-task${t.done ? ' done' : ''}${locked ? ' locked' : ''}${t === current ? ' current' : ''}">
        ${locked ? `<div class="dg-task-head">${head}<span class="sr-only"> · 앞 task를 끝내면 열려요</span></div>`
          : `<button type="button" class="dg-task-head" data-dg="peek" data-n="${t.n}" aria-expanded="${expanded}">${head}</button>`}
        ${expanded ? `<ol class="dg-steps">${t.steps.map((st) => stepHtml(st, t === current)).join('')}</ol>` : ''}</li>`;
    }).join('');
    const step = nextStep(current);
    const [eyebrow, title] = !current ? [`체험 데모 · ${finished}/${list.length}`, '다섯 task를 모두 해 봤어요']
      : open ? [`체험 데모 · ${finished}/${list.length} 끝냄`, `Task ${current.n} · ${current.title}`]
      : [`체험 데모 · Task ${current.n}/${list.length} ${current.title}`, step?.text ?? current.title];
    const next = `<div class="dg-head">
        <button type="button" class="dg-toggle" data-dg="toggle" aria-expanded="${open}" aria-controls="dg-body">
          <span class="dg-eyebrow">${esc(eyebrow)}</span>
          <span class="dg-title">${esc(title)}</span>
          <span class="dg-chev">${CHEVRON}</span>
        </button>
        ${!open && step ? `<div class="dg-head-action">${actionHtml(step)}</div>` : ''}
        <div class="dg-bar" role="progressbar" aria-label="끝낸 task" aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${finished}"><i style="width:${(finished / list.length) * 100}%"></i></div>
      </div>
      <div class="dg-body" id="dg-body"${open ? '' : ' hidden'}><div class="dg-inner">
        <p class="dg-fake">금액·환율·계좌·위치는 모두 가짜예요. 돈은 움직이지 않아요.</p>
        ${current ? '' : '<p class="dg-done-note">방 만들기부터 나가기까지 비서끼리 정산을 끝까지 따라왔어요.</p>'}
        <ol class="dg-tasks">${items}</ol>
        <div class="dg-foot"><button type="button" class="dg-reset${armed ? ' armed' : ''}" data-dg="reset">${armed ? '한 번 더 누르면 처음부터 다시 해요' : '처음부터 다시'}</button></div>
      </div></div>`;
    if (next === html) return;
    // 다시 그려도 초점은 누르던 자리에 둔다
    const f = root.contains(document.activeElement) ? document.activeElement : null;
    const again = f && (f.dataset.n ? `[data-dg="${f.dataset.dg}"][data-n="${f.dataset.n}"]` : f.dataset.dg ? `[data-dg="${f.dataset.dg}"]` : null);
    html = next;
    root.innerHTML = next;
    root.classList.toggle('open', open);
    body = root.querySelector('.dg-body');
    if (again) root.querySelector(again)?.focus();
  }

  async function toggle() {
    const from = open ? body?.getBoundingClientRect().height ?? 0 : 0;
    open = !open;
    remember(OPEN_KEY, open);
    html = '';
    await render();
    if (reduceMotion.matches || !body) return;
    body.hidden = false;
    const to = open ? body.scrollHeight : 0;
    height.set(from);
    height.to(to, { damping: 1, response: 0.32, onRest: () => { if (!body) return; body.style.height = ''; body.hidden = !open; } });
  }

  // 그 버튼을 화면 가운데로 옮기고 테두리로 잠깐 가리킨다(색만이 아니라 두께로)
  function spotlight(sel) {
    const el = document.querySelector(sel);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    el.classList.remove('dg-spot');
    void el.offsetWidth; // 같은 버튼을 다시 가리켜도 처음부터 보이게
    el.classList.add('dg-spot');
    setTimeout(() => el.classList.remove('dg-spot'), 2400);
  }

  // 화면의 다른 곳을 누르면(방문자가 하기 시작하면) 접는다
  document.addEventListener('pointerdown', (e) => {
    if (open && !root.contains(e.target) && !e.target.closest?.('.demo-toss-root')) toggle();
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dg]');
    if (!btn) return;
    const kind = btn.dataset.dg;
    if (kind === 'toggle') return void toggle();
    if (kind === 'peek') { peek = Number(btn.dataset.n); html = ''; return void render(); }
    if (kind === 'show') return spotlight(btn.dataset.sel);
    if (kind === 'reset') {
      if (armed) return reset();
      armed = true;
      html = '';
      render();
      setTimeout(() => { armed = false; html = ''; render(); }, 4000);
    }
  });

  render();
  // 페이지가 다시 그려지면 '보여 주기'할 버튼이 생기거나 사라진다. 바뀐 게 있을 때만 다시 그린다
  setInterval(render, 1000);
  return { render };
}
