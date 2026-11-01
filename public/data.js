// 데모 시나리오: 넷이 다녀온 오사카 2박 3일. 금액·환율·기록은 모두 가상의 값이다.
// 데모 화면·서버·테스트가 이 파일을 함께 쓴다. 데모에서는 uid가 표시 이름과 같다.
// 실제 방의 uid는 ASCII 문자열(Firebase uid)이며, 개발용 시드가 이 데이터를 그 형태로 바꿔 넣는다.

const PEOPLE = ['나', '철수', '영희', '민수'];

// 환율 단위는 원/100엔. 매매기준율은 날짜별, 현금은 각자 환전한 평균 환율이다.
export const DEMO_ROOM = {
  id: 'demo-osaka',
  name: '오사카 2박 3일',
  dates: '11월 7일 – 9일',
  members: PEOPLE.map((name) => ({ uid: name, name })),
  currency: 'KRW',
  fx: {
    currency: 'JPY',
    base: { '2026-11-07': 912.4, '2026-11-08': 908.15, '2026-11-09': 905.3 },
    settle: { date: '2026-11-10', rate: 903.8 },
    cardFee: 0.014,
    cash: { 철수: 927.6, 영희: 925.9 },
  },
  policy: 'actual',
  policyAgreedBy: PEOPLE,
  agreedAt: '11월 6일',
  version: 1,
  createdBy: '나',
};

export const POLICIES = [
  {
    id: 'actual',
    label: '실제 낸 원화',
    desc: '카드는 청구된 원화, 현금은 그 사람이 환전한 환율로 계산해요. 먼저 낸 사람이 환율 손해를 보지 않아요.',
  },
  {
    id: 'payday',
    label: '결제일 기준율',
    desc: '결제한 날의 매매기준율로 계산해요. 카드 수수료와 환전 차이는 낸 사람이 부담해요.',
  },
  {
    id: 'settle',
    label: '정산일 기준율',
    desc: '정산하는 날의 환율 하나로 모두 계산해요. 가장 단순하지만, 그사이 환율이 움직인 만큼 누군가는 손해를 봐요.',
  },
];

// source: 비서가 이 지출을 어디서 알았는지. 사람이 정산을 올리는 걸 잊어도 비서가 모은다.
export const DEMO_EXPENSES = [
  {
    id: 'hotel', kind: 'stay', title: '난바 호텔 2박', date: '2026-11-07', time: '15:10',
    payer: '나', method: 'card', currency: 'JPY', amount: 64000, present: PEOPLE, source: '카드 승인 알림', split: 'equal',
  },
  {
    id: 'izakaya', kind: 'food', title: '이자카야 저녁', date: '2026-11-07', time: '20:45',
    payer: '철수', method: 'cash', currency: 'JPY', present: PEOPLE, source: '영수증 사진', split: 'items',
    items: [
      { id: 'beer', name: '생맥주', qty: 3, unit: 600, tags: ['술'] },
      { id: 'highball', name: '하이볼', qty: 1, unit: 550, tags: ['술'] },
      { id: 'oolong', name: '우롱차', qty: 1, unit: 350, tags: ['무알코올 음료'] },
      { id: 'yakitori', name: '닭꼬치 모둠', qty: 1, unit: 1600, tags: ['나눠 먹는 안주'] },
      { id: 'karaage', name: '가라아게', qty: 1, unit: 780, tags: ['나눠 먹는 안주'] },
      { id: 'sashimi', name: '모둠 사시미', qty: 1, unit: 2200, tags: ['나눠 먹는 안주', '날생선'] },
      { id: 'ochazuke', name: '오차즈케', qty: 1, unit: 580, tags: ['1인 식사'] },
    ],
  },
  {
    id: 'usj', kind: 'ticket', title: '유니버설 스튜디오 입장권', date: '2026-11-08', time: '09:20',
    payer: '영희', method: 'card', currency: 'JPY', amount: 35600, present: PEOPLE, source: '카드 승인 알림', split: 'equal',
  },
  {
    id: 'lunch', kind: 'food', title: '오코노미야키 점심', date: '2026-11-08', time: '13:30',
    payer: '민수', method: 'card', currency: 'JPY', amount: 5200, present: PEOPLE, source: '카드 승인 알림', split: 'equal',
  },
  {
    // 카드 알림에는 합계만 오므로 처음엔 1/N. 영수증 줄과 주문 시각은 이의 제기 뒤 중재에서 쓴다.
    id: 'bar', kind: 'drink', title: '2차 바', date: '2026-11-08', time: '23:40',
    payer: '나', method: 'card', currency: 'JPY', present: PEOPLE, source: '카드 승인 알림', split: 'equal',
    items: [
      { id: 'b-highball', time: '22:30', name: '하이볼', qty: 3, unit: 700, tags: ['술'] },
      { id: 'b-ginger', time: '22:30', name: '진저에일', qty: 1, unit: 500, tags: ['무알코올 음료'] },
      { id: 'b-nuts', time: '22:30', name: '믹스넛', qty: 1, unit: 600, tags: ['나눠 먹는 안주'] },
      { id: 'b-whisky', time: '23:10', name: '위스키', qty: 2, unit: 1200, tags: ['술'] },
      { id: 'b-cheese', time: '23:10', name: '치즈 플래터', qty: 1, unit: 1800, tags: ['나눠 먹는 안주'] },
    ],
  },
  {
    id: 'snack', kind: 'shop', title: '편의점 아침거리', date: '2026-11-09', time: '08:40',
    payer: '영희', method: 'cash', currency: 'JPY', amount: 2340, present: PEOPLE, source: '영희가 비서에게 한 말', split: 'equal',
  },
  {
    id: 'limo', kind: 'bus', title: '공항 리무진 버스', date: '2026-11-09', time: '10:05',
    payer: '철수', method: 'card', currency: 'JPY', amount: 11200, present: PEOPLE, source: '카드 승인 알림', split: 'equal',
  },
];

// 각자의 비서가 정산에 쓰라고 공유한 기억. 무료 요금제는 사람당 5개까지.
export const MEMORY_LIMIT = 5;
export const DEMO_MEMORY = {
  나: ['맥주를 좋아해요'],
  철수: ['술자리에서 하이볼을 자주 시켜요'],
  영희: ['술을 마시지 않아요'],
  민수: ['날생선을 먹지 않아요'],
};

// 각자 비서에게 맡긴 규칙. 한도를 넘거나 규칙에 없는 일은 주인에게 묻는다.
export const DEMO_RULES = {
  나: { autoAccept: 50000, sendWhen: '바로', onDispute: '중재 비서에게 맡기기' },
  철수: { autoAccept: 150000, sendWhen: '25일 월급날', onDispute: '나에게 묻기' },
  영희: { autoAccept: 50000, sendWhen: '바로', onDispute: '나에게 묻기' },
  민수: { autoAccept: 50000, sendWhen: '바로', onDispute: '근거가 있으면 이의 제기' },
};

export const DEMO_DISPUTE = {
  expense: 'bar',
  by: '민수',
  leftAt: '22:55',
  claim: '민수는 22:55에 먼저 숙소로 돌아갔어요. 그 뒤에 시킨 것까지 4명이 똑같이 나누는 건 맞지 않아요.',
  evidence: ['22:55 단톡방 메시지 “먼저 들어갈게”', '23:08 위치 기록 요약: 난바 호텔'],
  counter: ['22:30 첫 주문 때는 4명이 함께 있었어요', '결제는 23:40에 한 번에 했어요'],
};
