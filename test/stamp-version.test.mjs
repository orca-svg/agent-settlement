// 배포 때 화면 파일 주소에 같은 버전을 붙인다(.github/workflows/pages.yml). 배포 직후 새 파일과 캐시의 옛 파일이 섞이지 않게.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stampJs, stampHtml, stampDir } from '../scripts/stamp-version.mjs';

test('stampJs: 상대 경로 import·export·동적 import에 ?v=를 붙인다', () => {
  const src = [
    "import { won } from './core.js';",
    'export { esc } from "./ui.js";',
    "import './motion.js';",
    "const m = await import('./data.js');",
    "import x from '../public/data.js';",
  ].join('\n');
  assert.equal(stampJs(src, 'abc1234'), [
    "import { won } from './core.js?v=abc1234';",
    'export { esc } from "./ui.js?v=abc1234";',
    "import './motion.js?v=abc1234';",
    "const m = await import('./data.js?v=abc1234');",
    "import x from '../public/data.js?v=abc1234';",
  ].join('\n'));
});

test('stampJs: 바깥 주소, 이미 버전이 붙은 주소, import가 아닌 문자열은 그대로', () => {
  const src = [
    "import { x } from 'https://cdn.example.com/x.js';",
    "import { y } from './y.js?v=old';",
    "const note = '자세한 건 ./room.js에 있어요';",
    "fetch('./api.js');",
  ].join('\n');
  assert.equal(stampJs(src, 'abc1234'), src);
});

test('stampHtml: 스크립트와 스타일시트에만 ?v=를 붙이고, 페이지 링크와 바깥 주소는 그대로', () => {
  const html = [
    '<link rel="stylesheet" href="style.css">',
    '<a class="nav-btn" href="room.html">실제 방 열기</a>',
    '<script type="module" src="room.js"></script>',
    '<img src="https://example.com/y.png" alt="">',
  ].join('\n');
  assert.equal(stampHtml(html, 'abc1234'), [
    '<link rel="stylesheet" href="style.css?v=abc1234">',
    '<a class="nav-btn" href="room.html">실제 방 열기</a>',
    '<script type="module" src="room.js?v=abc1234"></script>',
    '<img src="https://example.com/y.png" alt="">',
  ].join('\n'));
});

test('stampDir: 폴더 안의 .js·.html을 모두 같은 버전으로 바꾸고, 바뀐 파일 이름을 돌려준다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  fs.writeFileSync(path.join(dir, 'room.js'), "import { a } from './ui.js';\n");
  fs.writeFileSync(path.join(dir, 'ui.js'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(dir, 'room.html'), '<script type="module" src="room.js"></script>\n');
  fs.writeFileSync(path.join(dir, 'style.css'), 'body { color: red; }\n');
  assert.deepEqual(stampDir(dir, 'abc1234').sort(), ['room.html', 'room.js']);
  assert.equal(fs.readFileSync(path.join(dir, 'room.js'), 'utf8'), "import { a } from './ui.js?v=abc1234';\n");
  assert.equal(fs.readFileSync(path.join(dir, 'room.html'), 'utf8'), '<script type="module" src="room.js?v=abc1234"></script>\n');
  assert.equal(fs.readFileSync(path.join(dir, 'style.css'), 'utf8'), 'body { color: red; }\n');
});

test('stampDir: 하위 폴더(demo/, src/)의 .js·.mjs·.html도 같은 버전으로 바꾼다', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stamp-'));
  fs.mkdirSync(path.join(dir, 'demo'));
  fs.mkdirSync(path.join(dir, 'src', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo', 'room.html'), '<script type="module" src="../room.js"></script>\n');
  fs.writeFileSync(path.join(dir, 'src', 'agents', 'x.mjs'), "import { won } from '../../public/core.js';\n");
  assert.deepEqual(stampDir(dir, 'abc1234').sort(), ['demo/room.html', 'src/agents/x.mjs']);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'agents', 'x.mjs'), 'utf8'), "import { won } from '../../public/core.js?v=abc1234';\n");
});
