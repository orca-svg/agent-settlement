// FirestoreStore 테스트용: 에뮬레이터에 붙은 저장소를 만든다. 부를 때마다 새 데이터베이스(빈 상태)를 쓴다.
// 진짜 프로젝트·자격 증명 없이 돈다. FIRESTORE_EMULATOR_HOST·FIREBASE_STORAGE_EMULATOR_HOST가 있어야 한다.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FirestoreStore } from '../../src/store/firestore.mjs';

export const PROJECT = 'demo-agent-settlement';
export const BUCKET = `${PROJECT}.appspot.com`;
const app = getApps().find((a) => a.name === 'store-test') ?? initializeApp({ projectId: PROJECT }, 'store-test');

export function emulatorStore(opts = {}, databaseId = `t-${randomUUID().slice(0, 8)}`) {
  const db = getFirestore(app, databaseId);
  db.settings({ ignoreUndefinedProperties: true });
  return Object.assign(new FirestoreStore({ db, bucket: getStorage(app).bucket(BUCKET), ...opts }), { databaseId });
}

// 보안 규칙 확인용: 에뮬레이터는 서명 없는 토큰을 받아 request.auth로 쓴다
export function mockIdToken(uid) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, sub: uid, user_id: uid, iat: now, exp: now + 3600, auth_time: now, firebase: { sign_in_provider: 'google.com', identities: {} } })}.`;
}

// 보안 규칙 확인용(#10): 화면(브라우저)처럼 REST로 요청하고 HTTP 상태만 돌려준다. uid가 null이면 비로그인.
// 규칙은 (default) 데이터베이스에서 검사되므로, 이 길로 보는 데이터도 emulatorStore({}, '(default)')로 심는다.
export function rulesClient(host = process.env.FIRESTORE_EMULATOR_HOST) {
  const docs = `http://${host}/v1/projects/${PROJECT}/databases/(default)/documents`;
  const headers = (uid) => ({ 'content-type': 'application/json', ...(uid ? { authorization: `Bearer ${mockIdToken(uid)}` } : {}) });
  // 본문을 다 읽어야 연결이 풀린다
  const status = async (res) => { await res.arrayBuffer(); return res.status; };
  return {
    async loadRules() {
      const content = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
      const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}:securityRules`, {
        method: 'PUT',
        body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
      });
      if (res.status !== 200) throw new Error(`규칙을 올리지 못했어요: ${res.status} ${await res.text()}`);
    },
    get: async (path, uid) => status(await fetch(`${docs}/${path}`, { headers: headers(uid) })),
    // 목록 조회. parent가 ''이면 최상위 컬렉션, 'rooms/ra'이면 그 아래 컬렉션
    async query(parent, structuredQuery, uid) {
      const res = await fetch(`${docs}${parent ? `/${parent}` : ''}:runQuery`, { method: 'POST', headers: headers(uid), body: JSON.stringify({ structuredQuery }) });
      // runQuery는 결과를 배열로 흘려보내는 요청이라, 거절이 HTTP 상태 대신 배열 안의 error로 올 수도 있다
      const body = await res.json().catch(() => null);
      const error = Array.isArray(body) ? body.find((r) => r.error)?.error : null;
      return error ? error.code : res.status;
    },
    // fields는 평범한 객체. mask를 주면 그 칸만 고친다(updateMask)
    async write(path, uid, fields, mask) {
      const qs = mask ? `?${mask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')}` : '';
      return status(await fetch(`${docs}/${path}${qs}`, { method: 'PATCH', headers: headers(uid), body: JSON.stringify({ fields: toFields(fields) }) }));
    },
    remove: async (path, uid) => status(await fetch(`${docs}/${path}`, { method: 'DELETE', headers: headers(uid) })),
  };
}

// rulesClient.write용: 평범한 값 → Firestore REST 값. 테스트에 필요한 것(문자열, 정수, 문자열 배열)만 받는다
function toValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return { arrayValue: { values: v.map(toValue) } };
  throw new Error(`rulesClient.write가 모르는 값이에요: ${JSON.stringify(v)}`);
}
const toFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, toValue(v)]));
