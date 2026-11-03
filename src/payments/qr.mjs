// 데스크톱 QR 핸드오프용 토큰(#8 보안 수정).
// 계좌번호·금액이 든 토스 링크를 외부 QR 이미지 서비스에 그대로 넘기면 그 서비스가 민감 정보를 보게 된다.
// 그래서 QR에는 추측할 수 없는 무작위 토큰만 담고, 실제 링크는 서버 메모리(token → link)에만 둔다.
// 토큰 자체에 링크를 담아 서명만 하면(이전 방식) base64만 풀어도 계좌가 보이므로 쓰지 않는다.
import crypto from 'node:crypto';

// 외부 QR 이미지 서비스가 토큰 주소를 보므로 짧게 둔다. 화면이 만료 전에 새로 받는다(public/ui.js qrIsFresh)
export const QR_TTL_MS = 15 * 60_000;
const tokens = new Map(); // token → { link, exp }

function sweep(now) {
  for (const [token, entry] of tokens) if (entry.exp <= now) tokens.delete(token);
}

export function signQrToken(link, { now = Date.now } = {}) {
  sweep(now());
  const token = crypto.randomBytes(16).toString('base64url');
  tokens.set(token, { link, exp: now() + QR_TTL_MS });
  return token;
}

// 받는 계좌가 바뀌면 옛 계좌를 가리키는 QR을 바로 죽인다(이미 찍어 둔 QR로 옛 계좌에 보내지 않게)
export function revokeQrLink(link) {
  for (const [token, entry] of tokens) if (entry.link === link) tokens.delete(token);
}

export function verifyQrToken(token, { now = Date.now } = {}) {
  const entry = tokens.get(String(token ?? ''));
  if (!entry) return null;
  if (entry.exp <= now()) {
    tokens.delete(token);
    return null;
  }
  return entry.link;
}
