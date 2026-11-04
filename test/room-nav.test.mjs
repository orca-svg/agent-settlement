// 방 화면 위 막대에는 그 방에서 할 일만 둔다. 데모는 '내 방' 목록의 둘러보기에서 들어간다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('방 화면 위 막대에는 데모 보기가 없다(어느 방이든)', () => {
  const nav = read('room.html').match(/<div class="nav-actions"[\s\S]*?<\/header>/)?.[0] ?? '';
  assert.ok(nav, '방 화면 위 막대를 찾는다');
  assert.ok(!nav.includes('데모 보기'), '데모 보기 캡슐을 두지 않는다');
  assert.ok(!/<a [^>]*href="\.\/"/.test(nav), '데모(첫 화면)로 가는 링크를 두지 않는다');
});

test('데모는 내 방 목록의 둘러보기에서 연다(로그인 전·후 모두)', () => {
  const src = read('account.js');
  assert.match(src, /linkRow\('\.\/', '데모 체험하기'/);
  assert.match(src, /demoRows\('둘러보기'/, '로그인한 내 방 목록');
  assert.match(src, /demoRows\('로그인 없이'/, '로그인 전 화면');
});
