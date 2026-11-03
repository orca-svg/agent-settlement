// 각자의 비서가 주인이 맡긴 규칙(#5의 agents.rules)대로 판단한다. LLM을 쓰지 않는 결정적인 코드다.

// 위에서부터 차례로 판단한다. 받을 돈 → 근거가 있는 이의 → 자동 수락 한도 → 주인에게 묻기.
// 이유는 청구서와 비서 기록에 남아 방 사람 모두가 보므로 한도 금액은 넣지 않는다. 금액은 본인의 '내 비서'에만 있다(#5)
export function evaluateInvoice({ invoice, settings, evidence = [] }) {
  const { autoAccept, onDispute } = settings.rules;
  if (invoice.net >= 0) return { decision: 'accept', reasons: [invoice.net > 0 ? '받을 돈이 있어요' : '정산할 금액이 없어요'] };
  if (evidence.length && onDispute === 'evidence') return { decision: 'dispute', reasons: evidence.map((e) => e.summary) };
  if (-invoice.net <= autoAccept) return { decision: 'accept', reasons: ['자동 수락 한도 안이에요'] };
  return { decision: 'ask', reasons: ['자동 수락 한도를 넘어서 주인에게 물어요'] };
}

const KST = 9 * 3600_000;
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// 언제 송금을 알려 줄지. 'now'면 지금, { payday: d }면 다음 d일 09:00 KST(그달에 d일이 없으면 마지막 날), 'manual'이면 알리지 않는다(null)
export function nextSendAt(now, sendWhen) {
  if (sendWhen === 'manual') return null;
  if (!sendWhen?.payday) return now.toISOString();
  const kst = new Date(now.getTime() + KST);
  let y = kst.getUTCFullYear();
  let m = kst.getUTCMonth();
  const at = () => new Date(Date.UTC(y, m, Math.min(sendWhen.payday, daysIn(y, m)))); // 그날 00:00 UTC = 09:00 KST
  if (at() < now) {
    m += 1;
    if (m === 12) [y, m] = [y + 1, 0];
  }
  return at().toISOString();
}
