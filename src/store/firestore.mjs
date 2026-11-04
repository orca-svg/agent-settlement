// Store의 Firestore 구현(#3). MemoryStore와 같은 계약(test/store.test.mjs, test/account-erasure.test.mjs의 eraseUser)을 지킨다.
// 경로: 컬렉션은 최상위 `{col}/{id}`이고 방에 속한 문서는 roomId 필드로 거른다(get·delete에 roomId가 없고, tick()이 모든 방의 송금을 훑기 때문).
//       비서 기록은 `rooms/{roomId}/events/{seq}`, 방마다 seq를 매기는 카운터는 `rooms/{roomId}/meta/events`.
//       영수증 사진(receipts)은 문서 1MiB 한도를 넘을 수 있어 Cloud Storage `receipts/{지출 id}`에 둔다.
// 문서에 몰래 붙이는 칸(읽을 때 뺀다): _order(처음 넣은 순서, 목록 순서를 MemoryStore와 맞춤),
//       rooms의 _memberUids(탈퇴하지 않은 멤버 uid, firestore.rules가 멤버 확인에 씀).
import { eraseUserSnapshot } from './erase-user.mjs';

const ORDER = '_order';
const MEMBERS = '_memberUids';
const ROOM_COLS = ['expenses', 'invoices', 'disputes', 'transfers', 'invites']; // invites(#4): 탈퇴하면 링크를 만든 사람만 끊는다

// Firestore 문서 id 규칙. '/'가 들어가면 다른 경로에 조용히 써지므로 넣기는 막는다.
// 읽기·지우기는 그런 id를 '없음'으로 다룬다(요청에서 온 id가 이상해도 MemoryStore처럼 null → 404)
const validId = (id) => typeof id === 'string' && Boolean(id) && !id.includes('/') && id !== '.' && id !== '..' && !/^__.*__$/.test(id);
function checkId(id) {
  if (!validId(id)) throw new Error(`Firestore에 쓸 수 없는 id예요: ${JSON.stringify(id)}`);
  return id;
}

export class FirestoreStore {
  #last = 0;

  constructor({ db, bucket, now = () => new Date() }) {
    this.db = db;
    this.bucket = bucket;
    this.now = now;
  }

