// 손으로 만지는 움직임은 CSS 전환 대신 스프링으로 한다. 언제든 붙잡아 되돌릴 수 있고, 손가락 속도를 이어받는다.
// 스프링은 Apple식 두 값(damping ratio, response 초)으로 정한다.
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

export class Spring {
  constructor(value, onUpdate) {
    this.value = value;
    this.velocity = 0;
    this.target = value;
    this.onUpdate = onUpdate;
    this.raf = 0;
  }

  // 손가락을 따라갈 때: 애니메이션을 멈추고 값을 바로 놓는다
  set(v) {
    this.stop();
    this.value = this.target = v;
    this.velocity = 0;
    this.onUpdate(v);
  }

  // 지금 화면에 보이는 값과 속도에서 출발해 target으로 간다(중간에 다시 불러도 끊기지 않는다)
  to(target, { damping = 1, response = 0.35, velocity, onRest } = {}) {
    this.target = target;
    if (velocity !== undefined) this.velocity = velocity;
    if (reduceMotion.matches) {
      this.set(target);
      onRest?.();
      return;
    }
    const k = (2 * Math.PI / response) ** 2;
    const c = (4 * Math.PI * damping) / response;
    let last = performance.now();
    this.stop();
    const tick = (now) => {
      const dt = Math.min(0.064, (now - last) / 1000);
      last = now;
      const h = dt / 4;
      for (let i = 0; i < 4; i++) {
        const a = -k * (this.value - this.target) - c * this.velocity;
        this.velocity += a * h;
        this.value += this.velocity * h;
      }
      if (Math.abs(this.velocity) < 2 && Math.abs(this.value - this.target) < 0.4) {
        this.value = this.target;
        this.velocity = 0;
        this.onUpdate(this.value);
        this.raf = 0;
        onRest?.();
        return;
      }
      this.onUpdate(this.value);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

// 최근 100ms의 위치 기록으로 놓는 순간의 속도(px/s)를 구한다
export class VelocityTracker {
  constructor() { this.samples = []; }
  reset() { this.samples = []; }
  add(x) {
    const t = performance.now();
    this.samples.push([x, t]);
    while (this.samples.length > 2 && t - this.samples[0][1] > 100) this.samples.shift();
  }
  get() {
    if (this.samples.length < 2) return 0;
    const [x0, t0] = this.samples[0];
    const [x1, t1] = this.samples.at(-1);
    return t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
  }
}

// 놓은 속도로 계속 미끄러지면 어디서 멈출지(스크롤 감속과 같은 식)
export const project = (velocity, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate);

// 경계를 넘으면 멀리 갈수록 덜 따라온다
export const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
