// 내 계정의 웹 설정 배치(public/settings-layout.js): 한 페이지에 모든 설정을 두고, 넓은 화면은 왼쪽에 따라오는 목차를 둔다.
// 목차의 링크는 주소의 #으로 가므로 공유·뒤로가기가 되고, 방의 '기본 설정 바꾸기'(#agent)도 같은 길로 온다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_TOC, SETTINGS_IDS, tocHtml, settingRow, settingsSection } from '../public/settings-layout.js';

test('목차: 프로필 → 내 비서 기본 설정(받을 계좌·비서 규칙·알림) → 계정 순서로, 각 링크가 그 칸의 #으로 간다', () => {
  assert.deepEqual(SETTINGS_IDS, ['profile', 'agent', 'payout', 'rules', 'notify', 'account']);
  const html = tocHtml();
  const hrefs = [...html.matchAll(/href="#([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, SETTINGS_IDS);
  assert.match(html, /<nav class="settings-toc" aria-label="[^"]+">/);
  assert.equal(SETTINGS_TOC.find((s) => s.id === 'agent').children.length, 3, '비서 기본 설정 아래 세 칸은 들여 쓴 목록');
});

test('설정 한 줄: 이름은 입력칸의 label이 되고, 설명은 이름 바로 아래에 둔다', () => {
  const html = settingRow({ label: '표시 이름', desc: '방 사람들에게 보여요.', forId: 'profile-name', control: '<input id="profile-name">' });
  assert.match(html, /<label class="set-name" for="profile-name">표시 이름<\/label><p class="set-desc">방 사람들에게 보여요\.<\/p>/);
  assert.match(html, /<div class="set-control"><input id="profile-name"><\/div>/);
  assert.doesNotMatch(settingRow({ label: '알림 수준', control: '' }), /<label/, '입력칸이 없으면 label로 묶지 않는다');
});

test('설정 묶음: 목차가 가리키는 id와 제목이 이어져 있다(aria-labelledby)', () => {
  const html = settingsSection({ id: 'payout', title: '받을 계좌', desc: '설명', body: '<div>칸</div>' });
  assert.match(html, /<section class="set-section" id="payout" aria-labelledby="payout-title"><h3 class="set-title" id="payout-title">받을 계좌<\/h3>/);
  assert.match(settingsSection({ id: 'profile', title: '프로필', body: '', level: 2 }), /<h2 class="set-title"/);
});

// 목차는 document.getElementById로 칸의 자리를 읽는다. 페이지 뼈대(account.html)에 같은 id가 있으면 그쪽을 읽어 엉뚱한 칸을 짚는다
test('목차의 id는 account.html 뼈대의 id와 겹치지 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/account.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(!SETTINGS_IDS.includes(id), `account.html의 id="${id}"가 목차 칸과 겹쳐요`);
});

// 할 일 줄(로그아웃·탈퇴): 왼쪽에 무엇인지, 오른쪽 끝에 버튼 하나. 버튼은 줄 가운데 높이에 맞춘다(CSS .set-action)
test('할 일 줄은 따로 표시하고, 되돌릴 수 없는 일은 떨어진 카드에 둔다', () => {
  assert.match(settingRow({ label: '준엽', control: '<button>로그아웃</button>', action: true }), /^<div class="set-row set-action">/);
  assert.match(settingRow({ label: '준엽', control: '' }), /^<div class="set-row">/);
  const html = settingsSection({ id: 'account', title: '계정', level: 2, body: ['<p>로그아웃</p>', '<p>탈퇴</p>'] });
  assert.equal([...html.matchAll(/<div class="set-card">/g)].length, 2, '카드 둘');
  assert.match(html, /<div class="set-card"><p>로그아웃<\/p><\/div><div class="set-card"><p>탈퇴<\/p><\/div>/);
});
