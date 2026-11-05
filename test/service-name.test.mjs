// 서비스 이름은 Bill:ION이다(2026-11-06 확정). 옛 이름 '정산은 비서끼리'는 화면·문서·서버 어디에도 남지 않는다.
// '돈 얘기는 비서끼리'·'비서끼리 기록'처럼 콘셉트·기능을 설명하는 말은 이름이 아니라 그대로 둔다
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(root, f), 'utf8');
const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const rel = join(dir, name);
  return statSync(join(root, rel)).isDirectory() ? walk(rel) : [rel];
});

test('옛 서비스 이름이 화면·서버·문서에 남지 않는다', () => {
  const files = [...walk('public'), ...walk('src'), 'server.mjs', 'README.md', 'PRIVACY.md', 'ARCHITECTURE.md', 'package.json']
    .filter((f) => /\.(html|js|mjs|css|md|json)$/.test(f));
  const left = files.filter((f) => read(f).includes('정산은 비서끼리'));
  assert.deepEqual(left, []);
});

test('화면 제목과 상단 서비스 이름은 Bill:ION', () => {
  for (const page of ['index.html', 'account.html', 'demo/account.html', 'demo/index.html']) {
    assert.match(read(`public/${page}`), /<title>[^<]*Bill:ION<\/title>/, page);
  }
  for (const page of ['index.html', 'account.html', 'demo/account.html']) {
    assert.match(read(`public/${page}`), /class="nav-brand"[^>]*>Bill:ION</, page);
  }
  assert.match(read('public/account.js'), /class="nav-brand" href="\.\/">Bill:ION<\/a>/);
  assert.match(read('README.md'), /^# Bill:ION$/m);
  // ION은 Intelligent Orchestration Network의 머리글자다. README는 이름 바로 아래에서 두 부분의 뜻을 풀어 준다
  assert.match(read('README.md'), /^# Bill:ION\n\n<sub><b>Bill<\/b>\(청구서\) \+ <b>ION<\/b>\(<b>I<\/b>ntelligent <b>O<\/b>rchestration <b>N<\/b>etwork\)/m);
  assert.doesNotMatch(read('README.md'), /Operations Network/, '정정 전 뜻(Operations)은 쓰지 않는다');
  assert.match(read('PRIVACY.md'), /서비스 「Bill:ION」 운영/);
});
