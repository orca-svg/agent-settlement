// 방 만들기·참가하기·환율 정책 동의·초대 링크 화면(#4), 나가기·내보내기(#55). HTML만 만들고, 상태와 서버 호출은 room.js가 한다.
// 환율 정책은 외화로 쓴 돈을 정산하는 방에만 보이고 묻는다(#55). 원화 방에는 정책 칸·동의 버튼·안내가 없다.
import { esc, chip, avatarHtml, GOOGLE_G, ICON_LINK, ICON_COPY, ICON_SHARE, ICON_DONE, CHEVRON } from './ui.js';
import { POLICIES } from './data.js';
import { active, isForeign } from './core.js';
import { CURRENCIES, unitOf } from './currencies.js';
import { leaveBlock } from './leave.js';
import { initial } from './profile-form.js';
import { rangePickerHtml, todayIso } from './date-range.js';

export const policyOf = (id) => POLICIES.find((p) => p.id === id) ?? POLICIES[0];
export const notAgreed = (room) => (isForeign(room) ? room.members.filter((m) => active(m) && !(room.policyAgreedBy ?? []).includes(m.uid)) : []);
// 청구서를 한 번이라도 보낸 방(정산 중·완료). 초대·정책 변경을 막는다
export const hasStarted = (room) => room.status === 'settling' || room.status === 'done';
export const inviteUrl = (token) => `${location.origin}${location.pathname}?invite=${encodeURIComponent(token)}`;
const until = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
const errorHtml = (msg) => (msg ? `<p class="form-error" role="alert">${esc(msg)}</p>` : '');

// 정책 고르기: 이름과 설명을 함께 보여 주는 목록. action은 누르면 부를 data-action
function policyPicker(current, action) {
  return `<div class="list" role="radiogroup" aria-label="환율 정책">${POLICIES.map((p) => `<button type="button" class="row" role="radio" aria-checked="${p.id === current}" data-action="${action}" data-id="${p.id}">
      <span class="grow"><span class="title">${esc(p.label)}</span><span class="meta" style="display:block">${esc(p.desc)}</span></span>
      ${p.id === current ? chip('선택', 'tint') : ''}</button>`).join('')}</div>`;
}

const PRIVACY = 'https://github.com/orca-svg/agent-settlement/blob/main/PRIVACY.md';

// 방에 보일 나: 프로필 이름·색을 그대로 쓴다(입력받지 않는다). 프로필로 가는 버튼은 두지 않는다(가면 적던 내용을 잃는다)
function meRow(profile, dev) {
  if (!profile) return dev ? '<div class="row"><span class="grow meta">개발용 신원으로 들어가요.</span></div>' : '';
  return `<div class="row">${avatarHtml(initial(profile.name), profile.color)}<span class="grow"><span class="title">${esc(profile.name)}</span>
      <span class="meta" style="display:block">방 사람들에게 이 이름과 색으로 보여요. 프로필을 바꾸면 모든 방에서 함께 바뀌어요</span></span></div>`;
}

export { datesLabel } from './date-range.js';

// 로그인 전: 이 자리에서 Google로 로그인한다. 계정 화면으로 갔다 오지 않아 초대 링크를 잃지 않는다
function signInHtml(why) {
  return `<section class="group"><button class="btn google" style="width:100%" data-action="sign-in">${GOOGLE_G}<span>Google로 계속하기</span></button>
    <p class="group-note">${esc(why)} 처음이면 이때 계정이 만들어져요. <a href="${PRIVACY}" target="_blank" rel="noopener">개인정보 처리방침</a></p></section>`;
}

