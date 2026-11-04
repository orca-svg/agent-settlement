// 서비스를 완성된 단계로 소개한다: 사람이 보는 화면·문서에 '개발 중'·'프로토타입'·'초안' 같은 상태 문구를 두지 않는다.
// 다만 처리방침은 법률 전문가의 검토를 받지 않았다는 사실은 그대로 밝힌다
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const STATUS = /개발 중|프로토타입|초안/;

for (const page of ['index.html', 'account.html', 'room.html', 'demo/account.html', 'demo/room.html']) {
  test(`public/${page}에는 '개발 중'·'프로토타입'·'초안' 같은 상태 문구가 없다`, () => {
    assert.doesNotMatch(read('public', page), STATUS);
  });
}

test('방 화면 꼬리말은 다른 화면처럼 대회·팀과 처리방침만 둔다', () => {
  const foot = (page) => /<footer class="foot">([\s\S]*?)<\/footer>/.exec(read('public', page))[1].trim();
  assert.equal(foot('room.html'), foot('account.html'));
});

test('README에는 상태 문구가 없다', () => {
  assert.doesNotMatch(read('README.md'), /개발 중|프로토타입/);
});

test("처리방침은 '초안'이라 부르지 않고, 법률 검토를 받지 않았다는 사실만 밝힌다", () => {
  const privacy = read('PRIVACY.md');
  assert.equal(privacy.split('\n')[0], '# 개인정보 처리방침');
  assert.doesNotMatch(privacy, /초안|프로토타입/);
  assert.match(privacy, /법률 전문가의 검토를 받지 않았습니다/);
});
