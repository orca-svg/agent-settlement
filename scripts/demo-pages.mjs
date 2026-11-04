// 체험 데모 페이지(public/demo/room.html·account.html)를 실제 페이지에서 만든다. 화면은 실제와 같은 room.js·account.js를 쓰고,
// 데모에서만 붙는 것은 이것뿐이다: 위쪽 띠, demo.css, import map(서버 코드를 브라우저에서 부르기), 그리고 실제 코드보다 먼저 도는 boot.js.
// /demo/ 아래에 두어서 화면 안의 상대 링크(account.html, room.html?room=…)가 데모 안에 머문다.
// 사용: node scripts/demo-pages.mjs  (실제 페이지를 고치면 다시 돌린다. test/demo-pages.test.mjs가 최신인지 확인한다)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const PAGES = ['room.html', 'account.html'];

// 서버 코드(src/)가 브라우저에서 돌도록: node:crypto는 대신할 파일로, src/는 배포본의 /src/로, src/가 부르는 ../public/은 화면 파일로 잇는다
const IMPORT_MAP = JSON.stringify({ imports: { 'node:crypto': './node-crypto.js', '#src/': '../src/', '../public/': '../' } });
const BAND = '<div class="demo-band" role="note"><b>체험 데모</b>금액·환율·계좌·위치는 모두 가짜이고, 돈은 움직이지 않아요.<a href="../">처음 화면</a></div>';

const swap = (html, from, to) => {
  if (!html.includes(from)) throw new Error(`demo-pages: '${from}'을 찾지 못했어요. 실제 페이지가 바뀌었으면 이 스크립트도 고쳐 주세요`);
  return html.replace(from, to);
};

export function demoPage(name, html) {
  let out = html;
  out = swap(out, '<!doctype html>', `<!doctype html>\n<!-- scripts/demo-pages.mjs가 public/${name}에서 만든 체험 데모 페이지예요. 직접 고치지 말고 다시 만들어 주세요 -->`);
  out = out.replace(/<title>([^<]*)<\/title>/, '<title>체험 데모 · $1</title>');
  out = swap(out, '<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="../style.css">\n  <link rel="stylesheet" href="demo.css">');
  // 파비콘·홈 화면 아이콘은 실제 페이지 옆(public/)에 있다
  out = out.replace(/(<link rel="(?:icon|apple-touch-icon)"[^>]*\bhref=")(?![a-z]+:|\/|\.\.\/)/g, '$1../');
  out = out.replace(/<body( class="([^"]*)")?>/, (_, __, cls) => `<body class="${cls ? `${cls} ` : ''}demo">\n  ${BAND}`);
  const entry = name.replace('.html', '.js');
  out = swap(out, `<script type="module" src="${entry}"></script>`,
    `<script type="importmap">${IMPORT_MAP}</script>\n  <script type="module" src="boot.js"></script>\n  <script type="module" src="../${entry}"></script>`);
  // 처음 화면(데모 소개)으로 가는 링크
  out = out.replace('<a class="nav-btn" href="./">데모 보기</a>', '<a class="nav-btn" href="../">처음 화면</a>');
  out = out.replace('<a class="nav-brand" href="./">', '<a class="nav-brand" href="../">');
  out = out.replace('<p>개발 중인 실제 방 화면이에요.</p>', '<p>체험 데모예요. 금액·환율·계좌·위치는 모두 가짜이고, 돈은 움직이지 않아요.</p>');
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const name of PAGES) {
    fs.writeFileSync(path.join(root, 'demo', name), demoPage(name, fs.readFileSync(path.join(root, name), 'utf8')));
    console.log(`public/demo/${name}`);
  }
}
