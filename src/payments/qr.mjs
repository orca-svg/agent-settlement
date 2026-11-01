// 데스크톱 QR 핸드오프용 서명 토큰(#8 보안 수정).
// 계좌번호·금액이 든 토스 링크를 외부 QR 이미지 서비스에 그대로 넘기면 그 서비스가 민감 정보를 보게 된다.
// 그래서 QR에는 이 토큰(= 서버로 돌아오는 짧은 수명의 서명된 포인터)만 담고, 실제 링크는 /api/qr/:token에서만 풀린다.
import crypto from 'node:crypto';

const SECRET = crypto.randomBytes(32); // 서버가 켜져 있는 동안만 유효하면 충분하다(토큰 수명 15분)
const TTL_MS = 15 * 60_000;

const sign = (body) => crypto.createHmac('sha256', SECRET).update(body).digest('base64url');

export function signQrToken(link, { now = Date.now } = {}) {
  const body = Buffer.from(JSON.stringify({ link, exp: now() + TTL_MS }), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifyQrToken(token, { now = Date.now } = {}) {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { link, exp } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof link !== 'string' || !exp || now() > exp) return null;
    return link;
  } catch {
    return null;
  }
}
