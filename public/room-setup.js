// 방 만들기·참가하기·환율 정책 동의·초대 링크 화면(#4). HTML만 만들고, 상태와 서버 호출은 room.js가 한다.
import { esc, chip, avatarHtml, GOOGLE_G } from './ui.js';
import { POLICIES } from './data.js';
import { initial } from './profile-form.js';

export const policyOf = (id) => POLICIES.find((p) => p.id === id) ?? POLICIES[0];
export const notAgreed = (room) => room.members.filter((m) => !m.deleted && !(room.policyAgreedBy ?? []).includes(m.uid));
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

// 방에 보일 나: 프로필 이름·색을 그대로 쓴다(입력받지 않는다). 바꾸려면 프로필로 간다
function meRow(profile, dev) {
  if (!profile) {
    return dev ? '<div class="row"><span class="grow meta">개발용 신원으로 들어가요. 이름은 계정 화면의 프로필에서 바꿔요.</span></div>' : '';
  }
  return `<div class="row">${avatarHtml(initial(profile.name), profile.color)}<span class="grow"><span class="title">${esc(profile.name)}</span>
      <span class="meta" style="display:block">방 사람들에게 이 이름과 색으로 보여요</span></span>
      <a class="btn plain sm" href="account.html#profile">프로필에서 바꾸기</a></div>`;
}

// 로그인 전: 이 자리에서 Google로 로그인한다. 계정 화면으로 갔다 오지 않아 초대 링크를 잃지 않는다
function signInHtml(why) {
  return `<section class="group"><button class="btn google" style="width:100%" data-action="sign-in">${GOOGLE_G}<span>Google로 계속하기</span></button>
    <p class="group-note">${esc(why)} 처음이면 이때 계정이 만들어져요. <a href="${PRIVACY}" target="_blank" rel="noopener">개인정보 처리방침</a></p></section>`;
}

