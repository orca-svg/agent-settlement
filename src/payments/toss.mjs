// 토스 송금 화면을 여는 링크. 우리 서비스는 돈을 옮기지 않고, 받는 사람·금액이 채워진 송금 화면만 연다.
// 앱 스킴 supertoss는 토스 공식 자료로 확인했다. send 경로와 파라미터 이름(bank·accountNo·amount)은
// 공식 문서는 없지만 실기기에서 검증함(2026-11-02, #8): QR로 열었을 때 계좌번호·금액이 그대로 채워졌다.
// 혹시 다른 기기·토스 버전에서 안 채워지면 이 파일만 고친다. 끝내 안 되면 'supertoss://'(앱만 열기) + 계좌·금액 복사로 낮춘다.
// 은행 이름은 토스가 아는 표기만 받는다(모르는 이름이면 토스가 에러를 낸다). 그래서 public/banks.js의 실기기 확인 표기로 바꿔 넣는다.
import { findBank } from '../../public/banks.js';

export const SEND_PATH = 'send';

const digits = (s) => String(s ?? '').replace(/\D/g, '');

export function tossSendLink({ bank, accountNo, amount }) {
  const name = findBank(bank)?.toss ?? bank; // 목록에 없는 은행은 그대로. 토스가 모르면 화면이 계좌 복사로 안내한다
  return `supertoss://${SEND_PATH}?bank=${encodeURIComponent(name)}&accountNo=${digits(accountNo)}&amount=${Math.round(amount)}&origin=linkgen`;
}

// 앱이 안 열리거나 데스크톱일 때 복사해 주는 값
export function payoutFallback(payout, amount) {
  if (!payout?.bank || !digits(payout.accountNo)) return null;
  return { bank: payout.bank, accountNo: digits(payout.accountNo), amount: Math.round(amount) };
}
