// 받는 계좌의 은행 선택(#8). 토스 송금 링크에는 실기기에서 확인한 은행 표기만 넣는다.
// 2026-11-02 Android 실기기 결과: '국민은행'·'농협은행'·'기업은행'·'K뱅크'는 토스가 에러를 냈고,
// 짧은 표기(국민·농협·기업·케이뱅크 …)와 정식 이름(KB국민은행·NH농협은행·IBK기업은행 …)은 은행이 채워졌다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BANKS, findBank } from '../public/banks.js';
import { tossSendLink } from '../src/payments/toss.mjs';
import { MemoryStore } from '../src/store/memory.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';

// 실기기에서 토스가 은행을 채워 준 표기(토스에 실제로 보내는 값은 이 안에서만 고른다)
const VERIFIED = ['토스뱅크', '국민', 'KB국민은행', '신한', '신한은행', '우리', '우리은행', '하나', '하나은행', '농협', 'NH농협은행', '기업', 'IBK기업은행',
  '카카오뱅크', '카카오', '케이뱅크', '새마을', '새마을금고', '우체국', 'SC제일', 'SC제일은행', '부산', '부산은행', '대구', 'iM뱅크', '대구은행', '수협', '수협은행', '신협'];
const FAILED = ['국민은행', '농협은행', '기업은행', 'K뱅크'];

test('은행 목록의 토스 표기는 모두 실기기에서 확인한 것이다', () => {
  assert.ok(BANKS.length >= 15);
  for (const b of BANKS) assert.ok(VERIFIED.includes(b.toss), `${b.label} → ${b.toss}`);
});

test('findBank: 흔히 쓰는 다른 표기와 띄어쓰기·대소문자를 같은 은행으로 알아본다', () => {
  assert.equal(findBank('국민은행').label, 'KB국민은행');
  assert.equal(findBank(' kb 국민은행 ').label, 'KB국민은행');
  assert.equal(findBank('농협은행').toss, '농협');
  assert.equal(findBank('K뱅크').toss, '케이뱅크');
  assert.equal(findBank('없는은행'), null);
  assert.equal(findBank(''), null);
});

test('토스 링크에는 토스가 알아듣는 표기를 넣는다(에러 나는 표기는 바꿔 넣는다)', () => {
  for (const name of FAILED) {
    const bank = decodeURIComponent(tossSendLink({ bank: name, accountNo: '1', amount: 1 }).match(/bank=([^&]+)/)[1]);
    assert.ok(VERIFIED.includes(bank), `${name} → ${bank}`);
  }
  assert.match(tossSendLink({ bank: '국민은행', accountNo: '1', amount: 1 }), /bank=%EA%B5%AD%EB%AF%BC&/); // 국민
});

test('목록에 없는 은행은 그대로 넘긴다(토스가 모르면 계좌 복사로 보낸다)', () => {
  assert.match(tossSendLink({ bank: '경남은행', accountNo: '1', amount: 1 }), new RegExp(`bank=${encodeURIComponent('경남은행')}&`));
});

test('받을 계좌를 "국민은행"으로 저장하면 이름은 KB국민은행으로, 열린 송금의 링크는 국민으로 채워진다', async () => {
  const store = new MemoryStore();
  await seedDemoRoom(store, { id: 'r' });
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { ...a.rules, autoAccept: 1_000_000, onDispute: 'ask' }, ...(uid === 'me' ? { payout: null } : {}) });
  }
  const orch = createOrchestrator({ store, clock: () => new Date('2026-11-10T03:00:00Z') });
  await orch.sendInvoices('r', 'me');
  await orch.setPayout('r', 'me', { bank: '국민은행', accountNo: '123-456-789012', holder: '나' });
  assert.equal((await store.get('agents', 'me')).payout.bank, 'KB국민은행');
  const t = (await store.list('transfers', { roomId: 'r' })).find((x) => x.from === 'cs' && x.to === 'me');
  assert.match(t.link, /bank=%EA%B5%AD%EB%AF%BC&accountNo=123456789012&/);
  assert.equal(t.fallback.bank, 'KB국민은행'); // 복사 화면에는 사람이 알아보는 이름
});
