// 도메인 계약. 서버·화면·테스트, 그리고 팀원이 만드는 모듈(#2 로그인, #3 Firestore, #4 방, #5 비서 설정, #7 위치, #8 송금)이
// 모두 이 모양을 따른다. 바꿀 때는 ARCHITECTURE.md와 함께 고친다.

/** 영수증 줄의 태그. 메뉴 배분 규칙과 Gemini 스키마가 이 목록만 쓴다. */
export const TAGS = ['술', '무알코올 음료', '나눠 먹는 안주', '날생선', '1인 식사', '기타'];

/** Store의 컬렉션 이름. Firestore 경로는 ARCHITECTURE.md의 표를 따른다. */
export const COLLECTIONS = ['rooms', 'expenses', 'agents', 'invoices', 'disputes', 'transfers', 'receipts', 'users', 'deletedUsers', 'locationConsents', 'locationEvidence', 'invites'];

/** 사람이 처리해야 하는 일. 비서 기록(AgentEvent)의 action.type으로 쓴다. */
export const ACTION_TYPES = ['confirm_line', 'answer_invoice', 'agree_dispute', 'approve_transfer', 'confirm_receipt', 'set_payout'];

/**
 * uid는 ASCII 문자열이다(#2 이후에는 Firebase uid). 표시 이름은 Member.name으로만 보여 준다.
 * deleted는 탈퇴한 사람(uid가 익명으로 바뀐다), left는 방에서 나가거나 내보내진 사람이다(#55). 둘 다 방을 읽지 못하고 기록에만 남는다.
 * 지금 방에 있는 사람은 public/core.js의 active로 고른다.
 * @typedef {{ uid: string, name: string, color?: string, deleted?: boolean, left?: boolean }} Member
 */

/**
 * 환율 단위는 원/100(외화 100단위당 원). base는 결제일별 매매기준율, cash는 사람별 환전 평균 환율.
 * 실제 외화 방(#55)은 base를 지출을 남길 때, settle을 청구서를 처음 보낼 때 유럽중앙은행 기준 환율로 채운다(src/rooms/fx.mjs).
 * settle은 그 전까지 null이고, cash가 없는 사람의 현금 결제는 결제일 기준율로 셈한다.
 * @typedef {{
 *   currency: string,
 *   base: Record<string, number>,
 *   settle: { date: string, rate: number } | null,
 *   cardFee: number,
 *   cash: Record<string, number>,
 * }} Fx
 */

/**
 * @typedef {{
 *   id: string, name: string, dates?: string, members: Member[],
 *   currency: 'KRW', fx: Fx | null,
 *   policy: 'actual'|'payday'|'settle'|null, policyAgreedBy: string[],
 *   status?: 'ready'|'settling'|'done', doneAt?: string, version: number, createdBy: string,
 * }} Room
 * currency는 정산(송금) 통화라 늘 'KRW'다. fx가 있으면 외화 방(fx.currency로 쓴 돈을 원화로 바꾼다), 없으면 원화 방이다(#55).
 * policy·policyAgreedBy: 외화 방에만 의미가 있다. 원화 방은 null·[]로 만들고, 예전 원화 방에 남은 값은 읽을 때 무시한다(public/core.js의 isForeign).
 * policyAgreedBy: 지금 policy에 동의한 uid. 정책을 바꾸면 바꾼 사람만 남는다. 외화 방은 전원이 있어야 청구서를 보낼 수 있다(#4).
 * status: 청구서를 처음 보내면 'settling', 지금 묶음의 송금이 모두 '받았어요'로 끝나면 'done'(#55). 정산을 시작하면 초대·참가·정책 변경을,
 * 끝나면 지출·이의까지 막는다. 없으면 'ready'로 본다. createdBy(방을 만든 사람)만 다른 멤버를 내보낼 수 있다.
 */

/**
 * 초대 링크(#4). 방마다 하나(id = roomId)이고, 다시 만들면 덮어써서 이전 토큰은 무효가 된다. 서버만 읽고 쓴다.
 * @typedef {{ id: string, roomId: string, token: string, expiresAt: string, createdBy: string }} Invite
 */

/** @typedef {{ id: string, name: string, qty: number, unit: number, time?: string, tags: string[] }} Item */

/** @typedef {{ consumers: string[], confidence: number, reason: string, confirmed?: boolean, evidenceConflict?: boolean }} LineAlloc */

/**
 * 금액은 정수. 날짜는 'YYYY-MM-DD', 시각은 'HH:MM'. items가 있으면 amount 대신 줄 합을 쓴다.
 * @typedef {{
 *   id: string, roomId: string, title: string, kind: string, date: string, time: string,
 *   payer: string, method: 'card'|'cash', currency: string, amount?: number, items?: Item[],
 *   split: 'equal'|'items', present: string[], alloc?: Record<string, LineAlloc>, allocMemory?: string,
 *   source: 'manual'|'receipt', createdBy: string,
 * }} Expense
 */

