// 방 만들기·참가하기·환율 정책 동의·초대 링크 화면(#4). HTML만 만들고, 상태와 서버 호출은 room.js가 한다.
import { esc, chip } from './ui.js';
import { POLICIES } from './data.js';

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

// 방이 없을 때: 방 만들기 폼. 개발용 데모 방 버튼은 아래에 남긴다
export function createRoomHtml(d, { busy, error, seedFailed, askName = true, dev = true }) {
  return `<section class="hero"><h1>정산 방 만들기</h1>
    <p class="sub">여행·회식 같은 모임을 만들고 친구를 초대해요. 돈을 쓰기 전에 환율을 어떻게 셀지 함께 정해 둬요.</p></section>
    <section class="group"><div class="list">
      <label class="row field"><span class="grow">방 이름</span><input data-cf="name" value="${esc(d.name)}" placeholder="예: 오사카 2박 3일" maxlength="40"></label>
      <label class="row field"><span class="grow">기간</span><input data-cf="dates" value="${esc(d.dates)}" placeholder="예: 11월 7일 – 9일" maxlength="40"></label>
      ${askName ? `<label class="row field"><span class="grow">내 이름</span><input data-cf="myName" value="${esc(d.myName)}" placeholder="친구들에게 보일 이름" maxlength="20"></label>` : ''}
    </div></section>
    <section class="group"><h2 class="group-label"><span>환율 정책</span><span>외화로 쓴 돈을 원화로 바꾸는 방법</span></h2>
      ${policyPicker(d.policy, 'cf-policy')}</section>
    <section class="next">${errorHtml(error)}
      <div class="actions"><button class="btn" data-action="create-room" ${busy ? 'disabled' : ''}>${busy ? '만드는 중…' : '방 만들기'}</button></div></section>
    ${dev ? `<section class="next"><p class="eyebrow">개발용</p><h2>데모 방 만들기</h2>
      <p>${seedFailed ? '서버가 개발용 시드를 막았어요. <code>DEV_SEED=1 npm start</code>로 서버를 다시 켜 주세요.' : '오사카 2박 3일 지출 7건과 4명의 비서 설정이 들어간 방을 만들어요.'}</p>
      <div class="actions"><button class="btn plain" data-action="seed">데모 방 만들기</button></div></section>` : ''}`;
}

// 초대 링크로 들어왔을 때: 방 정보, 정책, 참가 동의
export function joinHtml(inv, d, { busy, error, needLogin = false, askName = true }) {
  if (inv.error) {
    return `<section class="hero"><h1>초대 링크를 열 수 없어요</h1><p class="sub">${esc(inv.error)}. 방에 있는 친구에게 새 링크를 부탁해 주세요.</p></section>
      <section class="next"><div class="actions"><a class="btn plain" href="?">새 방 만들기</a></div></section>`;
  }
  if (!inv.room) return '<section class="hero"><h1>초대장을 여는 중…</h1></section>';
  const { room } = inv;
  const p = policyOf(room.policy);
  const head = `<section class="hero"><p class="eyebrow">초대받았어요</p><h1>${esc(room.name)}</h1>
    <p class="sub">${esc(room.dates || '')}${room.dates ? ' · ' : ''}${room.members.map((m) => esc(m.name)).join(', ')} (${room.members.length}명)</p></section>`;
  if (inv.alreadyMember) {
    return `${head}<section class="next"><h2>이미 이 방의 멤버예요</h2><div class="actions"><a class="btn" href="?room=${encodeURIComponent(room.id)}">방으로 가기</a></div></section>`;
  }
  if (inv.settling) return `${head}<section class="next"><h2>이미 정산을 시작한 방이라 들어갈 수 없어요</h2></section>`;
  const policyBox = `<section class="group"><h2 class="group-label"><span>이 방의 환율 정책</span><span>들어간 뒤에 동의해요</span></h2>
      <div class="list"><div class="row"><span class="grow"><span class="title">${esc(p.label)}</span><span class="meta" style="display:block">${esc(p.desc)}</span></span></div></div></section>`;
  // 로그인 전: 방 정보만 보여 주고 로그인부터. 로그인하면 이 화면이 다시 그려진다
  if (needLogin) {
    return `${head}${policyBox}<section class="next"><h2>참가하려면 로그인해 주세요</h2><p>Google 계정으로 로그인하면 프로필 이름으로 참가해요.</p>${errorHtml(error)}
      <div class="actions"><button class="btn" data-action="join-login">Google로 로그인하고 참가</button></div></section>`;
  }
  return `${head}
    <section class="group"><h2 class="group-label"><span>이 방의 환율 정책</span><span>들어간 뒤에 동의해요</span></h2>
      <div class="list"><div class="row"><span class="grow"><span class="title">${esc(p.label)}</span><span class="meta" style="display:block">${esc(p.desc)}</span></span></div></div></section>
    <section class="group"><div class="list">
      ${askName ? `<label class="row field"><span class="grow">내 이름</span><input data-jf="name" value="${esc(d.name)}" placeholder="친구들에게 보일 이름" maxlength="20"></label>` : ''}
      <label class="row"><input type="checkbox" data-jf="agree" ${d.agree ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--tint);flex:none">
        <span class="grow">이 방에 들어가서 함께 쓴 돈을 비서끼리 정산하는 데 동의해요. 내 이름과 이 방에 남긴 지출이 멤버들에게 보여요.</span></label>
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
