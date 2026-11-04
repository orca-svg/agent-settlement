// #62 중재안 고치기: 방 화면의 이의 시트가 줄별 사람 칩(proposalLinesHtml)과 고친 뒤 버튼(reviseChoicesHtml)을 쓰고,
// 보고 있던 중재안의 판(rev)을 서버에 함께 보내 그사이 바뀐 안에 동의·고치기가 걸리지 않게 하는지 본다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');
const sheet = src.match(/function disputeSheet\(\) \{[\s\S]*?\n\}/)?.[0] ?? '';

test('이의 시트는 줄마다 사람 칩을 그리고, 고친 뒤에는 제안·되돌리기 버튼을 쓴다', () => {
  assert.ok(sheet, '이의 시트를 찾는다');
  assert.match(sheet, /proposalLinesHtml\(/);
  assert.match(src, /reviseChoicesHtml\(/);
});

test('칩 누르기·되돌리기·제안하기가 비서 동작으로 등록돼 있다', () => {
  const actions = src.match(/const AGENT_ACTIONS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
  for (const name of ['revise-pick', 'revise-reset', 'revise-send']) assert.ok(actions.includes(`'${name}'`), name);
});

test('제안하기는 줄별 사람과 보고 있던 판을 revise로, 동의도 그 판을 함께 보낸다', () => {
  assert.match(src, /post\(`\/disputes\/\$\{enc\(d\.id\)\}\/revise`, \{ alloc[^}]*rev[^}]*\}\)/);
  assert.match(src, /post\(`\/disputes\/\$\{enc\(d\.id\)\}\/agree`, \{ rev[^}]*\}\)/);
});
