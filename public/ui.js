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

// 이의 당사자(지출을 낸 사람·이의를 낸 사람) 중 아직 중재안에 동의하지 않은 사람. 같은 사람이면 한 번만
export const disputeWaiting = (d, exp) => [...new Set([exp.payer, d.by])].filter((u) => !d.agreedBy.includes(u));

// 아직 열린 이의(중재 전·중재안이 나온 뒤). 열린 이의가 하나라도 있으면 송금이 만들어지지 않는다
export const disputeLive = (d) => d.status === 'open' || d.status === 'proposed';

// 중재안을 거부해서 끝난 이의(이의를 낸 사람이 거두면 withdrawn, 지출을 낸 사람이 거부하면 dismissed)
export const disputeRejected = (d) => d.status === 'withdrawn' || d.status === 'dismissed';

// 이의 시트에서 이 사람이 누를 수 있는 것. 중재안이 살아 있는(proposed) 동안 당사자만 동의·거부한다.
// 비서가 근거 규칙으로 먼저 동의해 뒀어도 사람은 거부로 물러설 수 있어서, 동의했는지와 상관없이 거부는 열어 둔다
export function disputeChoices(d, exp, uid) {
  const live = d.status === 'proposed' && [exp.payer, d.by].includes(uid);
  return { agree: live && !d.agreedBy.includes(uid), reject: live };
}

// 방 화면 '이의' 목록의 한 줄(글자만, 그리는 쪽에서 esc). 열린 이의는 누구를 기다리는지, 끝난 이의는 어떻게 끝났는지
export function disputeStatus(d, exp, nameOf) {
  if (d.status === 'open') return '아직 중재 전이에요';
  if (d.status === 'proposed') {
    const waiting = disputeWaiting(d, exp);
    return `중재안이 나왔어요${waiting.length ? `. ${waiting.map(nameOf).join('·')}의 동의를 기다려요` : ''}`;
  }
  if (d.status === 'resolved') return '양쪽이 동의해서 다시 나눴어요';
  if (d.status === 'withdrawn') return `${subj(nameOf(d.rejectedBy))} 중재안을 거부하고 이의를 거뒀어요`;
  if (d.status === 'dismissed') return `${subj(nameOf(d.rejectedBy))} 중재안을 거부해서 끝났어요`;
  return '지출이 바뀌어 닫혔어요';
}

