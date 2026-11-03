// #2 프로필 색 견본. 화면(public/profile-form.js)과 서버(src/accounts.mjs, 첫 가입 때 무작위로 고름)가 함께 쓴다.
// iOS 시스템 색에서 빌려 왔다. 아바타의 흰 글자가 읽히도록 주황·초록은 대비를 높인 값을 쓴다
export const PROFILE_COLORS = [
  ['#007aff', '파랑'], ['#5856d6', '남색'], ['#af52de', '보라'], ['#ff2d55', '분홍'],
  ['#ff3b30', '빨강'], ['#c93400', '주황'], ['#248a3d', '초록'], ['#30b0c7', '청록'],
];

export const randomProfileColor = (random = Math.random) => PROFILE_COLORS[Math.floor(random() * PROFILE_COLORS.length)][0];
