// 토스 송금 화면을 여는 링크. 우리 서비스는 돈을 옮기지 않고, 받는 사람·금액이 채워진 송금 화면만 연다.
// 앱 스킴 supertoss는 토스 공식 자료로 확인했다. 반면 send 경로와 파라미터 이름은 공식 문서가 없어 실기기 검증 전이다.
// 검증 결과에 따라 이 파일만 고친다(#8). 끝내 채워지지 않으면 'supertoss://'(앱만 열기) + 계좌·금액 복사로 낮춘다.
export const SEND_PATH = 'send';

const digits = (s) => String(s ?? '').replace(/\D/g, '');

export function tossSendLink({ bank, accountNo, amount }) {
  return `supertoss://${SEND_PATH}?bank=${encodeURIComponent(bank)}&accountNo=${digits(accountNo)}&amount=${Math.round(amount)}&origin=linkgen`;
}

// 앱이 안 열리거나 데스크톱일 때 복사해 주는 값
export function payoutFallback(payout, amount) {
  if (!payout?.bank || !digits(payout.accountNo)) return null;
  return { bank: payout.bank, accountNo: digits(payout.accountNo), amount: Math.round(amount) };
}
