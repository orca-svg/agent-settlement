// Production never trusts a uid supplied by the browser. Tests inject the verifier.
export function createIdentity({ auth = null, dev = false } = {}) {
  return async (req, store, roomId) => {
    let who = null;
    const header = req.headers.authorization;
    if (header) {
      const match = /^Bearer (\S+)$/i.exec(header);
      if (!match || !auth) return null;
      try {
        const claims = await auth.verifyIdToken(match[1], true);
        if (!claims.uid) return null;
        who = { uid: claims.uid, name: claims.name || '사용자', authTime: claims.auth_time };
      } catch { return null; }
    } else if (dev) {
      const uid = String(req.headers['x-demo-user'] || '').trim();
      if (uid) who = { uid, name: uid };
    }
    if (!who || !roomId) return who;
    const room = await store.get('rooms', roomId);
    const member = room?.members.find((m) => m.uid === who.uid);
    return member && !member.deleted ? { ...who, name: member.name } : null;
  };
}
// Keep the team's public identify(req, store, roomId) signature. Only the server
// injects identityContext; request headers cannot set this internal property.
export const identify = (req, store, roomId) => createIdentity(req.identityContext || {})(req, store, roomId);
