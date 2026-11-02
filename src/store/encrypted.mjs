// 계좌가 들어가는 칸만 잠그는 Store 래퍼(#8, #10). 넣을 때 잠그고 꺼낼 때 풀어서,
// 송금·정산 코드는 평문을 넣고 평문을 받는다. 진짜 저장소(MemoryStore, 이후 FirestoreStore)에는 잠긴 글자만 남는다.
// 잠긴 칸이 평문이거나 풀리지 않으면 에러를 낸다(평문 가짜 계좌를 몰래 넣는 것, 저장소 손상을 숨기지 않는다).
import { seal, unseal } from '../security/seal.mjs';

// 컬렉션별로 잠그는 칸: 받는 계좌 원본과, 송금 건마다 복사되는 토스 링크·복사용 계좌 정보
export const SEALED_FIELDS = { agents: ['payout'], transfers: ['link', 'fallback'] };

export function encryptedStore(inner, key) {
  const fieldsOf = (col) => SEALED_FIELDS[col] ?? [];
  const label = (col, id, field) => `${col}/${id}/${field}`;

  // null·undefined는 "계좌 없음"이라는 뜻이라 잠그지 않는다
  const lock = (col, doc) => {
    const out = { ...doc };
    for (const f of fieldsOf(col)) if (out[f] != null) out[f] = seal(out[f], key, label(col, doc.id, f));
    return out;
  };
  const open = (col, doc) => {
    if (!doc) return doc;
    for (const f of fieldsOf(col)) if (doc[f] != null) doc[f] = unseal(doc[f], key, label(col, doc.id, f));
    return doc;
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
  // (탈퇴 API는 이 링크를 평문으로 비교해 이미 발급한 QR 토큰을 무효화한다)
  if (typeof inner.eraseUser === 'function') {
    store.eraseUser = async (uid) => {
      const removedLinks = (await store.list('transfers')).filter((t) => (t.from === uid || t.to === uid) && t.link).map((t) => t.link);
      return { ...(await inner.eraseUser(uid)), removedLinks };
    };
  }

  return store;
}
