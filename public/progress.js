// 정산 진행 상태. 방 화면의 장부 줄·단계 막대·한 줄 요약, 내 방 목록의 진행 줄, 끝난 방의 요약, 저장 전 알림이 같은 판정을 쓴다.
// 이벤트 기록이 아니라 현재 상태(방·지출·청구서·이의·송금)에서 계산하므로, 서버(내 방 목록)와 화면이 같은 답을 낸다.
// 사용자 테스트(11/5)에서 "다음 task가 한눈에", "방이 끝난 걸 나갔다로 이해"가 나와 만들었다.
// 지출 모으기·나누기는 정산이 끝날 때까지(끝난 뒤에도 추가 정산으로) 언제든 다시 일어나서 단계로 세지 않고 늘 열린 장부(book)로 따로 둔다.
// 단계는 한 번의 정산이 지나가는 길(청구 → 응답 → 보내기 → 끝)만 센다
import { active, isForeign, toKrw, ledger, shares, won, movedBefore } from './core.js';

export const STEPS = ['청구', '응답', '보내기', '끝'];

// actions.mjs의 확인이 필요한 줄과 같은 기준
const isFlagged = (line) => Boolean(line) && line.confidence < 0.7 && !line.confirmed;
const OPEN_DISPUTE = ['open', 'proposed'];
const WAITING_INVOICE = ['pending', 'asked'];
const sum = (list) => list.reduce((s, t) => s + t.amount, 0);

// 지금 묶음의 송금과, 예전 묶음에서 보냈다고만 한(받았어요 전) 송금. 뒤의 것은 새 송금에서 빠졌으니(이미 오간 돈) 받을 때까지 함께 센다
const liveTransfers = (room, transfers) => transfers.filter((t) => t.status !== 'superseded'
  && (t.version === room.version || (t.version < room.version && t.status === 'sent')));

// → { step: 1~4, label, summary, remaining: 남은 일 문장들, ratio: 지금 단계 안의 진행 비율(셀 수 없으면 null),
//     book: 장부 { count, total }, extra: 추가 정산이면 이미 오간 돈 { moved, count }, 아니면 null }
export function progressOf({ room, expenses = [], invoices = [], disputes = [], transfers = [] }, me) {
  const name = (uid) => (uid === me ? '나' : room.members.find((m) => m.uid === uid)?.name ?? uid);
  const book = { count: expenses.length, total: expenses.reduce((s, e) => s + toKrw(e, room, room.policy).krw, 0) };
  const moved = room.status === 'done' ? [] : movedBefore(transfers, room.version);
  const extra = moved.length ? { moved: sum(moved), count: moved.length } : null;
  const at = (step, summary, remaining = [], ratio = null) => ({ step, label: STEPS[step - 1], summary, remaining, ratio, book, extra });
  if (room.status === 'done') return at(4, '정산이 끝났어요');

  const current = invoices.filter((i) => i.version === room.version && i.status !== 'superseded');
  if (current.length) {
    const waiting = current.filter((i) => WAITING_INVOICE.includes(i.status));
    const open = disputes.map((d) => [d, expenses.find((e) => e.id === d.expenseId)]).filter(([d, e]) => e && OPEN_DISPUTE.includes(d.status));
    if (waiting.length || open.length) {
      const answered = current.length - waiting.length;
      const remaining = [
        ...waiting.map((i) => (i.status === 'asked' ? `${name(i.to)}의 확인` : `${name(i.to)}의 비서 확인`)),
        ...open.flatMap(([d, e]) => (d.status === 'open'
          ? [`${name(e.payer)}의 ‘${e.title}’ 중재 맡기기`]
          : [...new Set([e.payer, d.by])].filter((u) => !(d.agreedBy ?? []).includes(u)).map((u) => `${name(u)}의 ‘${e.title}’ 중재안 동의`))),
      ];
      const summary = `청구서 ${current.length}개 중 ${answered}개 응답${open.length ? ` · 이의 ${open.length}건 진행 중` : ''}`;
      return at(2, summary, remaining, answered / current.length);
    }
    const live = liveTransfers(room, transfers);
    if (!live.length) return at(3, extra ? '더 주고받을 돈이 없어요' : '주고받을 돈이 없어요');
    const received = live.filter((t) => t.status === 'confirmed').length;
    const remaining = live.filter((t) => t.status !== 'confirmed').map((t) => {
      const pair = `${name(t.from)} → ${name(t.to)}`;
      if (t.status !== 'sent') return `${pair} 보내기`;
      // 받는 사람이 "아직 안 들어왔어요"라고 했으면 보낸 사람이 다시 확인할 차례다(actions.mjs의 awaitsSender)
      return t.notReceivedAt ? `${name(t.from)}의 송금 확인(${pair})` : `${name(t.to)}의 받음 확인(${pair})`;
    });
    return at(3, `송금 ${live.length}번 중 ${received}번 받음`, remaining, received / live.length);
  }

  // 청구서를 보내기 전(또는 지출이 바뀌어 다시 보내야 할 때): 장부를 정리해야 보낼 수 있으면 그것을 남은 일로 적는다
  if (!expenses.length) return at(1, '지출을 남기면 청구서를 보낼 수 있어요');
  // 외화 방은 전원이 환율 정책에 동의해야 청구서를 보낼 수 있다(#4). 서버도 같은 조건으로 막는다
  if (isForeign(room)) {
    const here = room.members.filter(active);
    const missing = here.filter((m) => !(room.policyAgreedBy ?? []).includes(m.uid));
    if (missing.length) {
      const agreed = here.length - missing.length;
      return at(1, `환율 정책 동의 ${agreed}/${here.length}`, missing.map((m) => `${name(m.uid)}의 환율 정책 동의`), agreed / here.length);
    }
  }
  const unsplit = expenses.filter((e) => e.split === 'items' && e.items?.length && !e.alloc);
  const flagged = expenses.flatMap((e) => (e.items ?? []).filter((it) => isFlagged(e.alloc?.[it.id])).map((it) => [e, it]));
  if (unsplit.length || flagged.length) {
    const summary = [unsplit.length && `메뉴별로 나누지 않은 지출 ${unsplit.length}건`, flagged.length && `확인할 줄 ${flagged.length}개`].filter(Boolean).join(' · ');
    const remaining = [...unsplit.map((e) => `‘${e.title}’ 나누기`), ...flagged.map(([e, it]) => `${name(e.createdBy)}의 ‘${it.name}’ 확인`)];
    return at(1, summary, remaining);
  }
  return at(1, invoices.length ? '지출이 바뀌어서 청구서를 다시 보내야 해요' : '청구서를 보내면 비서들이 확인해요');
}

