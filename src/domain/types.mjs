// 도메인 계약. 서버·화면·테스트, 그리고 팀원이 만드는 모듈(#2 로그인, #3 Firestore, #4 방, #5 비서 설정, #7 위치, #8 송금)이
// 모두 이 모양을 따른다. 바꿀 때는 ARCHITECTURE.md와 함께 고친다.

/** 영수증 줄의 태그. 메뉴 배분 규칙과 Gemini 스키마가 이 목록만 쓴다. */
export const TAGS = ['술', '무알코올 음료', '나눠 먹는 안주', '날생선', '1인 식사', '기타'];

/** Store의 컬렉션 이름. Firestore 경로는 ARCHITECTURE.md의 표를 따른다. */
export const COLLECTIONS = ['rooms', 'expenses', 'agents', 'invoices', 'disputes', 'transfers', 'invites'];

/** 사람이 처리해야 하는 일. 비서 기록(AgentEvent)의 action.type으로 쓴다. */
export const ACTION_TYPES = ['confirm_line', 'answer_invoice', 'agree_dispute', 'approve_transfer', 'confirm_receipt', 'set_payout'];

/**
 * uid는 ASCII 문자열이다(#2 이후에는 Firebase uid). 표시 이름은 Member.name으로만 보여 준다.
 * @typedef {{ uid: string, name: string }} Member
 */

/**
 * 환율 단위는 원/100(외화 100단위당 원). base는 결제일별 매매기준율, cash는 사람별 환전 평균 환율.
 * @typedef {{
 *   currency: string,
 *   base: Record<string, number>,
 *   settle: { date: string, rate: number },
 *   cardFee: number,
 *   cash: Record<string, number>,
 * }} Fx
 */

/**
 * @typedef {{
 *   id: string, name: string, dates?: string, members: Member[],
 *   currency: 'KRW', fx: Fx | null,
 *   policy: 'actual'|'payday'|'settle', policyAgreedBy: string[],
 *   status?: 'ready'|'settling', version: number, createdBy: string,
 * }} Room
 * policyAgreedBy: 지금 policy에 동의한 uid. 정책을 바꾸면 바꾼 사람만 남는다. 전원이 있어야 청구서를 보낼 수 있다(#4).
 * status: 청구서를 처음 보내면 'settling'. 그 뒤로는 초대·참가·정책 변경을 막는다. 없으면 'ready'로 본다.
 */

/**
 * 초대 링크(#4). 방마다 하나(id = roomId)이고, 다시 만들면 덮어써서 이전 토큰은 무효가 된다. 서버만 읽고 쓴다.
 * @typedef {{ id: string, roomId: string, token: string, expiresAt: string, createdBy: string }} Invite
 */

/** @typedef {{ id: string, name: string, qty: number, unit: number, time?: string, tags: string[] }} Item */

/** @typedef {{ consumers: string[], confidence: number, reason: string, confirmed?: boolean }} LineAlloc */

/**
 * 금액은 정수. 날짜는 'YYYY-MM-DD', 시각은 'HH:MM'. items가 있으면 amount 대신 줄 합을 쓴다.
 * @typedef {{
 *   id: string, roomId: string, title: string, kind: string, date: string, time: string,
 *   payer: string, method: 'card'|'cash', currency: string, amount?: number, items?: Item[],
 *   split: 'equal'|'items', present: string[], alloc?: Record<string, LineAlloc>,
 *   source: 'manual'|'receipt', createdBy: string,
 * }} Expense
 */

/**
 * 비서 설정. #5가 화면과 저장을, #8이 payout 화면을 만든다.
 * @typedef {{
 *   uid: string, memory: string[],
 *   rules: { autoAccept: number, sendWhen: 'now' | { payday: number }, onDispute: 'ask'|'evidence'|'mediator' },
 *   payout: { bank: string, accountNo: string, holder: string } | null,
 * }} AgentSettings
 */

/**
 * @typedef {{
 *   id: string, roomId: string, version: number, to: string, owed: number, paid: number, net: number,
 *   status: 'pending'|'accepted'|'asked'|'disputed'|'superseded',
 *   decidedBy: 'agent'|'human'|null, reasons: string[],
 * }} Invoice
 */

/** #7이 위치 요약 등으로 만든다. 원본 위치는 넣지 않는다. @typedef {{ kind: 'left_at'|'not_present'|'text', time?: string, summary: string }} Evidence */

/**
 * @typedef {{
 *   id: string, roomId: string, expenseId: string, by: string, claim: string, evidence: Evidence[],
 *   status: 'open'|'proposed'|'resolved',
 *   proposal?: { summary: string, alloc: Record<string, LineAlloc>, source: string },
 *   agreedBy: string[],
 * }} Dispute
 */

/**
 * 우리 서비스는 돈을 옮기지 않는다. link는 금액이 채워진 송금 앱 링크, fallback은 계좌·금액 복사용.
 * @typedef {{
 *   id: string, roomId: string, version: number, from: string, to: string, amount: number,
 *   status: 'scheduled'|'due'|'opened'|'sent'|'confirmed'|'superseded',
 *   remindAt: string | null, link: string | null,
 *   fallback: { bank: string, accountNo: string, amount: number } | null,
 * }} Transfer
 */

/**
 * 비서 기록. 서버만 쓴다. action이 있으면 action.for인 사람이 처리해야 할 일이다.
 * @typedef {{
 *   seq: number, roomId: string, at: string, from: string, to: string, kind: string, text: string,
 *   meta?: string, action?: { type: string, ref: string, for: string },
 * }} AgentEvent
 */

export {};