// 방이 없을 때: 방 만들기 폼. 로그인 전이면 로그인부터, 개발용 서버면 데모 방 버튼도 둔다
export function createRoomHtml(d, { busy = false, error = '', seedFailed = false, dev = false, profile = null } = {}) {
  const head = `<section class="hero"><p class="eyebrow"><a href="account.html">내 방 목록</a></p><h1>새 정산 방</h1>
    <p class="sub">여행·회식 같은 모임을 만들고 초대 링크로 친구를 불러요. 돈을 쓰기 전에 환율을 어떻게 셀지 함께 정해 둬요.</p></section>`;
  const seed = dev ? `<section class="next"><p class="eyebrow">개발용</p><h2>데모 방 만들기</h2>
      <p>${seedFailed ? '서버가 개발용 시드를 막았어요. <code>DEV_SEED=1 npm start</code>로 서버를 다시 켜 주세요.' : '오사카 2박 3일 지출 7건과 4명의 비서 설정이 들어간 방을 만들어요.'}</p>
      <div class="actions"><button class="btn plain" data-action="seed">데모 방 만들기</button></div></section>` : '';
  if (!profile && !dev) return head + signInHtml('방을 만들려면 로그인해 주세요. 내 프로필 이름으로 방에 들어가요.');
  return `${head}
    <section class="group"><div class="list">
      <label class="row field"><span class="grow">방 이름</span><input data-cf="name" value="${esc(d.name)}" placeholder="오사카 2박 3일" maxlength="40"></label>
      <label class="row field"><span class="grow">기간</span><input data-cf="dates" value="${esc(d.dates)}" placeholder="11월 7일 – 9일" maxlength="40"></label>
      ${meRow(profile, dev)}
    </div></section>
    <section class="group"><h2 class="group-label"><span>환율 정책</span><span>외화로 쓴 돈을 원화로 바꾸는 방법</span></h2>
      ${policyPicker(d.policy, 'cf-policy')}
      <p class="group-note">지금은 원화로 쓴 돈만 남길 수 있어서, 고른 정책에 따라 금액이 달라지지는 않아요. 외화 지출은 환율을 정하는 단계가 생기면 열려요.</p></section>
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
  const p = policyOf(room.policy);
  const head = `<section class="hero"><p class="eyebrow">초대받았어요</p><h1>${esc(room.name)}</h1>
    <p class="sub">${esc(room.dates || '')}${room.dates ? ' · ' : ''}${room.members.map((m) => esc(m.name)).join(', ')} (${room.members.length}명)</p></section>`;
  if (inv.alreadyMember) {
    return `${head}<section class="next"><h2>이미 이 방의 멤버예요</h2><div class="actions"><a class="btn" href="?room=${encodeURIComponent(room.id)}">방으로 가기</a></div></section>`;
  }
  if (inv.settling) return `${head}<section class="next"><h2>이미 정산을 시작한 방이라 들어갈 수 없어요</h2><div class="actions"><a class="btn plain" href="account.html">내 방 목록</a></div></section>`;
  const policy = `<section class="group"><h2 class="group-label"><span>이 방의 환율 정책</span><span>들어간 뒤에 동의해요</span></h2>
      <div class="list"><div class="row"><span class="grow"><span class="title">${esc(p.label)}</span><span class="meta" style="display:block">${esc(p.desc)}</span></span></div></div></section>`;
  if (!profile && !dev) return head + policy + signInHtml('참가하려면 로그인해 주세요. 로그인하면 이 화면으로 돌아와요.');
  return `${head}${policy}
    <section class="group"><div class="list">
      ${meRow(profile, dev)}
      <label class="row"><input type="checkbox" data-jf="agree" ${d.agree ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--tint);flex:none">
        <span class="grow">이 방에 들어가서 함께 쓴 돈을 비서끼리 정산하는 데 동의해요. 내 프로필 이름·색과 이 방에 남긴 지출이 멤버들에게 보여요.</span></label>
    </div></section>
    <section class="next">${errorHtml(error)}
      <div class="actions"><button class="btn" data-action="join-room" ${busy ? 'disabled' : ''}>${busy ? '들어가는 중…' : '참가하기'}</button></div></section>`;
}

// 방 화면: 환율 정책 동의 현황과 초대 링크
export function setupHtml({ room, me, avatar, invite, policyEdit, copied, error, canShare }) {
  const settling = room.status === 'settling';
  const p = policyOf(room.policy);
  const waiting = notAgreed(room);
  const iAgreed = (room.policyAgreedBy ?? []).includes(me.uid);
  const people = room.members.filter((m) => !m.deleted).map((m) => `<div class="row">${avatar(m.uid)}<span class="grow">${esc(m.name)}${m.uid === me.uid ? ' (나)' : ''}</span>
      ${(room.policyAgreedBy ?? []).includes(m.uid) ? chip('동의함', 'ok') : chip('동의 전', 'warn')}</div>`).join('');
  const policyButtons = settling ? '' : `<div class="actions">${iAgreed ? '' : '<button class="btn" data-action="agree-policy">이 정책에 동의해요</button>'}
      <button class="btn plain sm" data-action="edit-policy">${policyEdit ? '그만 바꾸기' : '정책 바꾸기'}</button></div>`;
  const policy = `<section class="group"><h2 class="group-label"><span>환율 정책 · ${esc(p.label)}</span>
      <span>${settling ? '정산 중이라 바꿀 수 없어요' : waiting.length ? `${waiting.length}명 동의 전` : '모두 동의했어요'}</span></h2>
    <div class="list">${people}</div>
    <p class="preview-note" style="margin:8px 0">${esc(p.desc)}${settling ? '' : ' 정책을 바꾸면 모두 다시 동의해야 해요.'}</p>
    ${policyEdit && !settling ? policyPicker(room.policy, 'set-policy') : ''}
    ${errorHtml(error)}${policyButtons}</section>`;
  if (settling) return policy;
  const link = invite ? inviteUrl(invite.token) : '';
  const inviteBox = invite
    ? `<div class="list"><label class="row field"><span class="grow">초대 링크</span><input readonly value="${esc(link)}" aria-label="초대 링크" data-select-all></label></div>
      <p class="preview-note" style="margin:8px 0">${esc(until(invite.expiresAt))}까지 쓸 수 있어요. 새 링크를 만들면 이 링크는 더 이상 열리지 않아요.</p>
      <div class="actions"><button class="btn" data-action="copy-invite">${copied ? '복사했어요' : '링크 복사'}</button>
        ${canShare ? '<button class="btn secondary" data-action="share-invite">공유하기</button>' : ''}
        <button class="btn plain sm" data-action="make-invite">새 링크 만들기</button></div>`
    : `<p class="preview-note" style="margin:0 0 8px">링크를 받은 친구는 방 이름과 환율 정책을 보고 직접 참가해요.</p>
      <div class="actions"><button class="btn secondary" data-action="make-invite">초대 링크 만들기</button></div>`;
  return `${policy}<section class="group"><h2 class="group-label"><span>친구 초대</span><span>${room.members.length}명</span></h2>${inviteBox}</section>`;
}
