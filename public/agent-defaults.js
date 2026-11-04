// 내 계정의 '내 비서 기본 설정'(#5). 받을 계좌와 자동 수락 한도·보낼 시기·이의 처리·알림을 정하면 모든 방에 이 설정으로 들어간다.
// 방마다 다른 값은 그 방의 내 비서에서 '이 방에서만'으로 정한다. 여기서는 HTML과 보낼 것만 만들고, 저장은 account.js가 한다.
// 컨트롤(분할 컨트롤·계좌 입력칸)은 방의 내 비서와 같은 것을 쓰고, 이 화면에서는 '이름·설명 | 컨트롤' 줄에 담는다
import { esc } from './ui.js';
import { sendHtml, disputeHtml, notifyHtml, historyHtml, rulesFromDraft, draftFromRules, limitNote } from './agent-panel.js';
import { payoutFieldsHtml } from './payout-form.js';
import { settingRow, settingsSection } from './settings-layout.js';

// 금액은 칸 오른쪽에 단위를 붙이고, 지금 금액이 무슨 뜻인지는 칸 바로 아래에서 고치는 대로 알린다
const amountHtml = (d) => `<div class="set-amount"><input id="set-auto-accept" data-ag="autoAccept" value="${esc(d.autoAccept)}" inputmode="numeric" maxlength="9" placeholder="0" aria-describedby="agent-limit-note"><span aria-hidden="true">원</span></div>
  <p class="group-note" id="agent-limit-note">${esc(limitNote(d))}</p>`;

// ui: { draft: 규칙 초안(draftFromRules), payout: 계좌 초안(payoutDraftFrom), editPayout: 계좌 입력칸을 펼쳤는지 }
export function defaultsHtml(view, ui) {
  const p = view.payout;
  const d = ui.draft;
  const payout = ui.editPayout || !p
    ? payoutFieldsHtml(ui.payout)
    : settingRow({ label: '지금 계좌', control: `<div class="set-value"><span class="grow"><span class="title">${esc(p.bank)} •••• ${esc(p.last4)}</span><span class="meta">${esc(p.holder)}</span></span>
        <button type="button" class="btn sm plain" data-action="payout-edit">바꾸기</button></div>` });
  return `<div class="set-group" id="agent"><h2 class="set-group-title">내 비서 기본 설정</h2>
      <p class="set-intro">모든 방에 이 설정으로 들어가요. 방마다 다르게 하고 싶은 규칙은 그 방의 내 비서에서 ‘이 방에서만’을 골라요.</p></div>
    ${settingsSection({ id: 'payout', title: '받을 계좌', desc: '계좌번호는 나에게 돈을 보낼 사람에게만 보여요. 바꾸면 내가 받을 모든 방의 대기 중 송금에 들어가요.', body: payout })}
    ${settingsSection({ id: 'rules', title: '비서 규칙', body: `
      ${settingRow({ label: '자동 수락 한도', forId: 'set-auto-accept', desc: '이 금액까지는 비서가 나에게 묻지 않고 청구서를 받아요.', control: amountHtml(d) })}
      ${settingRow({ label: '보낼 시기', desc: '정산이 끝난 뒤 내가 낼 돈을 언제 보낼지예요.', control: sendHtml(d) })}
      ${settingRow({ label: '이의 처리', desc: '정산에 이의가 오가면 비서가 어떻게 할지예요.', control: disputeHtml(d) })}
      ${historyHtml(view)}` })}
    ${settingsSection({ id: 'notify', title: '알림', body: settingRow({ label: '알림 수준', desc: '비서가 언제 나를 부를지예요.', control: notifyHtml(d) }) })}`;
}

// 저장할 것: 저장된 기본 설정과 달라진 규칙(같으면 null), 새 계좌번호를 적었을 때만 계좌(아니면 null)
export function defaultsBody(view, ui) {
  const rules = rulesFromDraft(ui.draft);
  const changed = JSON.stringify(rules) !== JSON.stringify(rulesFromDraft(draftFromRules(view.rules)));
  const p = ui.payout;
  const payout = ui.editPayout && String(p.accountNo).trim() ? { bank: p.bank, accountNo: p.accountNo, holder: p.holder } : null;
  return { rules: changed ? rules : null, payout };
}

// 바꾼 칸들(화면 아래 '저장하지 않은 변경 N개'가 센다). 저장할 것과 같은 기준이라 센 것과 저장하는 것이 어긋나지 않는다
const RULE_FIELDS = ['autoAccept', 'sendWhen', 'onDispute', 'notify'];
export function defaultsChanges(view, ui) {
  const now = rulesFromDraft(ui.draft);
  const saved = rulesFromDraft(draftFromRules(view.rules));
  const fields = RULE_FIELDS.filter((k) => JSON.stringify(now[k]) !== JSON.stringify(saved[k]));
  return defaultsBody(view, ui).payout ? [...fields, 'payout'] : fields;
}
