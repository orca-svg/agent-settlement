// 사용자 테스트(11/5) 과업 3: 방의 '내 비서'에서 '기본 설정 바꾸기'로 내 계정에 갔다가 저장한 뒤 왼쪽 위 뒤로를 눌렀더니
// 방 목록이 나왔다. 참가자는 원래 있던 방(내 비서)으로 돌아갈 줄 알았다. 그래서 방에서 온 길이면 뒤로가 그 방으로 간다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accountHref, backToRoom } from '../public/ui.js';
import { createAgentPanel } from '../public/agent-panel.js';

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8');

test('방에서 내 계정으로 가는 주소에 돌아올 방을 싣는다', () => {
  assert.equal(accountHref('r-1a2b', 'agent', 'agent'), 'account.html?from=r-1a2b&sheet=agent#agent');
  assert.equal(accountHref('r-1a2b', 'profile'), 'account.html?from=r-1a2b#profile');
});

test('내 계정의 뒤로는 온 방(과 내 비서 시트)으로 간다. 이 서비스의 방 주소만 만든다', () => {
  assert.deepEqual(backToRoom('?from=r-1a2b&sheet=agent'), { id: 'r-1a2b', href: 'room.html?room=r-1a2b&sheet=agent' });
  assert.deepEqual(backToRoom('?from=r-1a2b'), { id: 'r-1a2b', href: 'room.html?room=r-1a2b' });
  assert.deepEqual(backToRoom('?from=r-1a2b&sheet=other'), { id: 'r-1a2b', href: 'room.html?room=r-1a2b' }, '모르는 시트는 열지 않는다');
  for (const bad of ['', '?from=', '?from=https://evil.example', '?from=r%2F..%2Fx', `?from=${'a'.repeat(65)}`]) assert.equal(backToRoom(bad), null, bad);
});

test("방의 '내 비서' 시트의 '기본 설정 바꾸기'는 돌아올 방과 시트를 싣는다", async () => {
  const view = { rules: { autoAccept: 50_000, sendWhen: 'now', onDispute: 'ask', notify: 'actions' }, roomRules: {}, memory: [], memoryLimit: 5, memoryHidden: {}, payout: null };
  const panel = createAgentPanel({ api: async () => view, roomId: 'r-1a2b', summary: () => ({ onboarded: true }), meName: () => '나',
    rerender() {}, openSheet() {}, closeSheet() {}, reload: async () => {}, openPayout() {} });
  await panel.open();
  const { html } = panel.sheets.agent();
  assert.match(html, /<a href="account\.html\?from=r-1a2b&amp;sheet=agent#agent">기본 설정 바꾸기<\/a>/);
});

test('방의 내 계정 메뉴도 돌아올 방을 싣고, 방은 sheet=agent로 돌아오면 내 비서를 다시 연다', () => {
  const room = read('room.js');
  assert.match(room, /accountHref\(roomId, 'profile'\)/, "오른쪽 위 메뉴의 '내 계정'");
  assert.match(room, /get\('sheet'\) === 'agent'/, '돌아온 주소의 시트를 읽는다');
  assert.match(room, /agentPanel\.open\(\)/, '내 비서 시트를 다시 연다');
});

test('내 계정의 왼쪽 위 뒤로는 방에서 왔으면 그 방 이름을 달고 그 방으로 간다', () => {
  const account = read('account.js');
  assert.match(account, /backToRoom\(location\.search\)/);
  assert.match(account, /location\.assign\(backRoom\.href\)/, '방 주소로 간다');
  assert.match(account, /<span class="nav-back-label">\$\{esc\(/, '돌아갈 방 이름을 버튼 이름으로 쓴다');
});
