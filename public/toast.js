// 화면 위쪽의 노란 알림(#55). 할 수 없는 동작을 눌렀을 때 그 까닭을 잠깐 보여 주고 스스로 사라진다.
// 상단바 바로 아래에서 내려오고 같은 길로 올라가며 사라진다. 스프링이라 사라지는 중에 새 알림이 오면 그 자리에서 다시 내려온다.
// 읽는 동안(포인터를 올려 두면) 사라지지 않고, 누르면 바로 닫힌다. 움직임 줄이기를 켜면 미끄러지지 않고 흐려지기만 한다(style.css)
import { ALERT } from './ui.js';
import { Spring, reduceMotion } from './motion.js';

const RISE = 20; // 숨어 있을 때 위로 올라가 있는 거리(px)
const FADE_MS = 200; // 움직임 줄이기에서 흐려지는 시간(style.css의 .toast 전환과 같게)

// 글이 길수록 오래 둔다: 한 글자 60ms, 2.5~8초
export const toastMs = (text) => Math.min(8000, 2500 + [...String(text)].length * 60);

let el = null;
let spring = null;
let timer = 0;
let hover = false;

function mount() {
  el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'alert');
  el.hidden = true;
  el.innerHTML = `${ALERT}<span class="toast-text"></span>`;
  document.body.append(el);
  spring = new Spring(-RISE, (y) => {
    el.style.transform = reduceMotion.matches ? 'none' : `translateY(${y}px)`;
    el.style.opacity = String(Math.max(0, Math.min(1, 1 + y / RISE)));
  });
  el.onpointerenter = () => { hover = true; clearTimeout(timer); };
  el.onpointerleave = () => { hover = false; later(); };
  el.onclick = hide;
}

function later() {
  clearTimeout(timer);
  if (!hover) timer = setTimeout(hide, toastMs(el.textContent));
}

function hide() {
  clearTimeout(timer);
  hover = false; // 눌러 닫으면 포인터가 위에 있던 채로 숨어 pointerleave가 오지 않는다
  spring.to(-RISE, { response: 0.3, onRest: () => { timer = setTimeout(() => { el.hidden = true; }, reduceMotion.matches ? FADE_MS : 0); } });
}

export function toast(text) {
  if (!el) mount();
  clearTimeout(timer);
  el.querySelector('.toast-text').textContent = text;
  el.hidden = false;
  el.getBoundingClientRect(); // 방금 보이게 한 상태를 먼저 그려야 움직임 줄이기의 흐려짐이 처음부터 보인다
  spring.to(0, { response: 0.35 });
  later();
}
