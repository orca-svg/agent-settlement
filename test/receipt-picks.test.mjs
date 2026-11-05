// 체험 데모의 영수증 사진 카드(11/5 확인): 샘플 영수증 버튼이 찍기·앨범에서 고르기와 한 줄에 있으면
// 앞의 두 버튼이 좁아져 글자가 세로로 꺾였다. 그래서 샘플은 위 한 줄을 다 쓰고, 찍기·앨범에서 고르기는 그 아래 한 줄을 나눠 쓴다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('영수증 사진 카드: 샘플 영수증은 위 한 줄, 찍기·앨범에서 고르기는 그 아래 한 줄', () => {
  const src = read('room.js');
  const card = src.slice(src.indexOf("const touch = matchMedia('(pointer: coarse)')"), src.indexOf("const touch = matchMedia('(pointer: coarse)')") + 1200);
  assert.match(card, /<div class="receipt-picks">\$\{sample\}<div class="actions">\$\{receiptPickers\(touch\)\}<\/div><\/div>/);
  assert.match(card, /const sample = authOptions\(\)\.demo \? `<div class="actions"><button type="button" class="btn plain"[^`]*data-action="receipt-sample">샘플 영수증으로 해 보기<\/button><\/div>` : ''/, '샘플은 체험 데모에서만');
  assert.match(read('style.css'), /\.receipt-picks \{ display: grid; gap: 8px; \}/, '두 줄 사이도 버튼 사이와 같은 간격(한 묶음)');
});