// 쓴 돈의 통화: 원화만 쓰는 모임이 기본이고, 외화도 쓰는 모임을 고를 때만 어느 외화인지와 환율 정책을 펼친다(#55).
// 정산(송금)은 어느 쪽이든 원화로 한다. 환율은 지출을 남길 때 받아 오므로 여기서는 묻지 않는다
const FX_NOTE = '환율은 지출을 남길 때 그날의 유럽중앙은행(ECB) 기준 환율로 받아 와요. 받지 못하면 한국수출입은행 매매기준율로 대신해요. 둘은 소수점 아래가 조금 다를 수 있어요.';
function currencyHtml(d) {
  const foreign = Boolean(d.foreign);
  const seg = `<div class="seg" role="radiogroup" aria-label="쓴 돈의 통화" data-seg="cf-foreign"><span class="seg-thumb"></span>
      ${[['no', '원화만'], ['yes', '외화도 있어요']].map(([id, label]) => `<button type="button" role="radio" aria-checked="${(id === 'yes') === foreign}" data-action="cf-foreign" data-id="${id}">${label}</button>`).join('')}</div>`;
  const pick = foreign ? `<div class="list" style="margin-top:8px"><label class="row field"><span class="grow">쓰는 외화</span>
      <select data-cf="fxCurrency">${CURRENCIES.map((c) => `<option value="${c.code}" ${c.code === d.fxCurrency ? 'selected' : ''}>${esc(c.label)} (${c.code})</option>`).join('')}</select></label></div>` : '';
  const head = `<section class="group"><h2 class="group-label"><span>쓴 돈의 통화</span><span>정산은 늘 원화로 해요</span></h2>${seg}${pick}</section>`;
  if (!foreign) return head;
  return `${head}<section class="group"><h2 class="group-label"><span>환율 정책</span><span>외화로 쓴 돈을 원화로 바꾸는 방법</span></h2>
      ${policyPicker(d.policy, 'cf-policy')}
      <p class="group-note">${FX_NOTE}</p></section>`;
}

// 방이 없을 때: 방 만들기 폼. 로그인 전이면 로그인부터, 개발용 서버면 데모 방 버튼도 둔다
export function createRoomHtml(d, { busy = false, error = '', seedFailed = false, dev = false, profile = null, picker = {}, today = todayIso() } = {}) {
  const head = `<section class="hero"><h1>새 정산 방</h1>
    <p class="sub">여행·회식 같은 모임을 만들고 초대 링크로 친구를 불러요.</p></section>`;
  const seed = dev ? `<section class="next"><p class="eyebrow">개발용</p><h2>데모 방 만들기</h2>
      <p>${seedFailed ? '서버가 개발용 시드를 막았어요. <code>DEV_SEED=1 npm start</code>로 서버를 다시 켜 주세요.' : '오사카 2박 3일 지출 7건과 4명의 비서 설정이 들어간 방을 만들어요.'}</p>
      <div class="actions"><button class="btn plain" data-action="seed">데모 방 만들기</button></div></section>` : '';
  if (!profile && !dev) return head + signInHtml('방을 만들려면 로그인해 주세요. 내 프로필 이름으로 방에 들어가요.');
  return `${head}
    <section class="group"><div class="list">
      <label class="row field"><span class="grow">방 이름</span><input data-cf="name" value="${esc(d.name)}" placeholder="오사카 2박 3일" maxlength="40"${d.preset ? ' data-select-all' : ''}></label>
      ${rangePickerHtml(d, { ...picker, today })}
      ${meRow(profile, dev)}
    </div></section>
    ${currencyHtml(d)}
    <section class="next">${errorHtml(error)}
      <div class="actions"><button class="btn" data-action="create-room" ${busy ? 'disabled' : ''}>${busy ? '만드는 중…' : '방 만들기'}</button><a class="btn plain" href="account.html">취소</a></div></section>
    ${seed}`;
}