  // ponytail: 순서는 서버 시계(ms) 기준이라 여러 인스턴스가 같은 ms에 넣으면 순서가 섞일 수 있다. 지금 배포는 --max-instances 1
  #nextOrder() {
    this.#last = Math.max(Date.now(), this.#last + 1);
    return this.#last;
  }

  #stored(col, doc, order) {
    const out = { ...doc, [ORDER]: order ?? this.#nextOrder() };
    if (col === 'rooms') out[MEMBERS] = (doc.members ?? []).filter((m) => !m.deleted).map((m) => m.uid);
    return out;
  }

  #read(col, snap) {
    if (!snap.exists) return null;
    const doc = snap.data();
    delete doc[ORDER];
    if (col === 'rooms') delete doc[MEMBERS];
    return doc;
  }

  #events(roomId) {
    return this.db.collection('rooms').doc(checkId(roomId)).collection('events');
  }

  #counter(roomId) {
    return this.db.collection('rooms').doc(checkId(roomId)).collection('meta').doc('events');
  }

  #receipt(id) {
    return this.bucket.file(`receipts/${checkId(id)}`);
  }

  #sorted(snap) {
    return snap.docs.sort((a, b) => (a.get(ORDER) ?? 0) - (b.get(ORDER) ?? 0));
  }

  async get(col, id) {
    if (!validId(id)) return null;
    if (col === 'receipts') {
      try {
        const file = this.#receipt(id);
        const [[data], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
        return { id, roomId: meta.metadata?.roomId, mimeType: meta.contentType, data: data.toString('base64') };
      } catch (e) {
        if (e.code === 404) return null;
        throw e;
      }
    }
    return this.#read(col, await this.db.collection(col).doc(checkId(id)).get());
  }

  async put(col, doc) {
    if (col === 'receipts') {
      await this.#receipt(doc.id).save(Buffer.from(doc.data, 'base64'), {
        resumable: false,
        contentType: doc.mimeType,
        metadata: { metadata: { roomId: doc.roomId } },
      });
      return structuredClone(doc);
    }
    const ref = this.db.collection(col).doc(checkId(doc.id));
    // 덮어써도 처음 넣은 순서는 그대로 둔다(Map.set과 같은 동작)
    await this.db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      tx.set(ref, this.#stored(col, structuredClone(doc), old.get(ORDER)));
    });
    return structuredClone(doc);
  }

  // 없을 때만 넣는다. 트랜잭션이라 동시에 불러도 처음 것 하나만 남고, 나머지는 그것을 돌려받는다
  async putIfAbsent(col, doc) {
    if (col === 'receipts') throw new Error('영수증 사진은 putIfAbsent로 넣지 않아요');
    const ref = this.db.collection(col).doc(checkId(doc.id));
    return this.db.runTransaction(async (tx) => {
      const old = await tx.get(ref);
      if (old.exists) return this.#read(col, old);
      tx.set(ref, this.#stored(col, structuredClone(doc)));
      return structuredClone(doc);
    });
  }

  async delete(col, id) {
    if (!validId(id)) return;
    if (col === 'receipts') return void (await this.#receipt(id).delete({ ignoreNotFound: true }));
    await this.db.collection(col).doc(id).delete();
  }

  // where는 필드 동등 비교만 한다. 동등 조건끼리는 Firestore가 단일 필드 색인을 합쳐 쓰므로 복합 색인이 필요 없다
  async list(col, where = {}) {
    if (col === 'receipts') throw new Error('영수증 사진은 목록으로 읽지 않아요(Cloud Storage에 있어요)');
    let q = this.db.collection(col);
    for (const [k, v] of Object.entries(where)) q = q.where(k, '==', v);
    return this.#sorted(await q.get()).map((s) => this.#read(col, s));
  }

  // uid가 탈퇴하지 않은 멤버인 방. 모든 방을 읽지 않고 _memberUids 색인(array-contains)으로 그 방만 읽는다
  async roomsOf(uid) {
    return this.#sorted(await this.db.collection('rooms').where(MEMBERS, 'array-contains', uid).get()).map((s) => this.#read('rooms', s));
  }

  // seq는 방마다 카운터 문서를 트랜잭션으로 올려 매긴다. 동시에 불러도 1부터 빈틈없이 하나씩
  async appendEvent(roomId, ev) {
    const counter = this.#counter(roomId);
    const events = this.#events(roomId);
    return this.db.runTransaction(async (tx) => {
      const seq = ((await tx.get(counter)).get('seq') ?? 0) + 1;
      const saved = { ...structuredClone(ev), seq, roomId, at: this.now().toISOString() };
      tx.set(counter, { seq });
      tx.create(events.doc(String(seq)), saved);
      return structuredClone(saved);
    }, { maxAttempts: 10 }); // 같은 방에 동시에 몰리면 다시 시도한다. 그래도 안 되면 seq를 건너뛰지 않고 오류를 낸다
  }

  async listEvents(roomId, afterSeq = 0) {
    if (!validId(roomId)) return [];
    const snap = await this.#events(roomId).where('seq', '>', afterSeq).orderBy('seq').get();
    return snap.docs.map((s) => s.data());
  }

  // #2 탈퇴. MemoryStore와 같은 변환(eraseUserSnapshot)을 이 사람이 낀 방의 문서에만 돌리고, 한 트랜잭션으로 쓴다.
  // 트랜잭션 쓰기 수 제한(예전 500개)은 2023-03에 없어졌고 요청 10MiB·270초 제한만 남았다.
  // 영수증 사진은 트랜잭션 밖(Cloud Storage)이라 먼저 지운다. 트랜잭션이 실패해 다시 시도해도 지울 사진을 다시 찾을 수 있게.
  async eraseUser(uid) {
    const roomsQuery = this.db.collection('rooms').where(MEMBERS, 'array-contains', uid);
    for (const room of (await roomsQuery.get()).docs) {
      const mine = await this.db.collection('expenses').where('roomId', '==', room.id).get();
      for (const e of mine.docs) if (e.get('createdBy') === uid || e.get('payer') === uid) await this.delete('receipts', e.id);
    }

    return this.db.runTransaction(async (tx) => {
      const cols = new Map();
      const orders = new Map();
      const events = new Map();
      const keep = (col, snaps) => {
        if (!cols.has(col)) cols.set(col, new Map());
        for (const s of snaps) {
          if (!s.exists) continue;
          cols.get(col).set(s.id, this.#read(col, s));
          orders.set(`${col}/${s.id}`, s.get(ORDER));
        }
      };
      // 트랜잭션은 읽기를 모두 끝낸 뒤에 쓴다
      const rooms = (await tx.get(roomsQuery)).docs;
      keep('rooms', rooms);
      for (const col of ROOM_COLS) cols.set(col, new Map());
      for (const room of rooms) {
        for (const col of ROOM_COLS) keep(col, (await tx.get(this.db.collection(col).where('roomId', '==', room.id))).docs);
        events.set(room.id, (await tx.get(this.#events(room.id).orderBy('seq'))).docs.map((s) => s.data()));
      }
      for (const col of ['users', 'agents']) keep(col, [await tx.get(this.db.collection(col).doc(checkId(uid)))]);
      for (const col of ['locationConsents', 'locationEvidence']) keep(col, (await tx.get(this.db.collection(col).where('uid', '==', uid))).docs);

      const result = eraseUserSnapshot(cols, events, uid, this.now());

      for (const [col, before] of cols) {
        const after = result.cols.get(col);
        for (const id of before.keys()) if (!after.has(id)) tx.delete(this.db.collection(col).doc(id));
        for (const [id, doc] of after) tx.set(this.db.collection(col).doc(checkId(id)), this.#stored(col, doc, orders.get(`${col}/${id}`)));
      }
      for (const [roomId, list] of result.events) {
        for (const ev of list) tx.set(this.#events(roomId).doc(String(ev.seq)), ev);
        tx.set(this.#counter(roomId), { seq: list.at(-1)?.seq ?? 0 });
      }
      return { removedLinks: result.removedLinks };
    });
  }
}

// 서버용. 팀 프로젝트(또는 에뮬레이터)에 연결한다. Auth(#2)와 따로 이름 붙인 앱을 써서 초기화 순서에 묶이지 않는다.
// 자격 증명은 Application Default Credentials(로컬은 gcloud auth application-default login, Cloud Run은 서비스 계정).
export async function createFirestoreStore(env) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('STORE=firestore에는 FIREBASE_PROJECT_ID가 필요해요');
  if (!env.FIREBASE_STORAGE_BUCKET) throw new Error('STORE=firestore에는 영수증 사진을 둘 FIREBASE_STORAGE_BUCKET이 필요해요');
  if (env.NODE_ENV === 'production' && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST)) {
    throw new Error('운영에서는 Firestore·Storage 에뮬레이터를 쓸 수 없어요');
  }
  const { getApps, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');
  const name = 'agent-settlement-store';
  const existing = getApps().find((a) => a.name === name);
  const app = existing ?? initializeApp({ projectId: env.FIREBASE_PROJECT_ID }, name);
  const db = getFirestore(app);
  // 선택 칸(meta?, action? 등)이 undefined로 들어와도 거부하지 않고 빼고 쓴다
  if (!existing) db.settings({ ignoreUndefinedProperties: true });
  return new FirestoreStore({ db, bucket: getStorage(app).bucket(env.FIREBASE_STORAGE_BUCKET) });
}