// 내 방 목록의 진행 막대. 지난 단계는 한 칸씩, 지금 단계는 그 안의 비율만큼 채운다(끝은 세 칸 모두)
export const overallRatio = ({ step, ratio }) => (step >= STEPS.length ? 1 : (step - 1 + (ratio ?? 0)) / (STEPS.length - 1));

// 추가 정산에서 이미 오간 돈을 알리는 문장(단계 막대·저장 전 알림이 같은 말을 쓴다)
export const movedText = (amount) => `이미 오간 ${won(amount)}은 그대로 두고 바뀐 만큼만 주고받아요`;

// 저장 전 알림(D). 청구서가 나간 방이나 끝난 방에서 지출을 더하거나(add) 고치거나(edit) 지출 시트에서 지우고 다시 나눌 때(expense),
// 무엇을 다시 해야 하는지 누르기 전에 그 버튼 바로 위에서 알린다. 금액이 그대로인 수정은 청구서를 밀어내지 않으므로(서버의 billKey) 그렇다고 함께 적는다.
// 알릴 게 없으면 null(청구서를 아직 안 보냈거나, 이미 다시 보내야 하는 상태)
export function changeNotice({ room, invoices = [], transfers = [] }, mode = 'add') {
  const done = room.status === 'done';
  const out = invoices.filter((i) => i.version === room.version && i.status !== 'superseded').length;
  if (!done && !out) return null;
  const when = { add: '저장하면', edit: '금액이나 사람·날짜를 바꾸면', expense: '이 지출을 지우거나 몫을 바꾸면' }[mode];
  const moved = sum(transfers.filter((t) => ['sent', 'confirmed'].includes(t.status)));
  return [
    done && '정산이 끝난 방이에요.',
    `${when} ${done ? '추가 정산이 열려요.' : `보낸 청구서 ${out}개를 다시 보내야 해요.`}`,
    moved > 0 && `${movedText(moved)}.`,
    mode === 'edit' && '제목·결제 수단만 고치면 그대로예요.',
  ].filter(Boolean).join(' ');
}

// 끝난 방의 요약. 지출마다 보냈다면 몇 번이었을지(낸 사람에게 나머지가 각각 보내는 횟수)를 함께 세어,
// 다자간 상계로 송금이 얼마나 줄었는지 보여 준다. 송금은 추가 정산 전에 오간 것까지 센다(대체된 송금은 빼고)
export function doneSummary({ room, expenses = [], invoices = [], disputes = [], transfers = [] }, me) {
  const naive = expenses.reduce((n, e) => n + Object.entries(shares(e, room, room.policy).krwShare).filter(([p, v]) => p !== e.payer && v > 0).length, 0);
  return {
    total: expenses.reduce((s, e) => s + toKrw(e, room, room.policy).krw, 0),
    mine: ledger(room, expenses, room.policy)[me]?.owed ?? 0,
    transfers: transfers.filter((t) => t.status !== 'superseded').length,
    naive,
    autoAccepted: invoices.filter((i) => i.version === room.version && i.status === 'accepted' && i.decidedBy !== 'human').length,
    mediated: disputes.filter((d) => d.status === 'resolved').length,
  };
}
