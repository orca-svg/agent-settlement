// 방 화면 맨 위의 정산 단계 막대와 한 줄 요약(progress.js의 판정을 그린다).
// 21st.dev Stepper(@kevingirelli)의 모양을 앱 토큰으로 옮겼다: 끝난 단계 ✓, 지금 단계 채운 원, 남은 단계 빈 원과 번호.
// 색만으로 구분하지 않게 ✓·번호·굵기를 함께 쓰고, 끝난 단계는 스크린리더에 '끝남'으로 읽힌다
import { esc, CHECK } from './ui.js';
import { STEPS } from './progress.js';

const SHOWN = 2; // 남은 일은 둘까지 보이고 나머지는 개수로

function stepHtml(label, i, step) {
  const n = i + 1;
  if (n < step || step === STEPS.length) return `<li class="done"><span class="step-dot">${CHECK}</span><span class="step-label">${label}</span><span class="sr-only">끝남</span></li>`;
  if (n === step) return `<li class="now" aria-current="step"><span class="step-dot">${n}</span><span class="step-label">${label}</span></li>`;
  return `<li><span class="step-dot">${n}</span><span class="step-label">${label}</span></li>`;
}

export function stepperHtml(p) {
  const steps = `<ol class="stepper">${STEPS.map((label, i) => stepHtml(label, i, p.step)).join('')}</ol>`;
  // 끝난 방은 완료 카드가 요약을 말한다
  if (p.step === STEPS.length) return `<section class="settle-steps" aria-label="정산 단계">${steps}</section>`;
  const more = p.remaining.length - SHOWN;
  const left = p.remaining.length
    ? `<p class="step-left">남은 일: ${esc(p.remaining.slice(0, SHOWN).join(' · '))}${more > 0 ? ` 외 ${more}개` : ''}</p>`
    : '';
  const meter = p.ratio == null ? '' : `<div class="meter" aria-hidden="true"><i style="width:${Math.round(p.ratio * 100)}%"></i></div>`;
  return `<section class="settle-steps" aria-label="정산 단계">${steps}
    <div class="step-note"><p class="step-sum"><b>${p.step}/${STEPS.length} ${p.label}</b> · ${esc(p.summary)}</p>${left}${meter}</div></section>`;
}