/**
 * 비서 설정. #5가 화면과 저장을, #8이 payout 화면을 만든다. 읽을 때는 src/agents/settings.mjs의 normalizeSettings를 거친다.
 * memory: 정산에 쓰는 기억. memoryHidden: 방마다 공유에서 뺀 기억(기본은 모두 공유). 모델에는 sharedMemory()를 거쳐서만 간다.
 * 기억 내용과 autoAccept 금액은 본인만 본다. 배분 이유·청구서·비서 기록에는 싣지 않고, 기억은 이의 중재에서만 근거로 인용될 수 있다.
 * rules는 내 계정의 기본 설정으로 모든 방에 쓰이고, roomRules[roomId]에 그 방에서만 정한 칸이 있으면 그 칸만 덮는다(src/agents/settings.mjs의 rulesIn).
 * sendWhen: 'now' 바로, { payday } 매달 그날, 'manual' 직접(바로 알리지 않고 3일 뒤 09:00 KST까지 받았다는 확인이 없을 때만 알림, Transfer.manual).
 * notify: 종 배지에 올릴 기록. 'actions' 내가 확인할 일만, 'all' 모든 진행 상황. 기록 자체는 어느 쪽이든 모두 남는다.
 * ruleHistory: 규칙 변경 기록(오래된 것부터, 최근 50개). onboardedAt: 처음 설정을 마친 시각, 전이면 null.
 * @typedef {{
 *   uid: string, plan: 'free', memory: string[], memoryHidden: Record<string, string[]>, roomRules: Record<string, { autoAccept?: number, sendWhen?: 'now'|'manual'|{ payday: number }, onDispute?: 'ask'|'evidence'|'mediator' }>,
 *   rules: { autoAccept: number, sendWhen: 'now'|'manual'|{ payday: number }, onDispute: 'ask'|'evidence'|'mediator', notify: 'actions'|'all' },
 *   ruleHistory: { at: string, field: string, from: unknown, to: unknown, text: string }[],
 *   onboardedAt: string | null,
 *   payout: { bank: string, accountNo: string, holder: string } | null,
 * }} AgentSettings
 */

/** 청구서는 방 사람 모두가 읽는다. 위치 요약 글은 담지 않고 붙었다는 사실만 hasLocationSummary로 둔다.
 * @typedef {{
 *   id: string, roomId: string, version: number, to: string, owed: number, paid: number, net: number,
 *   status: 'pending'|'accepted'|'asked'|'disputed'|'superseded',
 *   decidedBy: 'agent'|'human'|null, reasons: string[],
 *   hasLocationSummary?: boolean,
 * }} Invoice
 */

/** 위치 원본은 넣지 않는다. 타임라인 요약(본인 제출)은 떠난 시각이면 left_at, 결제까지 머물렀으면 text(stayedUntil)이고 늘 사람 확인이 필요하다.
 * @typedef {{ kind: 'left_at'|'not_present'|'text', time?: string, stayedUntil?: string, summary: string, locationId?: string, source?: 'timeline_export', uncertain?: boolean, requiresHumanApproval?: boolean }} Evidence */

/**
 * resolved는 양쪽이 동의해 지출을 다시 나눈 이의. withdrawn은 이의를 낸 사람이, dismissed는 지출을 낸 사람이 중재안을 거부해
 * 지출을 그대로 둔 채 끝난 이의다(rejectedBy가 거부한 사람, rejectReason은 적었을 때만 있는 한 줄 사유).
 * superseded는 지출의 배분이 바뀌거나 지출이 지워져 닫힌 이의다(src/agents/disputes.mjs).
 * @typedef {{
 *   id: string, roomId: string, expenseId: string, by: string, claim: string, evidence: Evidence[],
 *   status: 'open'|'proposed'|'resolved'|'withdrawn'|'dismissed'|'superseded',
 *   proposal?: { summary: string, alloc: Record<string, LineAlloc>, source: string },
 *   agreedBy: string[], rejectedBy?: string, rejectReason?: string,
 * }} Dispute
 */

/**
 * 우리 서비스는 돈을 옮기지 않는다. link는 금액이 채워진 송금 앱 링크, fallback은 계좌·금액 복사용. manual이면 보내는 사람이 직접 보내기로 정한 송금이라 remindAt(3일 뒤 09:00 KST)까지 받는 사람이 받았다고 하지 않았을 때만 알린다. 예전 송금처럼 remindAt이 null이면 알리지 않는다(#5). notReceivedAt은 받는 사람이 "아직 안 들어왔어요"를 누른 시각(상태는 sent 그대로, 보내는 사람이 답하면 지운다), recheckedAt은 그 뒤 보내는 사람이 보냈어요로 답한 시각, reminders는 보냈어요 뒤 받았나요?를 다시 물은 횟수(#8).
 * @typedef {{
 *   id: string, roomId: string, version: number, from: string, to: string, amount: number,
 *   status: 'scheduled'|'due'|'opened'|'sent'|'confirmed'|'superseded',
 *   remindAt: string | null, link: string | null,
 *   fallback: { bank: string, accountNo: string, amount: number } | null,
 *   notReceivedAt?: string, recheckedAt?: string, reminders?: number,
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

/** #2. Public profile; identity always comes from a verified token. @typedef {{ id: string, name: string, color: string }} UserProfile */
/** Minimal deletion/retry gate, never returned in room data. @typedef {{ id: string }} DeletedUser */
/** #7. 그 방에 가장 늦게 붙인 요약이 끝날 때까지(요약마다의 기한은 LocationEvidence.expiresAt). id is JSON.stringify([roomId, uid]). @typedef {{ id: string, roomId: string, uid: string, expiresAt: string }} LocationConsent */
/** 좌표·이동 경로·장소 이름은 일부러 넣지 않는다. 시각은 한국 시각 'HH:MM'. expiresAt은 붙인 뒤 7일(이 필드가 없는 예전 기록은 createdAt + 7일).
 * @typedef {{ id: string, roomId: string, uid: string, expenseId: string, source: 'timeline_export', leftAt?: string, nextAt?: string|null, nextHome?: boolean, stayedUntil?: string, summary: string, createdAt: string, expiresAt?: string }} LocationEvidence
 */
/** Optional Store capability needed to enable account deletion. Atomically deletes
 * private records and unlinks shared financial records without changing amounts;
 * returns internal links to revoke from the QR cache. Existing CRUD stays unchanged.
 * @typedef {(uid: string) => Promise<{removedLinks: string[]}>} EraseUser
 */