// 초대 링크로 들어왔을 때: 방 미리보기, 정책, (로그인 뒤) 내 프로필과 참가 동의
export function joinHtml(inv, d, { busy = false, error = '', profile = null, dev = false } = {}) {
  if (inv.error) {
    return `<section class="hero"><h1>초대 링크를 열 수 없어요</h1><p class="sub">${esc(inv.error)}. 방에 있는 친구에게 새 링크를 부탁해 주세요.</p></section>
      <section class="next"><div class="actions"><a class="btn plain" href="account.html">내 방 목록</a></div></section>`;
  }
  if (!inv.room) return '<section class="hero"><h1>초대장을 여는 중…</h1></section>';
  const { room } = inv;
  const head = `<section class="hero"><p class="eyebrow">초대받았어요</p><h1>${esc(room.name)}</h1>
    <p class="sub">${esc(room.dates || '')}${room.dates ? ' · ' : ''}${room.members.map((m) => esc(m.name)).join(', ')} (${room.members.length}명)</p></section>`;
  if (inv.alreadyMember) {
    return `${head}<section class="next"><h2>이미 이 방의 멤버예요</h2><div class="actions"><a class="btn" href="?room=${encodeURIComponent(room.id)}">방으로 가기</a></div></section>`;
  }
  if (inv.settling) return `${head}<section class="next"><h2>${inv.done ? '이미 정산이 끝난 방이라 들어갈 수 없어요' : '이미 정산을 시작한 방이라 들어갈 수 없어요'}</h2><div class="actions"><a class="btn plain" href="account.html">내 방 목록</a></div></section>`;
  // 환율 정책은 외화 방에만 있다. 원화 방의 미리보기에는 policy가 오지 않는다
  const p = room.currency && room.policy ? policyOf(room.policy) : null;
  const policy = p ? `<section class="group"><h2 class="group-label"><span>이 방의 환율 정책</span><span>${esc(unitOf(room.currency))}로 쓴 돈 · 들어간 뒤에 동의해요</span></h2>
      <div class="list"><div class="row"><span class="grow"><span class="title">${esc(p.label)}</span><span class="meta" style="display:block">${esc(p.desc)}</span></span></div></div></section>` : '';
  if (!profile && !dev) return head + policy + signInHtml('참가하려면 로그인해 주세요. 로그인하면 이 화면으로 돌아와요.');
  // 동의는 체크박스로 따로 받지 않는다(iOS에는 체크박스가 없다). 무엇이 보이게 되는지 버튼 바로 위에 적고, 버튼이 곧 동의다
  return `${head}${policy}
    <section class="group"><div class="list">${meRow(profile, dev)}</div></section>
    <section class="next"><p>참가하면 내 프로필 이름·색과 이 방에 남긴 지출이 멤버들에게 보여요. 함께 쓴 돈은 각자의 비서끼리 정산해요.</p>${errorHtml(error)}
      <div class="actions"><button class="btn" data-action="join-room" ${busy ? 'disabled' : ''}>${busy ? '들어가는 중…' : '동의하고 참가하기'}</button></div></section>`;
}

// 방 화면: 환율 정책. 방을 만들 때 이미 정한 정책이라, 모두 동의했으면 한 줄로 접는다(아래 setupHtml).
// 아직 동의하지 않은 사람이 있을 때만 누가 남았는지 펼친다. 안내는 경고가 아니므로 주황 상자 대신 보통 글로 쓴다
// 링크 줄 오른쪽의 원형 아이콘 버튼. 보이는 원은 작게, 누르는 자리는 44px(애플 최소 크기)로 둔다
const iconBtn = (action, label, svg, done = false) => `<button type="button" class="icon-btn${done ? ' done' : ''}" data-action="${action}" aria-label="${label}" title="${label}"><span>${svg}</span></button>`;

// 모두 동의한 정책은 끝난 일이라 한 줄로 접는다(사용자 테스트 11/5: "처음에만 보였으면", "모두 동의함 정도로").
// 줄 전체가 누르는 자리이고(더보기 버튼을 따로 두지 않는다), 펼치면 설명·동의한 사람·바꾸기가 같은 카드 안에서 열린다.
// policyOpen: 사람이 펼쳐 둔 상태(다시 그려도 지킨다). 바꾸는 중(policyEdit)에는 늘 펼쳐 둔다
export function setupHtml({ room, me, avatar, policyEdit, policyOpen = false, error }) {
  if (!isForeign(room)) return error ? `<section class="group">${errorHtml(error)}</section>` : ''; // 원화 방에는 환율 정책 칸이 없다(#55)
  const settling = hasStarted(room);
  const p = policyOf(room.policy);
  const waiting = notAgreed(room);
  const iAgreed = (room.policyAgreedBy ?? []).includes(me.uid);
  const memberRows = room.members.filter(active).map((m) => `<div class="row">${avatar(m.uid)}<span class="grow">${esc(m.name)}${m.uid === me.uid ? ' (나)' : ''}</span>
      ${(room.policyAgreedBy ?? []).includes(m.uid) ? chip('동의함', 'ok') : chip('동의 전')}</div>`).join('');
  const change = settling ? '' : `<button class="btn plain sm" data-action="edit-policy">${policyEdit ? '그만 바꾸기' : '바꾸기'}</button>`;
  const picker = policyEdit && !settling ? `<p class="group-note">바꾸면 모두 다시 동의해야 해요.</p>${policyPicker(room.policy, 'set-policy')}` : '';
  if (!waiting.length) {
    const open = Boolean(policyOpen || policyEdit);
    return `<section class="group"><h2 class="group-label"><span>환율 정책 · ${esc(unitOf(room.fx.currency))}</span><span>${settling ? '정산을 시작해서 바꿀 수 없어요' : ''}</span></h2>
    <div class="list"><button type="button" class="row disclosure" data-action="toggle-policy" aria-expanded="${open}" aria-controls="policy-detail"><span class="grow"><span class="title">${esc(p.label)}</span></span>${chip('모두 동의함', 'ok')}${CHEVRON}</button>
      <div class="collapsible${open ? ' open' : ''}" id="policy-detail"${open ? '' : ' inert'}><div class="collapsible-inner">
        <div class="row"><span class="grow"><span class="meta" style="display:block">${esc(p.desc)}</span></span>${change}</div>
        ${memberRows}</div></div></div>
    ${picker}
    ${errorHtml(error)}</section>`;
  }
  const people = `<div class="list" style="margin-top:8px">${memberRows}</div>`;
  const policy = `<section class="group"><h2 class="group-label"><span>환율 정책 · ${esc(unitOf(room.fx.currency))}</span><span>${settling ? '정산을 시작해서 바꿀 수 없어요' : waiting.length ? `${waiting.length}명 동의 전` : ''}</span></h2>
    <div class="list"><div class="row"><span class="grow"><span class="title">${esc(p.label)}</span><span class="meta" style="display:block">${esc(p.desc)}</span></span>${change}</div></div>
    ${people}
    ${!settling && !iAgreed ? '<div class="actions" style="margin-top:10px"><button class="btn" data-action="agree-policy">이 정책에 동의해요</button></div>' : ''}
    ${picker}
    ${errorHtml(error)}</section>`;
  return policy;
}

