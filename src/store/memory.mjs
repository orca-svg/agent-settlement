// Store의 메모리 구현. 서버를 다시 켜면 사라진다. #3에서 같은 메서드를 가진 FirestoreStore로 바꾼다.
// 컬렉션: rooms, expenses, agents, invoices, disputes, transfers. 비서 기록(이벤트)은 방마다 seq가 1부터 늘어난다.

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
}
