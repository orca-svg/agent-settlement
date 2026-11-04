// 방에서 빠지는 조건(#55). 서버(src/rooms/policy.mjs)가 나가기·내보내기를 막을 때와, 화면이 누르기 전에 이유를 보여 줄 때 같은 규칙을 쓴다.
import { won } from './core.js';
import { disputeLive } from './ui.js';

// 이 사람이 지금 방에서 빠지면 정산이 안 끝난 돈이 남는지. 남으면 사람에게 보여 줄 이유를, 아니면 null을 돌려준다.
// 완료된 방은 늘 빠질 수 있다. 정산 전에는 그 사람이 낀 지출이 없어야 하고, 정산 중에는 방 전체가 끝나야 한다
// (내 송금이 끝났어도 남의 이의가 받아들여져 다시 나누면 내 몫이 바뀔 수 있다). self: 본인이 나가는지, 내보내는지
export function leaveBlock({ room, expenses = [], invoices = [], disputes = [], transfers = [] }, uid, { self = true } = {}) {
  if (room.status === 'done') return null;
  const name = (u) => room.members.find((m) => m.uid === u)?.name ?? u;
  const mine = expenses.filter((e) => e.payer === uid || e.present.includes(uid));
  if (!mine.length) return null; // 낀 돈이 없다. 청구서를 받았어도 0원이다
  const verb = self ? '나갈' : '내보낼';
  if (room.status !== 'settling') {
    const more = mine.length > 1 ? ` 외 ${mine.length - 1}건` : '';
    return `‘${mine[0].title}’${more} 지출에 ${self ? '내' : `${name(uid)}의`} 몫이 있어요. 그 지출에서 빼거나 지운 뒤에 ${verb} 수 있어요.`;
  }
  const current = (x) => x.version === room.version;
  const left = [
    ...transfers.filter((t) => current(t) && t.status !== 'confirmed' && t.status !== 'superseded' && (t.from === uid || t.to === uid))
      .map((t) => (t.from === uid ? `${name(t.to)}에게 보낼 ${won(t.amount)}` : `${name(t.from)}에게서 받을 ${won(t.amount)}`)),
    ...(invoices.some((i) => current(i) && i.to === uid && i.status === 'asked') ? ['확인할 청구서'] : []),
    ...(disputes.some((d) => disputeLive(d) && (d.by === uid || expenses.find((e) => e.id === d.expenseId)?.payer === uid)) ? ['진행 중인 이의'] : []),
  ];
  if (left.length) return `정산이 끝나지 않아 ${verb} 수 없어요. 남은 일: ${left.join(', ')}`;
  return `방의 정산이 아직 끝나지 않아 ${verb} 수 없어요. 모든 송금이 ‘받았어요’로 끝나면 ${verb} 수 있어요.`;
}
