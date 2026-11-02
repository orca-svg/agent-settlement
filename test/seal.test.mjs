// 자물쇠(#8, #10): 계좌 같은 값을 저장소에 넣기 전에 잠그고, 꺼낼 때 푼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, isSealed, resolvePayoutKey } from '../src/security/seal.mjs';

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

test('IV·태그·암호문 어느 부분을 바꿔도 풀리지 않고, 원래 에러를 cause로 남긴다', () => {
  const sealed = seal(PAYOUT, KEY, LABEL);
  for (const at of [0, 12, 28]) { // IV 첫 바이트, 태그 첫 바이트, 암호문 첫 바이트
    const raw = Buffer.from(sealed.slice('enc:v1:'.length), 'base64url');
    raw[at] ^= 1;
    assert.throws(
      () => unseal('enc:v1:' + raw.toString('base64url'), KEY, LABEL),
      (e) => /풀 수 없어요/.test(e.message) && e.cause instanceof Error,
    );
  }
});

test('JSON으로 바꿀 수 없는 값(undefined·함수)은 잠그지 않는다', () => {
  assert.throws(() => seal(undefined, KEY, LABEL), /잠글 수 없는 값/);
  assert.throws(() => seal(() => 1, KEY, LABEL), /잠글 수 없는 값/);
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

test('resolvePayoutKey: 32바이트 base64 열쇠를 그대로 쓴다(앞뒤 공백·줄바꿈 무시)', () => {
  const b64 = Buffer.alloc(32, 9).toString('base64');
  const key = resolvePayoutKey({ PAYOUT_ENC_KEY: ` ${b64}\n`, NODE_ENV: 'production' });
  assert.ok(key.equals(Buffer.alloc(32, 9)));
});

test('resolvePayoutKey: 32바이트가 아니면 어디서든 에러', () => {
  const short = Buffer.alloc(16).toString('base64');
  assert.throws(() => resolvePayoutKey({ PAYOUT_ENC_KEY: short }), /32바이트/);
  assert.throws(() => resolvePayoutKey({ PAYOUT_ENC_KEY: short, NODE_ENV: 'production' }), /32바이트/);
});

test('resolvePayoutKey: 배포(NODE_ENV=production)에서 열쇠가 없으면 에러', () => {
  assert.throws(() => resolvePayoutKey({ NODE_ENV: 'production' }), /PAYOUT_ENC_KEY가 없어요/);
  assert.throws(() => resolvePayoutKey({ NODE_ENV: 'production', PAYOUT_ENC_KEY: '  ' }), /PAYOUT_ENC_KEY가 없어요/);
});

test('resolvePayoutKey: 로컬에서 열쇠가 없으면 개발용 열쇠 + 경고 한 줄', () => {
  const warnings = [];
  const a = resolvePayoutKey({}, { warn: (m) => warnings.push(m) });
  const b = resolvePayoutKey({ NODE_ENV: 'development' }, { warn: (m) => warnings.push(m) });
  assert.equal(a.length, 32);
  assert.ok(a.equals(b));
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /개발용 열쇠/);
  assert.equal(unseal(seal(PAYOUT, a, LABEL), b, LABEL).accountNo, '100000000002');
});
