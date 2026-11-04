// 배포할 때 화면 파일 주소에 같은 버전(커밋)을 붙인다. GitHub Pages는 모든 파일을 10분 캐시하고 헤더를 바꿀 수 없어서,
// 버전이 없으면 배포 직후 새 room.js가 캐시에 남은 옛 ui.js를 불러 화면이 비는 일이 생긴다(없는 export를 가져오면 모듈 전체가 멈춘다).
// 버전을 붙이면 한 번의 배포 안에서는 같은 버전의 파일끼리만 불린다.
// 사용: node scripts/stamp-version.mjs <폴더> <버전>  (.github/workflows/pages.yml이 배포본에만 한다. 저장소 원본은 그대로)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// './x.js'·'../x.js'로 시작하는 import·export·동적 import만. 바깥 주소와 이미 ?가 붙은 주소는 건드리지 않는다
const JS_SPEC = /(\b(?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?#\s]+?\.m?js)\2/g;
const HTML_SCRIPT = /(<script\b[^>]*\bsrc=)(["'])([^"'?#:]+?\.m?js)\2/g;
const HTML_CSS = /(<link\b[^>]*\bhref=)(["'])([^"'?#:]+?\.css)\2/g;
const tag = (v) => (_, pre, q, spec) => `${pre}${q}${spec}?v=${v}${q}`;

export const stampJs = (src, v) => src.replace(JS_SPEC, tag(v));
export const stampHtml = (html, v) => html.replace(HTML_SCRIPT, tag(v)).replace(HTML_CSS, tag(v));

// 폴더 바로 아래의 .js·.html을 고쳐 쓰고, 바뀐 파일 이름을 돌려준다
export function stampDir(dir, v) {
  const changed = [];
  for (const name of fs.readdirSync(dir)) {
    const stamp = name.endsWith('.js') ? stampJs : name.endsWith('.html') ? stampHtml : null;
    if (!stamp) continue;
    const file = path.join(dir, name);
    const before = fs.readFileSync(file, 'utf8');
    const after = stamp(before, v);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed.push(name);
    }
  }
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, v] = process.argv.slice(2);
  if (!dir || !/^[\w.-]+$/.test(v ?? '')) {
    console.error('사용: node scripts/stamp-version.mjs <폴더> <버전>');
    process.exit(1);
  }
  console.log(`버전 ${v}를 붙였어요: ${stampDir(dir, v).join(', ')}`);
}
