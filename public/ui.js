// 데모 화면과 실제 방 화면이 함께 쓰는 UI 부품. import할 때 DOM을 건드리지 않는다(테스트에서 불러올 수 있게).
import { Spring, VelocityTracker, project, rubberband, reduceMotion } from './motion.js';
import { won } from './core.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const chip = (text, cls = '') => `<span class="chip ${cls}">${esc(text)}</span>`;
export const avatarHtml = (label, color, cls = '') => `<span class="avatar ${cls}" style="--c:${color}" aria-hidden="true">${esc(label)}</span>`;

// 받침 유무로 조사를 고른다(오차즈케는 / 생맥주는 / 하이볼은). '나'가 주어면 '내가'.
const hasBatchim = (w) => {
  const s = w.replace(/[^가-힣]+$/, '');
  const c = s.charCodeAt(s.length - 1) - 0xac00;
  return c >= 0 && c <= 11171 && c % 28 !== 0;
};
export const topic = (w) => `${w}${hasBatchim(w) ? '은' : '는'}`;
export const subj = (w) => (w === '나' ? '내가' : `${w}${hasBatchim(w) ? '이' : '가'}`);
export const obj = (w) => `${w}${hasBatchim(w) ? '을' : '를'}`;
// '○○ 몫'의 앞말. 나 혼자면 '내 몫'.
export const whose = (w) => (w === '나' ? '내' : w);

// 메뉴 배분을 어떻게 했는지(서버 응답의 how) 영수증 줄 위에 짧게 보인다.
export function allocLabel({ source, how, latencyMs }) {
  if (how === 'obvious') return 'AI 없이 나눔';
  const sec = latencyMs ? ` · ${(latencyMs / 1000).toFixed(1)}초` : '';
  if (!source || source === 'rules') return `규칙${sec}`;
  const model = source.replace(/^gemini-/, 'Gemini ').replace(/-flash/, ' Flash').replace(/-preview/, ' Preview');
  return `${model}${how === 'cache' ? ' · 이전 답 재사용' : sec}`;
}

// 사람별 몫 아래 한 줄. 원 단위로 나누고 남은 돈이 있을 때만 보인다(core.js의 shares().rest).
export const restNote = (rest) => (rest ? `<p class="group-note">나누고 남은 ${won(rest)}은 낸 사람 몫에 더했어요.</p>` : '');

// 영수증 사진을 넣는 버튼(#6). capture가 붙은 입력은 iOS·Android 모두 고르는 메뉴 없이 카메라로 바로 가고,
// 없으면 운영체제가 정한다(iOS는 사진 보관함·사진 찍기 메뉴, Android 14 이상 Chrome은 카메라 없는 사진 선택기).
// 그래서 휴대폰·태블릿(touch)에는 갈 곳이 정해진 버튼 둘을 같은 크기로 두고, 컴퓨터에는 capture 없는 하나만 둔다.
export function receiptPickers(touch) {
  const pick = (label, cls, attrs = '') => `<label class="btn${cls}" style="display:inline-flex;align-items:center;justify-content:center${touch ? ';flex:1' : ''}">${label}
      <input type="file" accept="image/*"${attrs} data-receipt hidden></label>`;
  return touch
    ? pick('사진 찍기', '', ' capture="environment"') + pick('앨범에서 고르기', ' secondary')
    : pick('사진 고르기', '');
}