// 친구 초대는 사람이 모여 있는 곳(방 제목 아래 참여자 줄)의 끝 + 버튼에서 연다. 정산 중인 방에는 두지 않는다
const PLUS = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.5v11M1.5 7h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
export const inviteButtonHtml = () => `<button type="button" class="person add" data-action="open-invite" aria-label="친구 초대" title="친구 초대">${PLUS}</button>`;

// 지금 참여한 사람 한 줄. 방을 만든 사람에게는 다른 사람 줄 끝에 '내보내기'가 있다(#55, 잘못 들어온 사람).
// 그 사람이 낀 지출이 있으면 버튼 대신 까닭을 적는다(누르기 전에 막는다. 서버도 같은 규칙 public/leave.js로 막는다).
// 되돌리기 번거로운 동작이라 지출 지우기처럼 한 번 더 눌러야 내보낸다(armed)
function personRow(m, { room, me, avatar, expenses, armed, removeError }) {
  const mine = m.uid === me.uid;
  let end = '';
  let note = '';
  if (room.createdBy === me.uid && !mine) {
    if (leaveBlock({ room, expenses }, m.uid, { self: false })) note = '지출에 몫이 있어 내보낼 수 없어요';
    else end = `<button type="button" class="btn sm danger${armed === m.uid ? ' armed' : ''}" data-action="remove-member" data-id="${esc(m.uid)}">${armed === m.uid ? '한 번 더 누르면 내보내요' : '내보내기'}</button>`;
  }
  const error = removeError?.uid === m.uid ? `<span class="form-error" role="alert" style="display:block">${esc(removeError.message)}</span>` : '';
  return `<div class="row">${avatar(m.uid)}<span class="grow">${esc(m.name)}${mine ? ' (나)' : ''}${note ? `<span class="meta" style="display:block">${note}</span>` : ''}${error}</span>${end}</div>`;
}

