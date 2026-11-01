// 데스크톱 QR이 계좌·금액을 외부 이미지 서비스로 그대로 보내지 않도록, 추측할 수 없는 토큰만 담고
// 실제 링크는 서버 메모리에 토큰→링크로만 둔다(토큰 자체엔 링크를 담지 않는다. 담으면 base64만 풀어도 계좌가 보인다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signQrToken, verifyQrToken } from '../src/payments/qr.mjs';

test('토큰을 발급하면 그 토큰으로 원래 링크가 나온다', () => {
  const token = signQrToken('supertoss://send?bank=토스뱅크&accountNo=1&amount=1');
  assert.equal(verifyQrToken(token), 'supertoss://send?bank=토스뱅크&accountNo=1&amount=1');
});

test('토큰 자체에 링크가 들어있지 않다(디코딩해도 계좌가 안 보여야 한다)', () => {
  const token = signQrToken('supertoss://send?bank=토스뱅크&accountNo=1&amount=1');
  assert.ok(!token.includes('accountNo'));
  assert.doesNotMatch(Buffer.from(token, 'base64url').toString('utf8'), /accountNo|토스뱅크/);
});

test('유효기간이 지나면 null', () => {
  let t = 0;
  const now = () => t;
  const token = signQrToken('supertoss://send?x=1', { now });
  t = 16 * 60_000;
  assert.equal(verifyQrToken(token, { now }), null);
});

test('다른 토큰(추측)은 null', () => {
  const token = signQrToken('supertoss://send?x=1');
  assert.equal(verifyQrToken(`${token}x`), null);
  assert.equal(verifyQrToken(token.slice(1)), null);
});

test('형식이 아닌 값은 null', () => {
  assert.equal(verifyQrToken(''), null);
  assert.equal(verifyQrToken(null), null);
  assert.equal(verifyQrToken('그냥문자열'), null);
});
