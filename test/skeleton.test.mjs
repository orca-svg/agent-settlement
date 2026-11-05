// 불러오는 동안의 뼈대(스켈레톤). 언제 무엇을 보일지는 응답 시간 임계값을 따른다:
// 0.1초 안이면 그대로, 0.1초에 뼈대, 1초에 '하는 중'(반짝임), 5초에 진행 막대와 다시 시도. 한번 보인 뼈대는 0.3초는 둔다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKELETON_MS, startSkeleton, roomSkeleton, roomsSkeleton, settingsSkeleton } from '../public/skeleton.js';

// 시간을 손으로 넘기는 시계
function fakeClock() {
  let now = 0;
  let id = 0;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { tasks.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (t) => tasks.delete(t),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        tasks.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await Promise.resolve();
      }
      now = end;
      await new Promise((r) => setImmediate(r));
    },
  };
}
const fakeEl = () => ({ innerHTML: 'before', dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, querySelector: () => null });

test('기준 시간: 0.1초에 뼈대, 1초에 하는 중, 5초에 진행 막대, 한번 보이면 0.3초', () => {
  assert.deepEqual(SKELETON_MS, { show: 100, busy: 1000, slow: 5000, minShown: 300 });
});

test('0.1초 안에 끝나면 화면을 바꾸지 않는다(즉각으로 느껴진다)', async () => {
  const clock = fakeClock();
  const el = fakeEl();
  const sk = startSkeleton(el, '<sk>', { clock });
  await clock.advance(80);
  await sk.done();
  await clock.advance(6000);
  assert.equal(el.innerHTML, 'before');
  assert.equal(el.dataset.loading, undefined);
});

test('0.1초가 지나면 뼈대를 그리고, 1초에 하는 중, 5초에 느림으로 바꾼다', async () => {
  const clock = fakeClock();
  const el = fakeEl();
  startSkeleton(el, '<sk>', { clock });
  await clock.advance(99);
  assert.equal(el.innerHTML, 'before');
  await clock.advance(1);
  assert.equal(el.innerHTML, '<sk>');
  assert.equal(el.dataset.loading, 'shown');
  assert.equal(el.attrs['aria-busy'], 'true');
  await clock.advance(900);
  assert.equal(el.dataset.loading, 'busy');
  await clock.advance(4000);
  assert.equal(el.dataset.loading, 'slow');
});

test('한번 보인 뼈대는 0.3초가 지나기 전에는 거두지 않는다(깜빡임 방지)', async () => {
  const clock = fakeClock();
  const el = fakeEl();
  const sk = startSkeleton(el, '<sk>', { clock });
  await clock.advance(150); // 0.1초에 보였고 0.05초 지남
  let finished = false;
  sk.done().then(() => { finished = true; });
  await clock.advance(200);
  assert.equal(finished, false, '보인 지 0.25초');
  await clock.advance(60);
  assert.equal(finished, true, '보인 지 0.31초');
  assert.equal(el.dataset.loading, undefined);
  assert.equal(el.attrs['aria-busy'], undefined);
});

test('뼈대는 화면 읽기에 불러오는 중이라고 알리고, 느릴 때의 안내와 다시 시도를 품는다', () => {
  for (const html of [roomSkeleton(), roomsSkeleton(), settingsSkeleton()]) {
    assert.match(html, /<p class="sr-only" role="status">불러오는 중이에요<\/p>/);
    assert.match(html, /class="sk-slow"[\s\S]*보통 10초 안에 끝나요[\s\S]*data-action="sk-retry">다시 시도<\/button>/);
  }
});

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('방 화면은 방을 불러오는 동안 뼈대를 보이고, 처음 그리기 전에 거둔다', () => {
  const room = read('room.js');
  assert.match(room, /let pageSkeleton = roomId \? startSkeleton\(\$\('#main'\), roomSkeleton\(\)\) : null;/);
  assert.match(room, /if \(pageSkeleton\) \{ await pageSkeleton\.done\(\); pageSkeleton = null; \}\n  render\(\);/);
});

test('내 계정은 첫 화면을 그리기 전에 뼈대를 거두고, 처음부터 글자를 띄우지 않는다', () => {
  const account = read('account.js');
  assert.match(account, /startSkeleton\(panel, onProfile\(\) \? settingsSkeleton\(\) : roomsSkeleton\(\)\)/);
  assert.ok((account.match(/await settle\(\);/g) ?? []).length >= 3, '로그인·탈퇴 마무리·내 방/내 계정 화면 앞');
  assert.doesNotMatch(read('account.html'), /연결을 확인하는 중이에요/, '0.1초 안에 끝나도 글자가 깜빡이지 않게');
});

test('체험 데모에서 느린 연결을 흉내 낼 수 있다(?slow=밀리초, ?slow=0이면 끈다)', () => {
  const boot = read('demo/boot.js');
  assert.match(boot, /get\('slow'\)/);
  assert.match(boot, /if \(slowMs\) await new Promise\(\(r\) => setTimeout\(r, slowMs\)\);/);
});
