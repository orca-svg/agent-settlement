// 받을 계좌 입력칸(#8). 방의 계좌 시트와 내 계정의 비서 기본 설정이 같은 모양으로 쓴다.
// 은행은 목록에서 고른다. 토스는 모르는 은행 이름이면 에러를 내서, 실기기로 확인한 은행만 목록에 둔다(public/banks.js). 목록에 없는 은행만 직접 쓴다
import { esc } from './ui.js';
import { BANKS } from './banks.js';

// 저장된 계좌가 있으면 은행·예금주를 채운다. 계좌번호는 끝 4자리만 알아서 새로 입력한다
export function payoutDraftFrom(saved, holder) {
  if (!saved) return { bank: BANKS[0].label, accountNo: '', holder, other: false };
  return { bank: saved.bank, accountNo: '', holder: saved.holder, other: !BANKS.some((b) => b.label === saved.bank), last4: saved.last4 };
}

export function payoutFieldsHtml(p) {
  const options = BANKS.map((b) => `<option value="${esc(b.label)}"${!p.other && p.bank === b.label ? ' selected' : ''}>${esc(b.label)}</option>`).join('');
  return `<div class="list">
      <label class="row field"><span class="grow">은행</span><select data-bank-pick>${options}<option value=""${p.other ? ' selected' : ''}>목록에 없어요</option></select></label>
      ${p.other ? `<label class="row field"><span class="grow">은행 이름</span><input data-pf="bank" value="${esc(p.bank)}" maxlength="30" placeholder="예: 경남은행"></label>` : ''}
      <label class="row field"><span class="grow">계좌번호</span><input data-pf="accountNo" value="${esc(p.accountNo)}" inputmode="numeric" maxlength="30" placeholder="${p.last4 ? `지금은 •••• ${esc(p.last4)}. 새 번호 전체 입력` : '숫자만 또는 - 포함'}"></label>
      <label class="row field"><span class="grow">예금주</span><input data-pf="holder" value="${esc(p.holder)}" maxlength="30"></label>
    </div>
    ${p.other ? '<p class="group-note">목록에 없는 은행은 토스가 알아보지 못할 수 있어요. 그때는 보내는 사람에게 계좌번호를 복사해 보내도록 안내해요.</p>' : ''}`;
}