const ICONS = {
  stay: '<path d="M3 19V6M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6"/><circle cx="7" cy="11.5" r="2"/>',
  food: '<path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1.5-3 4-3 7s1 4 3 4"/>',
  ticket: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10" stroke-dasharray="2 2"/>',
  drink: '<path d="M5 4h14l-7 8zM12 12v7M8 20h8"/>',
  shop: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  bus: '<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 18v2M16 18v2"/>',
};
export const tile = (kind) => `<span class="tile ${ICONS[kind] ? kind : 'shop'}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[kind] || ICONS.shop}</svg></span>`;
export const CHEVRON = '<svg class="chev" width="8" height="14" viewBox="0 0 8 14" aria-hidden="true"><path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const CHECK = '<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const ARROW = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// 데스크톱에서 휴대폰으로 넘길 때 보여줄 QR 이미지 주소(#8).
// 외부 서비스(api.qrserver.com)를 쓴다. 오프라인 데모가 필요해지면 이 함수만 바꾸면 된다.
// 주의: 여기 넘기는 data는 이 외부 서비스가 그대로 보게 된다. 계좌·금액 같은 민감 정보를
// 직접 담지 말고, 우리 서버로 돌아오는 짧은 수명 토큰(src/payments/qr.mjs)처럼 민감하지 않은 값만 넘긴다.
export function qrImageUrl(data, size = 220) {
  if (!data) return null;
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}`;
}

// 가지고 있는 QR 토큰({ id: 송금 id, token, expiresAt })을 이 송금에 그대로 써도 되는지(#8).
// 만료까지 marginMs(기본 1분)보다 적게 남았으면 false다. 휴대폰을 꺼내 찍는 사이에 만료되지 않게 미리 새로 받는다.
export function qrIsFresh(qr, transferId, now = Date.now(), marginMs = 60_000) {
  return Boolean(qr) && qr.id === transferId && Date.parse(qr.expiresAt) - marginMs > now;
}

// 메뉴 배분 버튼. 이미 나눴고 그 뒤로 비서의 기억이 그대로면(fresh, 서버의 allocFresh) 다시 나눠도 같은 답이고
// 확인한 줄만 지워지니 막는다. 막을 때는 무엇이 남았는지 버튼 아래(hint)에 알려 준다
export function allocButton({ allocated, fresh, flagged }) {
  if (!allocated) return { label: '비서에게 나누기 맡기기', disabled: false, hint: '' };
  if (!fresh) return { label: '비서에게 다시 나누기', disabled: false, hint: '' };
  if (flagged) return { label: '비서가 나누기를 마쳤어요', disabled: true, hint: `확인 필요한 ${flagged}줄만 확인하면 끝나요.` };
  return { label: '나누기를 모두 마쳤어요', disabled: true, hint: '지출을 고치거나 비서의 기억이 바뀌면 다시 나눌 수 있어요.' };
}

// 컴퓨터인지는 화면 너비가 아니라 마우스로 가리키는지로 본다(#8). 가로로 돌린 휴대폰은 넓어도 토스가 바로 열리기 때문이다
export const COMPUTER_QUERY = '(hover: hover) and (pointer: fine)';

// 보낼 사람의 송금 화면에 무엇을 둘지. 컴퓨터에서는 슬라이더로 토스가 열리지 않으니 토스 링크가 있으면 QR만 둔다.
// 링크가 없으면(목록에 없는 은행) QR을 만들 수 없어 컴퓨터에서도 계좌 복사 슬라이더를 남긴다
export function sendMode(t, { computer }) {
  if (computer && t.link) return 'qr';
  if (t.link || t.fallback) return 'slider';
  return 'no-payout';
}

// 비서끼리 기록 한 줄
export const logItemHtml = ({ avatar, who, time, text, meta = '', tagHtml = '', enter = false, unread = false, extraHtml = '' }) => `<li class="${enter ? 'enter' : ''}${unread ? ' unread' : ''}">
    ${avatar}
    <div><div class="who"><span>${esc(who)}</span><time>${esc(time)}</time></div>
      <p class="text">${esc(text)}</p>
      ${meta ? `<div class="meta">${esc(meta)}</div>` : ''}
      ${tagHtml ? `<div class="tag">${tagHtml}</div>` : ''}${extraHtml}</div>
  </li>`;

// 이어진 같은 종류의 기록(같은 비서, 같은 kind, 할 일 없음)을 한 묶음으로. kind가 없는 기록은 묶지 않는다.
export function groupRuns(list) {
  const out = [];
  for (const e of list) {
    const head = out.at(-1)?.[0];
    if (head && e.kind && !e.action && !head.action && head.kind === e.kind && head.from === e.from) out.at(-1).push(e);
    else out.push([e]);
  }
  return out;
}

// 시트: 스프링으로 올라오고, 손잡이를 끌어 내리면 놓는 속도로 닫힐지 정한다.
// open(beforeMeasure)는 내용을 그린 뒤 높이를 재야 하므로 그리는 함수를 받는다.
export function createSheet(root, { onClosed } = {}) {
  const sheetEl = root.querySelector('.sheet');
  const scrim = root.querySelector('.scrim');
  const handle = root.querySelector('.sheet-head');
  let h = 0;
  let closing = false;
  let returnFocus = null;
  const y = new Spring(0, (v) => {
    sheetEl.style.transform = `translate3d(0, ${v}px, 0)`;
    scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - v / (h || 1))));
  });

  function open(beforeMeasure = () => {}) {
    if (!root.hidden && !closing) return beforeMeasure();
    if (closing) {
      closing = false;
      beforeMeasure();
      return y.to(0, { damping: 1, response: 0.35 });
    }
    returnFocus = document.activeElement;
    root.hidden = false;
    document.body.classList.add('sheet-open');
    beforeMeasure();
    h = sheetEl.offsetHeight;
    if (reduceMotion.matches) {
      y.set(0);
      requestAnimationFrame(() => root.classList.add('shown'));
    } else {
      y.set(h);
      y.to(0, { damping: 1, response: 0.35 });
    }
    sheetEl.focus({ preventScroll: true });
  }

  function close(velocity = 0) {
    if (root.hidden || closing) return;
    closing = true;
    const finish = () => {
      if (!closing) return;
      closing = false;
      root.hidden = true;
      root.classList.remove('shown');
      document.body.classList.remove('sheet-open');
      onClosed?.();
      returnFocus?.focus?.({ preventScroll: true });
    };
    if (reduceMotion.matches) {
      root.classList.remove('shown');
      setTimeout(finish, 200);
      return;
    }
    h = sheetEl.offsetHeight;
    y.to(h + 24, { damping: 1, response: 0.3, velocity, onRest: finish });
  }

  const tracker = new VelocityTracker();
  let drag = null;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    handle.setPointerCapture(e.pointerId);
    y.stop();
    closing = false;
    h = sheetEl.offsetHeight;
    drag = { y0: e.clientY, from: y.value, moved: false };
    tracker.reset();
    tracker.add(y.value);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    let v = drag.from + dy;
    if (v < 0) v = -rubberband(-v, h);
    y.set(v);
    tracker.add(v);
  });
  const endDrag = () => {
    if (!drag) return;
    const { moved } = drag;
    drag = null;
    const v = tracker.get();
    if (moved && y.value + project(v) > h * 0.5) close(v);
    else y.to(0, { damping: 0.8, response: 0.35, velocity: v });
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  return { open, close, get visible() { return !root.hidden; } };
}

// 분할 컨트롤: 선택 표시가 이전 위치에서 스프링으로 미끄러진다. 다시 그려도 위치를 이어받도록 data-seg별로 기억한다.
const segPos = new Map();
export function mountSegs(scope) {
  scope.querySelectorAll('.seg').forEach((seg) => {
    const thumb = seg.querySelector('.seg-thumb');
    const on = seg.querySelector('[aria-checked="true"]');
    if (!on) return;
    const key = seg.dataset.seg;
    const x = on.offsetLeft;
    thumb.style.width = `${on.offsetWidth}px`;
    const spring = new Spring(0, (v) => {
      thumb.style.transform = `translate3d(${v}px, 0, 0)`;
      segPos.set(key, v);
    });
    spring.set(segPos.get(key) ?? x);
    if (spring.value !== x) spring.to(x, { damping: 1, response: 0.3 });
  });
}
export const resetSegs = () => segPos.clear();

// 밀어서 보내기: 끝까지 밀어야(또는 Enter) onCommit(el.dataset)이 불린다. 중간에 놓으면 손 속도를 이어받아 돌아간다.
// onCommit(dataset)은 끝까지 밀려 스프링이 멈춘 뒤에, onCommitGesture(dataset)는 손을 놓는(또는 Enter) 그 처리기 안에서 동기적으로 부른다.
// 송금 앱처럼 사용자 제스처 안에서만 열리는 것은 onCommitGesture에서 연다.
export function mountSliders(scope, handlers) {
  const { onCommit = () => {}, onCommitGesture = () => {} } = typeof handlers === 'function' ? { onCommit: handlers } : handlers;
  scope.querySelectorAll('.slider').forEach((el) => {
    const thumb = el.querySelector('.slider-thumb');
    const fill = el.querySelector('.slider-fill');
    const label = el.querySelector('.slider-label');
    const max = () => el.clientWidth - thumb.offsetWidth - 8;
    const x = new Spring(0, (v) => {
      thumb.style.transform = `translate3d(${v}px, 0, 0)`;
      fill.style.width = `${Math.max(0, v) + 60}px`;
      label.style.opacity = String(Math.max(0, 1 - Math.max(0, v) / (max() * 0.6)));
    });
    const tracker = new VelocityTracker();
    let d = null;
    let done = false;
    const commit = (v) => {
      done = true;
      onCommitGesture(el.dataset);
      x.to(max(), {
        damping: 1,
        response: 0.25,
        velocity: Math.max(0, v),
        onRest: () => {
          navigator.vibrate?.(12);
          onCommit(el.dataset);
        },
      });
    };
    thumb.addEventListener('pointerdown', (e) => {
      if (done) return;
      e.preventDefault();
      thumb.setPointerCapture(e.pointerId);
      x.stop();
      d = { x0: e.clientX, from: x.value };
      tracker.reset();
      tracker.add(x.value);
      el.classList.add('pressed');
    });
    thumb.addEventListener('pointermove', (e) => {
      if (!d) return;
      const m = max();
      let v = d.from + e.clientX - d.x0;
      if (v > m) v = m + rubberband(v - m, m);
      if (v < 0) v = -rubberband(-v, m);
      x.set(v);
      tracker.add(v);
    });
    const end = () => {
      if (!d) return;
      d = null;
      el.classList.remove('pressed');
      const v = tracker.get();
      const m = max();
      if (x.value > m * 0.5 && x.value + project(v, 0.99) >= m * 0.95) commit(v);
      else x.to(0, { damping: 0.8, response: 0.35, velocity: v });
    };
    thumb.addEventListener('pointerup', end);
    thumb.addEventListener('pointercancel', end);
    thumb.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !done) {
        e.preventDefault();
        commit(0);
      }
    });
  });
}

// 분할 컨트롤의 방향키 이동: 다음 버튼을 누른 것처럼 처리하고, 다시 그린 뒤 그 버튼에 초점을 둔다
export function segArrowKeys(e, press) {
  const seg = e.target.closest?.('.seg');
  if (!seg || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return false;
  const buttons = [...seg.querySelectorAll('button')];
  const i = buttons.indexOf(e.target);
  const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length];
  const key = seg.dataset.seg;
  press(next);
  document.querySelector(`.seg[data-seg="${key}"] [data-id="${next.dataset.id}"]`)?.focus();
  return true;
}
