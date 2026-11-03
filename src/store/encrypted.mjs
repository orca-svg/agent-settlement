// 계좌·위치 요약이 들어가는 칸만 잠그는 Store 래퍼(#8, #10). 넣을 때 잠그고 꺼낼 때 풀어서,
// 송금·정산·이의 코드는 평문을 넣고 평문을 받는다. 진짜 저장소(MemoryStore, 이후 FirestoreStore)에는 잠긴 글자만 남는다.
// 잠긴 칸이 평문이거나 풀리지 않으면 에러를 낸다(평문 가짜 값을 몰래 넣는 것, 저장소 손상을 숨기지 않는다).
// 주의: 잠긴 값은 '컬렉션/문서id/칸' 이름표에 묶인다. 잠긴 문서의 id를 바꾸는 코드는 이 래퍼로 풀었다가 다시 넣어야 한다.
import { seal, unseal } from '../security/seal.mjs';

// 컬렉션별로 잠그는 칸
// - 받는 계좌 원본과, 송금 건마다 복사되는 토스 링크·복사용 계좌 정보(#8)
// - 위치 근거(#7): 본인 제출 시각과 그것으로 만든 요약 문장. 찾는 데 쓰는 uid·roomId·expenseId는 평문
// - 이의: 위치 요약을 베낀 근거와, 그것을 보고 중재 비서가 쓴 중재안(src/app.mjs redactDispute가 가리는 칸)
export const SEALED_FIELDS = {
  agents: ['payout'],
  transfers: ['link', 'fallback'],
  locationEvidence: ['summary', 'leftAt', 'stayedUntil', 'nextAt', 'nextHome'],
  disputes: ['evidence', 'proposal'],
};

export function encryptedStore(inner, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('암호화 열쇠는 32바이트여야 해요');
  const fieldsOf = (col) => SEALED_FIELDS[col] ?? [];
  const label = (col, id, field) => `${col}/${id}/${field}`;

  // 비어 있는 값(null·undefined·빈 목록)은 "없음"이라 잠그지 않는다.
  // 빈 목록은 탈퇴 처리(erase-user.mjs)가 래퍼를 거치지 않고 disputes.evidence에 직접 써 넣는 값이기도 하다
  const empty = (v) => v == null || (Array.isArray(v) && v.length === 0);

  // 비어 있는 값은 그대로 둔다(empty 참고)
  const lock = (col, doc) => {
    const out = { ...doc };
    for (const f of fieldsOf(col)) {
      if (empty(out[f])) continue;
      if (doc.id == null) throw new Error(`id가 없는 문서는 잠글 수 없어요: ${col}.${f}`);
      out[f] = seal(out[f], key, label(col, doc.id, f));
    }
    return out;
  };
  // 진짜 저장소가 돌려준 객체는 고치지 않고 복사본에 푼다(캐시하는 저장소에 평문이 섞이지 않게)
  const open = (col, doc) => {
    if (!doc) return doc;
    const out = { ...doc };
    for (const f of fieldsOf(col)) if (!empty(out[f])) out[f] = unseal(out[f], key, label(col, doc.id, f));
    return out;
  };

  const store = {
    async get(col, id) {
      return open(col, await inner.get(col, id));
    },
    async put(col, doc) {
      await inner.put(col, lock(col, doc));
      return structuredClone(doc);
    },
    async delete(col, id) {
      return inner.delete(col, id);
    },
    // 잠긴 글자로는 같은 값을 찾을 수 없으니, 잠긴 칸으로 거르는 건 막는다
    async list(col, where = {}) {
      const sealedKey = fieldsOf(col).find((f) => f in where);
      if (sealedKey) throw new Error(`잠긴 칸(${col}.${sealedKey})으로는 찾을 수 없어요`);
      return (await inner.list(col, where)).map((doc) => open(col, doc));
    },
    // 비서 기록 문장에는 계좌번호가 들어가지 않는다
    appendEvent: (roomId, ev) => inner.appendEvent(roomId, ev),
    listEvents: (roomId, afterSeq) => inner.listEvents(roomId, afterSeq),
  };

  // #2 탈퇴: 진짜 저장소에 계정 삭제 기능이 있을 때만 붙인다(없으면 탈퇴 API가 503으로 알린다).
  // 진짜 저장소는 지운 송금 링크를 잠긴 글자로 돌려주므로, 지우기 전에 평문 링크를 모아 대신 돌려준다
  // (탈퇴 API는 이 링크를 평문으로 비교해 이미 발급한 QR 토큰을 무효화한다).
  // 이 사람이 낀 송금만 본다(다른 방의 손상이 탈퇴를 막지 않게, 남의 계좌는 풀지 않게).
  if (typeof inner.eraseUser === 'function') {
    store.eraseUser = async (uid) => {
      const mine = [...(await inner.list('transfers', { from: uid })), ...(await inner.list('transfers', { to: uid }))];
      const removedLinks = [];
      for (const t of mine) {
        if (t.link == null) continue;
        try {
          removedLinks.push(unseal(t.link, key, label('transfers', t.id, 'link')));
        } catch {
          // 어차피 지울 값이라 풀리지 않으면 건너뛴다(탈퇴 API는 QR 토큰을 uid 기준으로도 무효화한다)
        }
      }
      return { ...(await inner.eraseUser(uid)), removedLinks };
    };
  }

  return store;
}
