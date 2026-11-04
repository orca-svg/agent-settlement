// 체험 데모 페이지는 실제 페이지에서 만든다(scripts/demo-pages.mjs). 실제 페이지를 고치고 다시 만들지 않으면 여기서 걸린다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { demoPage, PAGES } from '../scripts/demo-pages.mjs';

const pub = path.join(import.meta.dirname, '..', 'public');
const read = (...p) => fs.readFileSync(path.join(pub, ...p), 'utf8');

for (const name of PAGES) {
  test(`demo/${name}는 public/${name}에서 만든 최신본이다`, () => {
    assert.equal(read('demo', name), demoPage(name, read(name)), '실제 페이지가 바뀌었어요. node scripts/demo-pages.mjs를 다시 돌려 주세요');
  });

  test(`demo/${name}: import map이 모듈보다 먼저 오고, boot.js가 화면 코드보다 먼저 돈다`, () => {
    const html = read('demo', name);
    const map = html.indexOf('type="importmap"');
    const boot = html.indexOf('src="boot.js"');
    const entry = html.indexOf(`src="../${name.replace('.html', '.js')}"`);
    assert.ok(map > 0 && map < boot && boot < entry);
    assert.match(html, /가짜이고, 돈은 움직이지 않아요/);
  });

  test(`demo/${name}: 불러오는 파일이 모두 있다`, () => {
    const html = read('demo', name);
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#:?]+\.(?:js|css|png))"/g)) {
      assert.ok(fs.existsSync(path.join(pub, 'demo', ref)), `${ref}가 없어요`);
    }
    const { imports } = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(html)[1]);
    assert.ok(fs.existsSync(path.join(pub, 'demo', imports['node:crypto'])));
    assert.ok(fs.existsSync(path.join(pub, 'demo', imports['#src/'].replace('../', '../../'), 'api.mjs')), '#src/는 저장소의 src/를 가리킨다(배포본은 public/src/)');
  });
}

test('데모 페이지의 링크는 /demo/ 안에 머물고, 처음 화면으로만 나간다', () => {
  for (const name of PAGES) assert.doesNotMatch(read('demo', name), /href="\.\/"/, './는 처음 화면(../)으로 바꾼다');
  assert.match(read('demo', 'index.html'), /url=\.\.\//);
});
