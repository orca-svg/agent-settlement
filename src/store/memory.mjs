// Store의 메모리 구현. 서버를 다시 켜면 사라진다. #3에서 같은 메서드를 가진 FirestoreStore로 바꾼다.
// 컬렉션: rooms, expenses, agents, invoices, disputes, transfers. 비서 기록(이벤트)은 방마다 seq가 1부터 늘어난다.

import { eraseUserSnapshot } from './erase-user.mjs';

export class MemoryStore {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.cols = new Map();
    this.events = new Map();
  }

  #col(name) {
    if (!this.cols.has(name)) this.cols.set(name, new Map());
    return this.cols.get(name);
  }

  async get(col, id) {
    const doc = this.#col(col).get(id);
    return doc ? structuredClone(doc) : null;
  }

  async put(col, doc) {
    this.#col(col).set(doc.id, structuredClone(doc));
    return structuredClone(doc);
  }

  // 없을 때만 넣는다. 이미 있으면 있던 문서를 그대로 돌려준다(동시에 불러도 처음 것 하나만 남는다)
  async putIfAbsent(col, doc) {
    if (!this.#col(col).has(doc.id)) this.#col(col).set(doc.id, structuredClone(doc));
    return structuredClone(this.#col(col).get(doc.id));
  }

  async delete(col, id) {
    this.#col(col).delete(id);
  }

  // uid가 탈퇴하지 않은 멤버인 방(내 방 목록). FirestoreStore는 모든 방을 읽지 않고 색인으로 찾는다
  async roomsOf(uid) {
    return [...this.#col('rooms').values()]
      .filter((room) => (room.members ?? []).some((m) => m.uid === uid && !m.deleted))
      .map((room) => structuredClone(room));
  }

  // where는 필드 동등 비교만 한다(Firestore의 == 조건과 같은 범위)
  async list(col, where = {}) {
    const conds = Object.entries(where);
    return [...this.#col(col).values()]
      .filter((doc) => conds.every(([k, v]) => doc[k] === v))
      .map((doc) => structuredClone(doc));
  }

  async appendEvent(roomId, ev) {
    const list = this.events.get(roomId) ?? [];
    const saved = { ...structuredClone(ev), seq: list.length + 1, roomId, at: this.now().toISOString() };
    list.push(saved);
    this.events.set(roomId, list);
    return structuredClone(saved);
  }

  async listEvents(roomId, afterSeq = 0) {
    return (this.events.get(roomId) ?? []).filter((e) => e.seq > afterSeq).map((e) => structuredClone(e));
  }

  // #2 optional account-erasure capability. Existing CRUD contracts are intact.
  async eraseUser(uid) {
    const result = eraseUserSnapshot(this.cols, this.events, uid, this.now());
    this.cols = result.cols;
    this.events = result.events;
    return { removedLinks: result.removedLinks };
  }
}
