// 화면을 불러오는 동안의 뼈대(스켈레톤). 사용자 테스트(11/5)에서 내 계정이 '연결을 확인하는 중이에요' 글자에서 오래 멈춰
// 나갔다 들어왔다. 언제 무엇을 보일지는 응답 시간 임계값을 따른다(지각 주기 T_p ≈ 100ms — Card·Moran·Newell 1983):
// - 0.1초 안에 끝나면 아무것도 바꾸지 않는다. 즉각으로 느껴져 따로 알릴 것이 없다
// - 0.1초가 지나면 곧 나올 화면의 뼈대를 그 자리에 그린다. 100ms 안에 무언가 바뀌어야 멈춤이 아니라 응답으로 읽힌다
// - 1초가 지나면 뼈대에 빛이 지나간다('하는 중' 표시). 1초는 대화에서 침묵을 메워야 한다고 느끼는 한계다
// - 5초가 지나면 진행 막대와 대략 기다릴 시간, '다시 시도'를 보인다(긴 대기에는 진행 표시와 그만둘 수단). 시간은 자릿수만 가늠하게 한다
// - 한번 보인 뼈대는 0.3초(지각 주기 3번)는 둔다. 그보다 짧게 스치면 깜빡임으로 보인다
// import할 때 DOM을 건드리지 않는다(테스트에서 시계를 바꿔 끼운다)
export const SKELETON_MS = { show: 100, busy: 1000, slow: 5000, minShown: 300 };

const systemClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
  now: () => performance.now(),
};

// el에 html 뼈대를 시간에 맞춰 보이고, done()이 끝나면 그 자리를 실제 화면에 넘긴다(done 뒤에 el을 다시 그린다)
export function startSkeleton(el, html, { clock = systemClock } = {}) {
  let shownAt = null;
  const stage = (name) => () => { if (shownAt != null) el.dataset.loading = name; };
  const timers = [
    clock.setTimeout(() => {
      el.innerHTML = html;
      el.setAttribute('aria-busy', 'true');
      el.dataset.loading = 'shown';
      shownAt = clock.now();
      const retry = el.querySelector('[data-action="sk-retry"]');
      if (retry) retry.onclick = () => location.reload();
    }, SKELETON_MS.show),
    clock.setTimeout(stage('busy'), SKELETON_MS.busy),
    clock.setTimeout(stage('slow'), SKELETON_MS.slow),
  ];
  let finished = null;
  return {
    done() {
      if (finished) return finished;
      timers.forEach((t) => clock.clearTimeout(t));
      const left = shownAt == null ? 0 : SKELETON_MS.minShown - (clock.now() - shownAt);
      finished = (left > 0 ? new Promise((r) => clock.setTimeout(r, left)) : Promise.resolve()).then(() => {
        if (shownAt == null) return;
        delete el.dataset.loading;
        el.removeAttribute('aria-busy');
      });
      return finished;
    },
  };
}

// 뼈대는 실제 화면과 같은 자리·크기(hero·next·group·row)를 써서, 화면이 오면 그 자리에서 내용만 채워지는 것처럼 보이게 한다
const bar = (cls = '', width = '') => `<span class="sk-bar${cls ? ` ${cls}` : ''}"${width ? ` style="width:${width}"` : ''}></span>`;
const STATUS = '<p class="sr-only" role="status">불러오는 중이에요</p>';
const SLOW = `<div class="sk-slow"><div class="sk-progress" aria-hidden="true"><i></i></div>
  <p>평소보다 오래 걸리고 있어요. 보통 10초 안에 끝나요.</p><button type="button" class="btn sm secondary" data-action="sk-retry">다시 시도</button></div>`;
const row = () => `<div class="row"><span class="sk-tile"></span><span class="grow">${bar('', '52%')}${bar('meta', '34%')}</span>${bar('amt')}</div>`;
const plainRow = (w) => `<div class="row"><span class="grow">${bar('', w)}</span>${bar('amt')}</div>`;
const page = (body) => `<div class="sk">${STATUS}${body}${SLOW}</div>`;

// 방: 이름·기간, 사람 칩, 다음 할 일 카드, 지출 목록
export const roomSkeleton = () => page(`<section class="hero">${bar('title', '58%')}${bar('', '42%')}<div class="sk-chips">${bar('chip')}${bar('chip')}${bar('chip')}</div></section>
  <section class="next">${bar('', '22%')}${bar('h2', '64%')}${bar('', '86%')}${bar('btn')}</section>
  <section class="group">${bar('label', '18%')}<div class="list">${row()}${row()}${row()}</div></section>`);
// 내 방 목록: 제목과 방 줄
export const roomsSkeleton = () => page(`<header class="hero">${bar('title', '30%')}${bar('', '48%')}</header>
  <section class="group">${bar('label', '20%')}<div class="list">${plainRow('46%')}${plainRow('38%')}${plainRow('52%')}</div></section>`);
// 내 계정 설정: 칸 머리말과 설정 줄
export const settingsSkeleton = () => page([0, 1].map(() => `<section class="group">${bar('label', '24%')}<div class="list">${plainRow('40%')}${plainRow('56%')}${plainRow('32%')}</div></section>`).join(''));
