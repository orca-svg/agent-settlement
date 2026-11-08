// 정산 진행 상태. 방 화면의 단계 막대·한 줄 요약, 내 방 목록의 진행 줄, 끝난 방의 요약이 같은 판정을 쓴다.
// 이벤트 기록이 아니라 현재 상태(방·지출·청구서·이의·송금)에서 계산하므로, 서버(내 방 목록)와 화면이 같은 답을 낸다.
// 사용자 테스트(11/5)에서 "다음 task가 한눈에", "방이 끝난 걸 나갔다로 이해"가 나와 만들었다
import { active, isForeign, toKrw, ledger, shares } from './core.js';

export const STEPS = ['모으기', '나누기', '청구', '응답', '보내기', '끝'];

// actions.mjs의 확인이 필요한 줄과 같은 기준
const isFlagged = (line) => Boolean(line) && line.confidence < 0.7 && !line.confirmed;
const OPEN_DISPUTE = ['open', 'proposed'];
const WAITING_INVOICE = ['pending', 'asked'];

// → { step: 1~6, label, summary, remaining: 남은 일 문장들, ratio: 지금 단계 안의 진행 비율(셀 수 없으면 null) }
export function progressOf({ room, expenses = [], invoices = [], disputes = [], transfers = [] }, me) {
  const name = (uid) => (uid === me ? '나' : room.members.find((m) => m.uid === uid)?.name ?? uid);
  const at = (step, summary, remaining = [], ratio = null) => ({ step, label: STEPS[step - 1], summary, remaining, ratio });
  if (room.status === 'done') return at(6, '정산이 끝났어요');

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
      return at(4, summary, remaining, answered / current.length);
    }
    const live = transfers.filter((t) => t.version === room.version && t.status !== 'superseded');
    if (!live.length) return at(5, '주고받을 돈이 없어요');
    const received = live.filter((t) => t.status === 'confirmed').length;
    const remaining = live.filter((t) => t.status !== 'confirmed').map((t) => {
      const pair = `${name(t.from)} → ${name(t.to)}`;
      if (t.status !== 'sent') return `${pair} 보내기`;
      // 받는 사람이 "아직 안 들어왔어요"라고 했으면 보낸 사람이 다시 확인할 차례다(actions.mjs의 awaitsSender)
      return t.notReceivedAt ? `${name(t.from)}의 송금 확인(${pair})` : `${name(t.to)}의 받음 확인(${pair})`;
    });
    return at(5, `송금 ${live.length}번 중 ${received}번 받음`, remaining, received / live.length);
  }

  if (!expenses.length) return at(1, '지출을 남기면 정산이 시작돼요');
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
    return at(2, summary, remaining);
  }
  return at(3, invoices.length ? '지출이 바뀌어서 청구서를 다시 보내야 해요' : '청구서를 보내면 비서들이 확인해요');
}

// 내 방 목록의 진행 막대. 지난 단계는 한 칸씩, 지금 단계는 그 안의 비율만큼 채운다(끝은 다섯 칸 모두)
export const overallRatio = ({ step, ratio }) => (step >= STEPS.length ? 1 : (step - 1 + (ratio ?? 0)) / (STEPS.length - 1));

// 끝난 방의 요약. 지출마다 보냈다면 몇 번이었을지(낸 사람에게 나머지가 각각 보내는 횟수)를 함께 세어,
// 다자간 상계로 송금이 얼마나 줄었는지 보여 준다
export function doneSummary({ room, expenses = [], invoices = [], disputes = [], transfers = [] }, me) {
  const live = transfers.filter((t) => t.version === room.version && t.status !== 'superseded');
  const naive = expenses.reduce((n, e) => n + Object.entries(shares(e, room, room.policy).krwShare).filter(([p, v]) => p !== e.payer && v > 0).length, 0);
  return {
    total: expenses.reduce((s, e) => s + toKrw(e, room, room.policy).krw, 0),
    mine: ledger(room, expenses, room.policy)[me]?.owed ?? 0,
    transfers: live.length,
    naive,
    autoAccepted: invoices.filter((i) => i.version === room.version && i.status === 'accepted' && i.decidedBy !== 'human').length,
    mediated: disputes.filter((d) => d.status === 'resolved').length,
  };
}
