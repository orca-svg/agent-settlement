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
