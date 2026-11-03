// #2 내 계정의 프로필 편집. 색은 시스템 색 견본(라디오)에서 고르고, 이름·색을 바꾸는 대로 위의 미리보기가 바로 바뀐다.
// import할 때 DOM을 건드리지 않는다(테스트에서 불러올 수 있게).
import { esc, avatarHtml } from './ui.js';
import { PROFILE_COLORS } from './profile-colors.js';

export { PROFILE_COLORS };
export const initial = (name) => [...(name.trim() || '?')][0];
const CHECK = '<svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12.5l4 4 8-9" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function profileFormHtml(profile) {
  const now = profile.color.toLowerCase();
  // 견본에 없는 색(예전 색상 선택기로 고른 색)도 사용자가 고른 것이니 지우지 않고 맨 앞에 둔다
  const colors = PROFILE_COLORS.some(([c]) => c === now) ? PROFILE_COLORS : [[now, '지금 색'], ...PROFILE_COLORS];
  const swatches = colors.map(([c, label]) => `<label class="swatch" style="--c:${c}">
      <input type="radio" name="color" value="${c}" aria-label="${label}"${c === now ? ' checked' : ''}>${CHECK}</label>`).join('');
  return `<form id="profile">
    <div class="profile-preview" aria-hidden="true">${avatarHtml(initial(profile.name), now, 'xl')}<span class="title">${esc(profile.name)}</span></div>
    <div class="list"><label class="row field"><span class="grow">표시 이름</span><input name="name" maxlength="40" required value="${esc(profile.name)}"></label></div>
    <h3 class="group-label" style="margin-top:20px"><span>프로필 색</span></h3>
    <div class="list"><div class="swatches" role="radiogroup" aria-label="프로필 색">${swatches}</div></div>
  </form>`;
}

// 이름·색을 바꾸는 대로 미리보기를 고친다. 저장은 화면의 상단바가 맡고, 여기서는 지금 값과 바뀌었는지만 알려 준다
export function mountProfileForm(form, { onSubmit } = {}) {
  const avatar = form.querySelector('.profile-preview .avatar');
  const title = form.querySelector('.profile-preview .title');
  const value = () => Object.fromEntries(new FormData(form));
  const saved = JSON.stringify(value());
  const sync = () => {
    const { name, color } = value();
    avatar.style.setProperty('--c', color);
    avatar.textContent = initial(name);
    title.textContent = name.trim() || '이름 없음';
  };
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  form.addEventListener('submit', (e) => { e.preventDefault(); onSubmit?.(); }); // 이름 칸에서 Enter
  return { value, changed: () => JSON.stringify(value()) !== saved };
}
