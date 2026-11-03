// 화면 스타일의 규칙 중 테스트로 지킬 만한 것.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

// iOS Chrome·Safari의 vh는 도구 막대가 숨은 큰 화면 기준이라, 막대가 보일 때 아래에 붙은 시트가 화면보다 길어져
// 맨 위(제목·닫기)가 주소창 뒤로 밀린다. 그래서 vh로 정한 최대 높이 뒤에는 지금 보이는 높이(dvh) 값을 둔다(옛 브라우저는 vh를 쓴다)
test('style.css: vh로 정한 최대 높이마다 바로 뒤에 같은 dvh 값이 있다', () => {
  const vh = [...css.matchAll(/max-height:\s*([^;]*?\d+vh[^;]*?);/g)];
  assert.ok(vh.length > 0);
  for (const m of vh) {
    const next = css.slice(m.index + m[0].length).match(/^\s*max-height:\s*([^;]*?);/);
    assert.equal(next?.[1], m[1].replace(/(\d+)vh/g, '$1dvh'), `‘max-height: ${m[1]}’ 뒤에 dvh 값이 없어요`);
  }
});

// QR을 보일지는 room.js가 sendMode로 그릴 때 정한다. CSS가 따로 숨기면, 컴퓨터로 보고 QR만 그린 시트에서
// 포인터가 터치로 바뀔 때(iPad에서 키보드를 뗄 때 등) QR까지 숨어 버튼이 하나도 없는 화면이 된다(#25 리뷰)
test('style.css: QR 칸(.qr-desktop)을 CSS로 숨기지 않는다', () => {
  const rules = [...css.matchAll(/\.qr-desktop\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(rules.length > 0);
  for (const body of rules) assert.doesNotMatch(body, /display:\s*none/);
});

// 표준 개인정보 보호지침 제20조①: '개인정보 처리방침'은 글자 크기·색상 등으로 다른 고지사항과 구분해 쉽게 찾게 한다.
// 꼬리말 안내 글은 흐린 색(--label-3, 배경과 대비 1.8:1)이라, 링크가 그 색을 물려받으면 안내 글과 밑줄 하나만 다르다
// 다만 요구는 '구분'이지 '가장 눈에 띄게'가 아니다. 본문색을 65%만 섞어 대비를 밝은 화면 6.7:1·어두운 화면 8.6:1로 두면
// 글자 대비 기준(4.5:1)은 넉넉히 넘고, 흐린 안내 글과는 색·굵기·밑줄로 구분되며, 혼자 가장 밝게 튀지 않는다
test('style.css: 꼬리말의 처리방침 링크는 본문색을 65% 섞은 색에 굵은 글씨와 밑줄이다', () => {
  const link = css.match(/\.foot a\s*\{([^}]*)\}/)?.[1];
  assert.ok(link, '.foot a 규칙이 없어요');
  assert.match(link, /(^|[;\s])color:\s*color-mix\(in srgb, var\(--label\) 65%, var\(--bg\)\)\s*;/);
  assert.ok(Number(link.match(/font-weight:\s*(\d+)/)?.[1]) >= 600, '링크가 굵지 않아요');
  assert.match(link, /text-decoration:\s*underline/);
});
