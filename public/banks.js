// 받는 계좌의 은행 목록(#8). 화면(계좌 등록의 선택 목록)과 서버(토스 송금 링크)가 함께 쓴다.
// label: 화면에 보여 주고 저장하는 이름. toss: 토스 송금 링크(supertoss://send?bank=…)에 넣는 이름.
// toss는 2026-11-02 Android 실기기에서 토스가 은행을 채워 준 표기만 쓴다(test/banks.test.mjs에 결과 기록).
// '국민은행'·'농협은행'·'기업은행'·'K뱅크'처럼 흔히 쓰지만 토스가 에러를 내는 표기는 aliases로 받아 toss 표기로 바꾼다.
export const BANKS = [
  { label: '토스뱅크', toss: '토스뱅크', aliases: ['토스'] },
  { label: 'KB국민은행', toss: '국민', aliases: ['국민은행', 'KB국민', 'KB'] },
  { label: '신한은행', toss: '신한', aliases: [] },
  { label: '우리은행', toss: '우리', aliases: [] },
  { label: '하나은행', toss: '하나', aliases: ['KEB하나은행'] },
  { label: 'NH농협은행', toss: '농협', aliases: ['농협은행', 'NH농협', 'NH'] },
  { label: 'IBK기업은행', toss: '기업', aliases: ['기업은행', 'IBK기업', 'IBK'] },
  { label: '카카오뱅크', toss: '카카오뱅크', aliases: ['카카오'] },
  { label: '케이뱅크', toss: '케이뱅크', aliases: ['K뱅크', '케이'] },
  { label: '새마을금고', toss: '새마을', aliases: ['MG새마을금고'] },
  { label: '우체국', toss: '우체국', aliases: [] },
  { label: 'SC제일은행', toss: 'SC제일', aliases: ['제일은행'] },
  { label: '부산은행', toss: '부산', aliases: ['BNK부산은행'] },
  { label: 'iM뱅크(대구)', toss: '대구', aliases: ['iM뱅크', '대구은행', 'DGB대구은행'] },
  { label: '수협은행', toss: '수협', aliases: [] },
  { label: '신협', toss: '신협', aliases: [] },
];

const norm = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase();

// 사용자가 쓴 은행 이름을 목록의 은행으로 알아본다(띄어쓰기·대소문자 무시). 모르면 null
export function findBank(name) {
  const n = norm(name);
  if (!n) return null;
  return BANKS.find((b) => [b.label, b.toss, ...b.aliases].some((x) => norm(x) === n)) ?? null;
}
