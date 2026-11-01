// 누가 요청했는지 정한다. 지금은 개발용 헤더(x-demo-user)를 믿는다.
// #2 로그인에서 이 함수만 Firebase ID 토큰 검증으로 바꾸면 나머지 서버 코드는 그대로 쓸 수 있다.
// roomId를 주면 그 방의 멤버일 때만 { uid, name }, 아니면 null.
export async function identify(req, store, roomId) {
  const uid = String(req.headers['x-demo-user'] || '').trim();
  if (!uid) return null;
  if (!roomId) return { uid, name: uid };
  const room = await store.get('rooms', roomId);
  const member = room?.members.find((m) => m.uid === uid);
  return member ? { uid: member.uid, name: member.name } : null;
}
