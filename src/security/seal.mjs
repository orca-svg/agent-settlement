// 계좌처럼 민감한 값을 저장소에 넣기 전에 잠그고, 꺼낼 때 푸는 자물쇠(#8, #10).
// - AES-256-GCM: 호출마다 무작위 IV라 같은 값도 매번 다르게 잠기고, 인증 태그로 변조를 잡는다.
// - label('컬렉션/문서id/칸')을 AAD로 묶는다. 잠긴 값을 다른 문서·칸에 옮겨 붙이면 풀리지 않는다.
// - 형식: 'enc:v1:' + base64url(iv 12바이트 ‖ tag 16바이트 ‖ 암호문). v1은 나중에 열쇠·방식을 바꿀 때 구분용.
import crypto from 'node:crypto';

const PREFIX = 'enc:v1:';
const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = 'aes-256-gcm';

export const isSealed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

export function seal(value, key, label) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(label, 'utf8'));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
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
  } catch {
    throw new Error(`잠긴 값을 풀 수 없어요(열쇠가 다르거나 값이 바뀌었어요): ${label}`);
  }
}
