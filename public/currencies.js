// 외화 방(#55)에서 고를 수 있는 통화. 화면(방 만들기·지출 남기기)과 서버(검증·환율 받기)가 함께 쓴다.
// 환율은 Frankfurter의 유럽중앙은행(ECB) 기준 환율로 받으므로, ECB가 원화 환율을 내는 통화만 둔다.
// decimals: 금액에 쓸 수 있는 소수 자리. 엔은 정수, 나머지는 센트처럼 0.01까지
export const CURRENCIES = [
  { code: 'JPY', label: '일본 엔', unit: '엔', decimals: 0 },
  { code: 'USD', label: '미국 달러', unit: '달러', decimals: 2 },
  { code: 'EUR', label: '유로', unit: '유로', decimals: 2 },
  { code: 'CNY', label: '중국 위안', unit: '위안', decimals: 2 },
  { code: 'HKD', label: '홍콩 달러', unit: '홍콩 달러', decimals: 2 },
  { code: 'SGD', label: '싱가포르 달러', unit: '싱가포르 달러', decimals: 2 },
  { code: 'THB', label: '태국 바트', unit: '바트', decimals: 2 },
  { code: 'PHP', label: '필리핀 페소', unit: '페소', decimals: 2 },
  { code: 'GBP', label: '영국 파운드', unit: '파운드', decimals: 2 },
  { code: 'AUD', label: '호주 달러', unit: '호주 달러', decimals: 2 },
];

export const currencyOf = (code) => CURRENCIES.find((c) => c.code === code) ?? null;
// 원화는 정수, 외화는 그 통화의 소수 자리까지
export const decimalsOf = (code) => currencyOf(code)?.decimals ?? 0;
// 분할 버튼·목록에 쓸 짧은 이름
export const unitOf = (code) => (code === 'KRW' ? '원' : currencyOf(code)?.unit ?? code);

// 해외 카드 이용 수수료(국제 브랜드 + 카드사). '실제 낸 원화' 정책에서 카드 결제를 원화 청구액으로 셈할 때 쓴다.
// 카드마다 1~1.5% 안팎이라 흔한 값 하나로 둔다. 방마다 바꾸는 화면은 아직 없다
export const CARD_FEE = 0.014;
