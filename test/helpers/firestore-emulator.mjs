// FirestoreStore 테스트용: 에뮬레이터에 붙은 저장소를 만든다. 부를 때마다 새 데이터베이스(빈 상태)를 쓴다.
// 진짜 프로젝트·자격 증명 없이 돈다. FIRESTORE_EMULATOR_HOST·FIREBASE_STORAGE_EMULATOR_HOST가 있어야 한다.
import { randomUUID } from 'node:crypto';
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
