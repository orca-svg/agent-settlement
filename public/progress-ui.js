// 방 화면 맨 위의 장부 줄과 정산 단계 막대·한 줄 요약(progress.js의 판정을 그린다).
// 장부는 단계와 따로 늘 열려 있다: 지출은 정산 중에도, 끝난 뒤에도(추가 정산) 더할 수 있어서 '모으기'를 끝나는 단계로 그리지 않는다.
// 21st.dev Stepper(@kevingirelli)의 모양을 앱 토큰으로 옮겼다: 끝난 단계 ✓, 지금 단계 채운 원, 남은 단계 빈 원과 번호.
// 색만으로 구분하지 않게 ✓·번호·굵기를 함께 쓰고, 끝난 단계는 스크린리더에 '끝남'으로 읽힌다
import { esc, CHECK } from './ui.js';
import { won } from './core.js';
import { STEPS, movedText } from './progress.js';

const SHOWN = 2; // 남은 일은 둘까지 보이고 나머지는 개수로

function stepHtml(label, i, step) {
  const n = i + 1;
  if (n < step || step === STEPS.length) return `<li class="done"><span class="step-dot">${CHECK}</span><span class="step-label">${label}</span><span class="sr-only">끝남</span></li>`;
  if (n === step) return `<li class="now" aria-current="step"><span class="step-dot">${n}</span><span class="step-label">${label}</span></li>`;
  return `<li><span class="step-dot">${n}</span><span class="step-label">${label}</span></li>`;
}

// 장부 줄. '지출 추가'는 지출 목록 머리의 버튼과 같은 이름·같은 동작이다(어디서 눌러도 같은 시트)
const bookHtml = ({ count, total }) => `<div class="book"><span class="book-label">장부</span><span class="book-sum">지출 ${count}건 · ${won(total)}</span><button type="button" class="text-btn" data-action="add-expense">지출 추가</button></div>`;

export function stepperHtml(p) {
  const head = `<section class="settle-steps" aria-label="정산 단계">${p.book ? bookHtml(p.book) : ''}<ol class="stepper">${STEPS.map((label, i) => stepHtml(label, i, p.step)).join('')}</ol>`;
  // 끝난 방은 완료 카드가 요약을 말한다
  if (p.step === STEPS.length) return `${head}</section>`;
  const more = p.remaining.length - SHOWN;
  const left = p.remaining.length
    ? `<p class="step-left">남은 일: ${esc(p.remaining.slice(0, SHOWN).join(' · '))}${more > 0 ? ` 외 ${more}개` : ''}</p>`
    : '';
  // 추가 정산: 단계가 처음부터 다시 도는 까닭과, 이미 오간 돈은 다시 보내지 않는다는 것을 요약 바로 아래에 둔다
  const extra = p.extra ? `<p class="step-extra">추가 정산 · ${esc(movedText(p.extra.moved))}</p>` : '';
  const meter = p.ratio == null ? '' : `<div class="meter" aria-hidden="true"><i style="width:${Math.round(p.ratio * 100)}%"></i></div>`;
  return `${head}
    <div class="step-note"><p class="step-sum"><b>${p.step}/${STEPS.length} ${p.label}</b> · ${esc(p.summary)}</p>${extra}${left}${meter}</div></section>`;
}
