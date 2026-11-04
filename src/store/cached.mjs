// Firestore 앞에 두는 읽기 캐시(#49). Store 계약은 그대로다(test/store.test.mjs).
// 쓰기는 모두 이 서버만 하고(firestore.rules가 화면의 쓰기를 막는다) 인스턴스는 하나라서(--max-instances 1, ARCHITECTURE.md),
// 한 번 읽은 문서·목록을 메모리에서 돌려줘도 된다. 방 화면 한 번에 Firestore를 5번쯤 차례로 오가던 것을 줄인다.
// - 쓰기는 진짜 저장소에 먼저 쓰고 그 컬렉션의 캐시를 비운다. 쓴 값을 바로 넣지 않는 건 Firestore가 돌려주는 모양
//   (undefined 칸이 빠짐, 처음 넣은 순서의 목록)과 똑같이 맞추려는 것. 다음 읽기 한 번이 다시 채운다.
// - 쓰기 앞뒤로 세대를 올려서, 쓰기와 엇갈린 늦은 읽기가 옛 값으로 캐시를 덮지 않게 한다.
// - 같은 것을 동시에 읽으면 진짜 저장소에는 한 번만 묻는다(비서 기록이 생기면 열린 탭이 한꺼번에 방을 다시 읽는다).
// - ttlMs가 지나면 다시 읽는다. 배포 중 잠깐 겹친 옛 인스턴스의 쓰기나 콘솔에서 고친 값을 따라잡게.
// - 영수증 사진(receipts)은 장당 수 MB라 거치지 않는다.
// 암호화 래퍼(encryptedStore) 안쪽에 둬서 캐시에는 잠긴 글자만 남는다(server.mjs).
// 여러 인스턴스로 늘리면 이 캐시는 다른 인스턴스의 쓰기를 모르므로 빼야 한다.

const RECEIPTS = 'receipts';
const ALL_EVENTS = '"all"';

export function cachedStore(inner, { ttlMs = 60_000, now = Date.now } = {}) {
  const entries = new Map(); // 무리(컬렉션, 방의 비서 기록) → Map(키 → { value, at })
  const inflight = new Map(); // 무리 → Map(키 → { gen, promise })
  const gens = new Map(); // 무리 → 세대
  let epoch = 0; // 탈퇴처럼 모든 무리를 건드리는 쓰기의 세대

  const genOf = (group) => `${epoch}:${gens.get(group) ?? 0}`;
  const key = (...parts) => JSON.stringify(parts);
  const groupMap = (m, group) => {
    if (!m.has(group)) m.set(group, new Map());
    return m.get(group);
  };
  const eventsOf = (roomId) => `events/${roomId}`;

  function read(group, k, load) {
    const hit = entries.get(group)?.get(k);
    if (hit && now() - hit.at < ttlMs) return Promise.resolve(structuredClone(hit.value));
    const gen = genOf(group);
    const pending = inflight.get(group)?.get(k);
    if (pending?.gen === gen) return pending.promise.then(structuredClone);
    const promise = load().then((value) => {
      if (genOf(group) === gen) groupMap(entries, group).set(k, { value, at: now() });
      return value;
    });
    groupMap(inflight, group).set(k, { gen, promise });
    const done = () => {
      if (inflight.get(group)?.get(k)?.promise === promise) inflight.get(group).delete(k);
    };
    promise.then(done, done);
    return promise.then(structuredClone);
  }

  // 그 무리의 캐시를 비우고 세대를 올린다
  function bump(group) {
    gens.set(group, (gens.get(group) ?? 0) + 1);
    entries.delete(group);
  }

  async function write(col, fn) {
    if (col === RECEIPTS) return fn();
    bump(col);
    try {
      return await fn();
    } finally {
      bump(col);
    }
  }

  const store = {
    get: (col, id) => (col === RECEIPTS ? inner.get(col, id) : read(col, key('doc', id), () => inner.get(col, id))),
    list(col, where = {}) {
      if (col === RECEIPTS) return inner.list(col, where);
      const conds = Object.entries(where).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return read(col, key('list', conds), () => inner.list(col, where));
    },
    roomsOf: (uid) => read('rooms', key('roomsOf', uid), () => inner.roomsOf(uid)),
    put: (col, doc) => write(col, () => inner.put(col, doc)),
    putIfAbsent: (col, doc) => write(col, () => inner.putIfAbsent(col, doc)),
    delete: (col, id) => write(col, () => inner.delete(col, id)),

    // 방의 비서 기록은 처음부터 읽은 적이 있으면 메모리에서 거르고, 없으면 중간부터 읽는 요청은 그대로 보낸다(전부 읽지 않게)
    async listEvents(roomId, afterSeq = 0) {
      const group = eventsOf(roomId);
      const hit = entries.get(group)?.get(ALL_EVENTS);
      if (afterSeq > 0 && !(hit && now() - hit.at < ttlMs)) return inner.listEvents(roomId, afterSeq);
      return (await read(group, ALL_EVENTS, () => inner.listEvents(roomId, 0))).filter((e) => e.seq > afterSeq);
    },
    // 새 기록은 캐시된 목록 끝에 바로 붙인다. 번호가 이어지지 않으면(동시에 붙은 기록) 목록을 버리고 다음에 다시 읽는다
    async appendEvent(roomId, ev) {
      const group = eventsOf(roomId);
      gens.set(group, (gens.get(group) ?? 0) + 1);
      try {
        const saved = await inner.appendEvent(roomId, ev);
        const hit = entries.get(group)?.get(ALL_EVENTS);
        if (hit && (hit.value.at(-1)?.seq ?? 0) === saved.seq - 1) hit.value.push(structuredClone(saved));
        else entries.get(group)?.delete(ALL_EVENTS);
        return saved;
      } finally {
        gens.set(group, (gens.get(group) ?? 0) + 1);
      }
    },
  };

  // 탈퇴는 여러 컬렉션과 방의 기록을 한꺼번에 고치므로 캐시를 통째로 비운다. 진짜 저장소에 있을 때만 붙인다(없으면 탈퇴 API가 503)
  if (typeof inner.eraseUser === 'function') {
    const clearAll = () => {
      epoch += 1;
      entries.clear();
    };
    store.eraseUser = async (uid) => {
      clearAll();
      try {
        return await inner.eraseUser(uid);
      } finally {
        clearAll();
      }
    };
  }

  return store;
}
