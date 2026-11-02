// 자물쇠(#8, #10): 계좌 같은 값을 저장소에 넣기 전에 잠그고, 꺼낼 때 푼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, isSealed } from '../src/security/seal.mjs';

const KEY = Buffer.alloc(32, 1);
const OTHER = Buffer.alloc(32, 2);
const PAYOUT = { bank: '토스뱅크', accountNo: '100000000002', holder: '철수' };
const LABEL = 'agents/cs/payout';

test('잠갔다 풀면 원래 값(객체·문자열)', () => {
  assert.deepEqual(unseal(seal(PAYOUT, KEY, LABEL), KEY, LABEL), PAYOUT);
  const link = 'supertoss://send?bank=x&accountNo=100000000002&amount=1000&origin=linkgen';
  assert.equal(unseal(seal(link, KEY, 'transfers/t1/link'), KEY, 'transfers/t1/link'), link);
});

test('잠긴 값은 enc:v1:로 시작하고 계좌번호가 보이지 않는다', () => {
  const sealed = seal(PAYOUT, KEY, LABEL);
  assert.ok(sealed.startsWith('enc:v1:'));
  assert.ok(isSealed(sealed));
  assert.ok(!sealed.includes('100000000002'));
  assert.equal(isSealed(PAYOUT), false);
  assert.equal(isSealed('supertoss://send'), false);
  assert.equal(isSealed(null), false);
});

test('같은 값을 두 번 잠그면 결과가 다르다(무작위 IV)', () => {
  assert.notEqual(seal(PAYOUT, KEY, LABEL), seal(PAYOUT, KEY, LABEL));
});

test('한 바이트만 바꿔도 풀리지 않는다', () => {
  const sealed = seal(PAYOUT, KEY, LABEL);
  const raw = Buffer.from(sealed.slice('enc:v1:'.length), 'base64url');
  raw[raw.length - 1] ^= 1;
  assert.throws(() => unseal('enc:v1:' + raw.toString('base64url'), KEY, LABEL), /풀 수 없어요/);
});

test('이름표(label)가 다르면 풀리지 않는다: 다른 문서로 옮겨 붙이기 방지', () => {
  const sealed = seal(PAYOUT, KEY, 'agents/ms/payout');
  assert.throws(() => unseal(sealed, KEY, LABEL), /풀 수 없어요/);
});

test('다른 열쇠로는 풀리지 않는다', () => {
  assert.throws(() => unseal(seal(PAYOUT, KEY, LABEL), OTHER, LABEL), /풀 수 없어요/);
});

test('잠기지 않은 값이나 너무 짧은 값은 거부한다', () => {
  assert.throws(() => unseal(PAYOUT, KEY, LABEL), /잠기지 않은 값/);
  assert.throws(() => unseal('supertoss://send', KEY, LABEL), /잠기지 않은 값/);
  assert.throws(() => unseal('enc:v1:AAAA', KEY, LABEL), /망가졌어요/);
});
