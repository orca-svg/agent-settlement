// 토스 송금 화면 링크. 앱 스킴 supertoss는 확인됐고, send 경로·파라미터는 실기기 검증 전이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tossSendLink, payoutFallback } from '../src/payments/toss.mjs';

test('은행 이름은 URL 인코딩, 계좌는 숫자만, 금액은 정수', () => {
  assert.equal(
    tossSendLink({ bank: '토스뱅크', accountNo: '1000-1234-5678', amount: 245446 }),
    'supertoss://send?bank=%ED%86%A0%EC%8A%A4%EB%B1%85%ED%81%AC&accountNo=100012345678&amount=245446&origin=linkgen',
  );
});

test('payoutFallback: 받는 정보가 없으면 null, 있으면 계좌는 숫자만', () => {
  assert.equal(payoutFallback(null, 1000), null);
  assert.equal(payoutFallback({ bank: '', accountNo: '' }, 1000), null);
  assert.deepEqual(payoutFallback({ bank: '토스뱅크', accountNo: '1000-1234-5678', holder: '나' }, 245446.4), { bank: '토스뱅크', accountNo: '100012345678', amount: 245446 });
});