// 동의·거부해서 시트를 닫은 뒤 방 화면에 남기는 한 줄(글자만, 그리는 쪽에서 esc).
// 상대가 나중에 동의하거나 거부해도 맞도록 그 순간이 아니라 지금 이의 상태로 만든다
export function disputeNote(d, exp, nameOf) {
  if (d.status === 'resolved') return `양쪽이 동의해서 ${obj(`‘${exp.title}’`)} 중재안대로 다시 나눴어요. 청구서도 다시 보냈어요.`;
  if (d.status === 'superseded') return `지출이 바뀌어 ‘${exp.title}’ 이의가 닫혔어요.`;
  if (d.status === 'withdrawn') return `${subj(nameOf(d.rejectedBy))} 중재안을 거부하고 ‘${exp.title}’ 이의를 거뒀어요. 지금 배분 그대로 정산해요.`;
  if (d.status === 'dismissed') return `${subj(nameOf(d.rejectedBy))} 중재안을 거부해서 ‘${exp.title}’ 이의가 끝났어요. 지금 배분 그대로 정산해요.`;
  const waiting = disputeWaiting(d, exp);
  return `중재안에 동의했어요.${waiting.length ? ` ${waiting.map(nameOf).join('·')}의 동의를 기다려요.` : ''}`;
}

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
  pin: '<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
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
// 링크 줄의 아이콘(글자색을 따른다). Lucide link·copy·share·check·external-link(lucide-static 0.460.0), ISC License,
// Copyright (c) Lucide Contributors 2022, portions Copyright (c) Cole Bemis 2013-2022 (Feather, MIT). https://lucide.dev/license
const lucide = (d, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON_LINK = lucide('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>', 16);
export const ICON_COPY = lucide('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>');
export const ICON_SHARE = lucide('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>');
export const ICON_DONE = lucide('<path d="M20 6 9 17l-5-5"/>');
// 다른 앱·새 창으로 나가는 링크 버튼 끝에 붙인다
export const ICON_EXTERNAL = lucide('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>', 15);
export const ALERT = '<svg class="alert-ico" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5l9 15.5H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.4v.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
export const CROSS = '<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
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

// 청구서를 막는 줄(비서가 근거 없이 짐작하지 않고 사람에게 물은 줄)을 지출별로 모은다.
// 서버의 sendInvoices가 409로 막는 기준(src/actions.mjs의 isFlagged)을 받아 쓴다. 화면이 서버를 기다리지 않고 같은 판단을 하려는 것이다
export function flaggedLines(expenses, isFlagged) {
  return expenses.flatMap((e) => {
    const lines = (e.items ?? []).filter((it) => isFlagged(e.alloc?.[it.id])).map((it) => ({ id: it.id, name: it.name }));
    return lines.length ? [{ expId: e.id, title: e.title, owner: e.createdBy, lines }] : [];
  });
}

// 확인이 필요한 줄을 누구의 비서가 물었는지. 청구서가 막혔다는 안내와 지출 시트의 그 줄 칩이 같은 말을 쓴다.
// '누가 확인해야 한다'가 아니라 '누구의 비서가 물어봤다'고 쓴다: 서버는 방 멤버 누구나 줄을 확인하게 두므로 철수만 할 수 있다는 말이 되면 안 된다.
// 데모 방에는 이름이 '나'인 사람이 있어 내가 보는 사람이 아닐 때는 ‘나’로 따옴표를 쳐서 구분한다
export function askedBy(uid, { me, nameOf }) {
  const agent = uid === me ? '내 비서' : nameOf(uid) === '나' ? '‘나’의 비서' : `${nameOf(uid)}의 비서`;
  return `${agent}가 물어봤어요`;
}

// 청구서 보내기를 눌렀는데 막혔을 때 버튼 아래에 보일 안내: 몇 줄이 남았고, 어느 지출의 어느 줄을, 누구의 비서가 물었는지, 어디로 가면 되는지.
// 지출마다 한 줄이고, 그 지출의 첫 줄로 안내한다
export function blockedNotice(groups, { me, nameOf }) {
  if (!groups.length) return null;
  const total = groups.reduce((n, g) => n + g.lines.length, 0);
  return {
    title: '청구서를 아직 보낼 수 없어요',
    lead: `비서가 짐작하지 않고 물어본 줄이 ${total}줄 남았어요.`,
    total,
    rows: groups.map((g) => {
      const [first] = g.lines;
      const more = g.lines.length - 1;
      return { expId: g.expId, lineId: first.id, what: `${g.title}의 ‘${first.name}’${more ? ` 외 ${more}줄` : ''}`, who: askedBy(g.owner, { me, nameOf }), label: '확인하러 가기' };
    }),
  };
}

// 안 된다는 뜻으로 버튼을 좌우로 흔든다. 스프링에 처음 속도만 주고 제자리(0)를 목표로 두면 감쇠하며 두세 번 흔들리다 멈춘다.
// 손으로 만지는 움직임과 같은 스프링이라, 흔들리는 중에 다시 눌러도 지금 위치에서 이어서 흔든다. 움직임 줄이기면 흔들지 않는다(false)
const shakes = new WeakMap();
export function shake(el, { velocity = 460, damping = 0.16, response = 0.18 } = {}) {
  if (reduceMotion.matches) return false;
  let spring = shakes.get(el);
  if (!spring) {
    spring = new Spring(0, (v) => {
      // 움직이는 동안은 .btn의 CSS 전환(100ms)이 스프링을 둔하게 만들지 않도록 끈다
      el.style.transition = v ? 'none' : '';
      el.style.transform = v ? `translate3d(${v}px, 0, 0)` : '';
    });
    shakes.set(el, spring);
  }
  spring.to(0, { damping, response, velocity });
  return true;
}

// 막혔다는 걸 누른 버튼 자리에서 알린다. 움직임 줄이기면 흔드는 대신 글자만 잠깐 밑줄로 강조한다(위치·색은 그대로. style.css의 [data-nudge])
export function nudge(el, ms = 1600) {
  if (!reduceMotion.matches) return shake(el);
  el.setAttribute('data-nudge', '');
  setTimeout(() => el.removeAttribute('data-nudge'), ms);
  return false;
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
// 밀어서 보낸 뒤 송금 화면에 띄울 안내. pending은 { id, left }(페이지가 한 번이라도 가려졌는지), event는 'timeout'·'hidden'·'visible'.
// 시간이 지나도 페이지가 그대로면 앱이 없거나 iOS가 'Open in "Toss"?'를 묻는 중이라 실패로 단정하지 않는다:
// 복사 안내만 띄우고 기다림은 남겨, 나중에 토스로 넘어갔다 돌아오면 '보냈나요?'(back)로 바꾼다
export function sendFollowUp(pending, event) {
  if (!pending) return { pending: null, note: null };
  if (event === 'hidden') return { pending: { ...pending, left: true }, note: null };
  if (event === 'visible') return pending.left ? { pending: null, note: 'back' } : { pending, note: null };
  return { pending, note: pending.left ? null : 'fallback' }; // timeout
}

// 비서끼리 기록 한 줄. 시스템 로그가 아니라 비서들의 대화처럼 보이게 한다: 말은 말풍선에, 받는 사람은 '○○에게'로,
// 근거(규칙·수치)는 말풍선 밖에 접어 두어 궁금한 사람만 연다. 같은 분에 이어진 말은 시각을 비워 한 번만 보인다
export const logItemHtml = ({ avatar, who, to = '', time = '', text, meta = '', tagHtml = '', enter = false, unread = false, extraHtml = '' }) => `<li class="${enter ? 'enter' : ''}${unread ? ' unread' : ''}">
    ${avatar}
    <div><div class="who"><span>${esc(who)}${to ? ` <span class="to">${esc(to)}에게</span>` : ''}</span>${time ? `<time>${esc(time)}</time>` : ''}</div>
      <p class="text">${esc(text)}</p>
      ${meta ? `<details class="why"><summary>왜 그렇게 했나요</summary><p>${esc(meta)}</p></details>` : ''}
      ${tagHtml ? `<div class="tag">${tagHtml}</div>` : ''}${extraHtml}</div>
  </li>`;

/** 기록 시각을 분까지만. 바로 앞 기록과 같은 분이면 빈 글자를 돌려줘 한 번만 보이게 한다 */
export const minuteLabels = (times) => times.map((t, i) => (i && times[i - 1] === t ? '' : t));

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
// onTravel(p)는 시트가 올라온 정도(0~1)를 매 프레임 받는다. 겹친 시트가 뒤 시트를 그만큼 물리는 데 쓴다
let openSheets = 0; // 겹친 시트 하나를 닫아도 아래 시트가 열려 있으면 뒤 화면 스크롤을 계속 막는다
export function createSheet(root, { onClosed, onTravel } = {}) {
  const sheetEl = root.querySelector('.sheet');
  const scrim = root.querySelector('.scrim');
  const handle = root.querySelector('.sheet-head');
  let h = 0;
  let closing = false;
  let returnFocus = null;
  const y = new Spring(0, (v) => {
    const p = Math.max(0, Math.min(1, 1 - v / (h || 1)));
    sheetEl.style.transform = `translate3d(0, ${v}px, 0)`;
    scrim.style.opacity = String(p);
    onTravel?.(p);
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
    openSheets += 1;
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
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.body.classList.remove('sheet-open');
      onTravel?.(0);
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

// Google 로그인 버튼의 로고(계정 화면, 방 만들기·초대 화면이 함께 쓴다)
export const GOOGLE_G = `<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

// 로그인 뒤 돌아갈 곳(account.html?next=…). 다른 사이트로 넘기지 않게 이 서비스의 방·초대 주소만 받는다
export function nextAfterLogin(search) {
  const next = new URLSearchParams(search).get('next') ?? '';
  return /^room\.html\?(room|invite)=[A-Za-z0-9_-]{1,64}$/.test(next) ? next : null;
}