// 친구 초대 시트: 링크 한 줄(복사·공유 아이콘), 친구에게 보일 초대 화면, 지금 참여한 사람(참가하면 여기에 바로 보인다).
// 링크가 아직 없으면 시트를 여는 순간 만든다(그동안 '만드는 중'). 새 링크 만들기는 이전 링크를 무효로 하는 보조 동작이라 맨 아래 글자 버튼.
// 미리보기의 환율 정책 줄은 외화 방에만 있다(#55).
// 체험 데모에는 보낼 친구가 없다. 그래서 링크를 보내지 않아도 시트를 연 순간부터 친구 셋이 들어온다고 맨 위에 알린다(팀 점검 11/5)
const HOW = '링크를 받은 친구가 아래 화면을 보고 Google로 로그인해 바로 참가해요. 카톡으로 보내거나 복사해서 건네주세요.';
const DEMO_HOW = '체험 데모에서는 링크를 보내지 않아도 돼요. 지금부터 철수·영희·민수가 몇 초 간격으로 알아서 들어오고, 각자의 비서가 쓴 돈을 남겨요. 실제 방에서는 이 링크를 카톡으로 보내요.';
export function inviteSheetHtml({ room, me, avatar, invite, copied = false, copyError = '', canShare = false, expenses = [], armed = null, removeError = null, demo = false }) {
  const p = isForeign(room) ? policyOf(room.policy) : null;
  const linkRow = invite
    ? `<div class="list"><div class="row invite-row"><span class="new-room-icon" aria-hidden="true">${ICON_LINK}</span>
        <span class="grow"><input class="invite-url" readonly value="${esc(inviteUrl(invite.token))}" aria-label="초대 링크" data-select-all>
          <span class="meta" style="display:block">${esc(until(invite.expiresAt))}까지 열 수 있어요</span></span>
        ${copied ? iconBtn('copy-invite', '복사했어요', ICON_DONE, true) : iconBtn('copy-invite', '링크 복사', ICON_COPY)}
        ${canShare ? iconBtn('share-invite', '공유하기', ICON_SHARE) : ''}</div></div>
      ${errorHtml(copyError)}<span class="sr-only" role="status">${copied ? '링크를 복사했어요' : ''}</span>`
    : '<div class="list"><div class="row invite-row" aria-busy="true"><span class="grow meta">링크를 만드는 중…</span></div></div>';
  const people = room.members.filter(active);
  return `<p class="how">${demo ? DEMO_HOW : HOW}</p>
    <section class="group">${linkRow}</section>
    <section class="group"><h3 class="group-label"><span>친구에게 이렇게 보여요</span></h3>
      <div class="invite-preview"><p class="eyebrow">초대받았어요</p><p class="invite-preview-title">${esc(room.name)}</p>
        <p class="meta">${esc(room.dates || '')}${room.dates ? ' · ' : ''}${people.map((m) => esc(m.name)).join(', ')} (${people.length}명)</p>
        ${p ? `<p class="meta">환율 정책: ${esc(p.label)}</p>` : ''}</div></section>
    <section class="group"><h3 class="group-label"><span>지금 ${people.length}명</span></h3>
      <div class="list">${people.map((m) => personRow(m, { room, me, avatar, expenses, armed, removeError })).join('')}
        <div class="row invite-waiting"><span class="invite-dot" aria-hidden="true"></span><span class="grow meta">초대한 친구가 참가하면 여기에 바로 보여요</span></div></div></section>
    ${invite ? '<p class="group-note">새 링크를 만들면 지금 링크는 더 이상 열리지 않아요. <button type="button" class="text-btn" data-action="make-invite">새 링크 만들기</button></p>' : ''}`;
}

// 정산이 끝난 방의 다음 할 일 카드. 끝난 방에서 남은 일은 나가기뿐이라 메뉴에 숨기지 않고 여기 둔다.
// 누르면 바로 나가지 않고 나가기 시트(무엇을 잃는지 + 확인)를 연다
export function doneCardHtml() {
  return `<section class="next done"><p class="eyebrow">정산 완료</p><h2>정산이 끝났어요</h2>
      <p>아무도 단톡방에서 돈 얘기를 꺼내지 않았어요. 이 방은 기록으로 남고, 지출을 더 남기거나 고칠 수 없어요. 더 볼 일이 없으면 나가도 돼요. 나가면 내 방 목록에서도 빠져요.</p>
      <div class="actions"><button type="button" class="btn secondary" data-action="open-leave" aria-haspopup="dialog">이 방에서 나가기</button></div></section>`;
}

// '내 계정' 메뉴의 '이 방에서 나가기' 시트(#55). 돈이 남아 있으면 나가기 버튼 대신 까닭을 보인다(누르기 전에 막는다).
// 나갈 수 있으면 무엇을 잃는지 버튼 바로 위에 적는다
export function leaveSheetHtml({ room, why, busy = false, error = '' }) {
  if (why) return `<p class="how">${esc(why)}</p>`; // 닫기는 시트 머리에 있다
  const reason = room.status === 'done' ? '정산이 끝난 방이라 나갈 수 있어요.' : '이 방에 내 몫이 있는 지출이 없어 바로 나갈 수 있어요.';
  return `<p class="how">${reason} 나가면 이 방의 지출·송금 기록을 더 볼 수 없고 내 방 목록에서도 빠져요.${hasStarted(room) ? '' : ' 친구가 초대 링크를 다시 보내 주면 들어올 수 있어요.'}</p>
    ${errorHtml(error)}
    <div class="actions"><button type="button" class="btn danger" data-action="leave-room" ${busy ? 'disabled' : ''}>${busy ? '나가는 중…' : '이 방에서 나가기'}</button><button type="button" class="btn plain" data-action="close-sheet">그대로 있기</button></div>`;
}
