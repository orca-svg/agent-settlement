// 토큰 폐기 확인(checkRevoked)은 요청마다 Firebase Auth 서버에 물어 약 0.25초가 든다. 그래서 같은 사람에게는
// 이 시간에 한 번만 묻고, 그 사이에는 서명·만료만 서버 안에서 확인한다. 다른 곳에서 폐기된 토큰은 최대 이만큼 더 통한다.
// 우리 탈퇴는 deletedUsers 표식과 forgetVerified로 바로 막는다. auth마다 따로 둬서 app.mjs와 identify()가 함께 쓴다
const REVOCATION_CHECK_MS = 5 * 60_000;
const revocationChecked = new WeakMap(); // auth → Map(uid → 마지막으로 폐기 여부를 물은 시각)

const checkedOf = (auth) => {
  if (!revocationChecked.has(auth)) revocationChecked.set(auth, new Map());
  return revocationChecked.get(auth);
};

// 서명을 확인하기 전에 uid만 읽는다. 어느 확인을 할지 고르는 데만 쓰고, 신원은 verifyIdToken이 정한다
function unverifiedUid(raw) {
  try { return JSON.parse(Buffer.from(raw.split('.')[1], 'base64url')).sub ?? null; } catch { return null; }
}

// 탈퇴한 사람은 다음 요청에서 다시 폐기 여부를 묻는다(Auth 사용자가 지워졌으니 거부된다)
export function forgetVerified(auth, uid) {
  revocationChecked.get(auth)?.delete(uid);
}

// Production never trusts a uid supplied by the browser. Tests inject the verifier.
export function createIdentity({ auth = null, dev = false, now = Date.now } = {}) {
  return async (req, store, roomId) => {
    let who = null;
    const header = req.headers.authorization;
    if (header) {
      const match = /^Bearer (\S+)$/i.exec(header);
      if (!match || !auth) return null;
      try {
        const checked = checkedOf(auth);
        const uid = unverifiedUid(match[1]);
        const recent = uid != null && now() - (checked.get(uid) ?? -Infinity) < REVOCATION_CHECK_MS;
        const claims = await auth.verifyIdToken(match[1], !recent);
        if (!claims.uid) return null;
        if (!recent) checked.set(claims.uid, now());
        who = { uid: claims.uid, name: claims.name || '사용자', authTime: claims.auth_time };
      } catch { return null; }
    } else if (dev) {
      const uid = String(req.headers['x-demo-user'] || '').trim();
      if (uid) who = { uid, name: uid };
    }
    if (!who || !roomId) return who;
    const room = await store.get('rooms', roomId);
    const member = room?.members.find((m) => m.uid === who.uid);
    return member && !member.deleted && !member.left ? { ...who, name: member.name } : null;
  };
}
// Keep the team's public identify(req, store, roomId) signature. Only the server
// injects identityContext; request headers cannot set this internal property.
export const identify = (req, store, roomId) => createIdentity(req.identityContext || {})(req, store, roomId);
