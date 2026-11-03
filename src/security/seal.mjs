// 계좌·위치 요약처럼 민감한 값을 저장소에 넣기 전에 잠그고, 꺼낼 때 푸는 자물쇠(#8, #10).
// - AES-256-GCM: 호출마다 무작위 IV라 같은 값도 매번 다르게 잠기고, 인증 태그로 변조를 잡는다.
// - label('컬렉션/문서id/칸')을 AAD로 묶는다. 잠긴 값을 다른 문서·칸에 옮겨 붙이면 풀리지 않는다.
// - 형식: 'enc:v1:' + base64url(iv 12바이트 ‖ tag 16바이트 ‖ 암호문). v1은 나중에 열쇠·방식을 바꿀 때 구분용.
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = 'aes-256-gcm';

export const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

// value는 일반 JSON 값이어야 한다(객체·배열·문자열·숫자·불리언·null). undefined·함수는 잠글 수 없다
export function seal(value, key, label) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string') throw new Error(`잠글 수 없는 값이에요: ${label}`);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(label, 'utf8'));
  const body = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

export function unseal(text, key, label) {
  if (!isSealed(text)) throw new Error(`잠기지 않은 값이에요: ${label}`);
  const raw = Buffer.from(text.slice(PREFIX.length), 'base64url');
  if (raw.length <= IV_LEN + TAG_LEN) throw new Error(`잠긴 값이 망가졌어요: ${label}`);
  try {
    const decipher = crypto.createDecipheriv(ALGO, key, raw.subarray(0, IV_LEN), { authTagLength: TAG_LEN });
    decipher.setAAD(Buffer.from(label, 'utf8'));
    decipher.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_LEN + TAG_LEN)), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch (cause) {
    // 원래 에러를 cause로 남긴다(열쇠 길이 실수 같은 코드 버그를 변조와 구분할 수 있게). 계좌 내용은 들어 있지 않다
    throw new Error(`잠긴 값을 풀 수 없어요(열쇠가 다르거나 값이 바뀌었어요): ${label}`, { cause });
  }
}

// 개발용 열쇠: 코드에 공개되어 있으니 가짜 데이터만 있는 로컬에서만 쓴다
const DEV_KEY = crypto.createHash('sha256').update('agent-settlement-dev-payout-key').digest();

// 열쇠 고르기. PAYOUT_ENC_KEY(base64, 32바이트)가 있으면 그것, 없으면 로컬에서만 개발용 열쇠.
// 이름은 계좌용이지만 위치 요약(#7)도 이 열쇠로 잠근다(배포 설정을 늘리지 않으려고 같은 열쇠를 쓴다).
// 배포(NODE_ENV=production)에서 없으면 에러를 내서 서버가 시작하지 않게 한다(공개된 열쇠로 조용히 돌지 않게)
export function resolvePayoutKey(env = {}, { warn = console.warn } = {}) {
  const raw = String(env.PAYOUT_ENC_KEY ?? '').trim();
  if (raw) {
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('PAYOUT_ENC_KEY는 base64로 32바이트여야 해요');
    return key;
  }
  if (env.NODE_ENV === 'production') throw new Error('PAYOUT_ENC_KEY가 없어요. 배포에서는 Secret Manager로 넣어 주세요');
  warn('[payout] PAYOUT_ENC_KEY가 없어 개발용 열쇠로 계좌·위치 요약을 잠가요. 배포에서는 꼭 설정해야 해요');
  return Buffer.from(DEV_KEY);
}
