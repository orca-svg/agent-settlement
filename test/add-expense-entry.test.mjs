// 지출을 남기는 입구는 '지출 남기기' 하나다. 영수증 사진은 그 시트 맨 위에서 '직접 입력'과 나란히 고른다.
// 다음에 할 일 카드에는 영수증 사진 버튼을 따로 두지 않는다(카드의 주 버튼과 같은 단계의 일이 아니다)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');

test('다음에 할 일 카드에는 영수증 사진 버튼을 따로 두지 않는다', () => {
  assert.doesNotMatch(src, /data-mode="photo"/);
  assert.ok(!src.includes('영수증 사진으로'), '카드에 따로 둔 버튼 이름이 남지 않는다');
});

test('영수증 사진은 지출 남기기 시트 맨 위에서 직접 입력과 나란히 고른다', () => {
  assert.match(src, /seg\('add-mode', 'mode', \[\['manual', '직접 입력'\], \['photo', '영수증 사진'\]\]/);
});

test('AI가 연결돼 있으면 지출 남기기는 영수증 사진 탭으로 열린다(사용자 테스트: "영수증 올리기를 기본으로")', () => {
  assert.match(src, /state\.addMode = state\.aiReady \? 'photo' : 'manual';/);
});
