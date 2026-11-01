// 데스크톱 QR이 계좌·금액을 외부 이미지 서비스로 그대로 보내지 않도록, 우리 서버로 돌아오는 서명된 토큰을 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signQrToken, verifyQrToken } from '../src/payments/qr.mjs';

test('서명한 토큰을 그대로 검증하면 원래 링크가 나온다', () => {
  const token = signQrToken('supertoss://send?bank=토스뱅크&accountNo=1&amount=1');
  assert.equal(verifyQrToken(token), 'supertoss://send?bank=토스뱅크&accountNo=1&amount=1');
});

test('유효기간이 지나면 null', () => {
  let t = 0;
  const now = () => t;
  const token = signQrToken('supertoss://send?x=1', { now });
  t = 16 * 60_000;
  assert.equal(verifyQrToken(token, { now }), null);
});

test('토큰을 건드리면 null (서명 위조 방지)', () => {
  const token = signQrToken('supertoss://send?x=1');
  const [body, sig] = token.split('.');
  assert.equal(verifyQrToken(`${body}x.${sig}`), null);
  assert.equal(verifyQrToken(`${body}.${sig}x`), null);
});

test('형식이 아닌 값은 null', () => {
  assert.equal(verifyQrToken(''), null);
  assert.equal(verifyQrToken(null), null);
  assert.equal(verifyQrToken('그냥문자열'), null);
});
