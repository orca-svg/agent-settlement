// 저장소를 읽고 고쳐 쓰는 요청이 서로 끼어들지 않게 줄을 세운다(MemoryStore에는 트랜잭션이 없다).
// 한 방의 일은 그 방의 줄에만 서므로, 한 방의 느린 Gemini 호출이 다른 방을 붙잡지 않는다.
// 탈퇴·프로필 변경·주기 작업처럼 여러 방에 걸친 일은 진행 중인 방의 일이 모두 끝난 뒤 혼자 돌고,
// 그 뒤에 온 방의 일은 그것이 끝나기를 기다린다. 그래서 탈퇴·철회가 진행 중인 AI 결과와 엉키지 않는다.
// 서버 한 대 안에서만 맞는 보장이다. 여러 인스턴스에서는 #3 저장소가 트랜잭션으로 같은 보장을 해야 한다.
export function createStateLocks() {
  let all = Promise.resolve(); // 마지막으로 줄에 선 '여러 방' 일
  const rooms = new Map(); // 방마다 마지막으로 줄에 선 일
  const running = new Set(); // 아직 끝나지 않은 방의 일
  const settled = (p) => p.then(() => {}, () => {});

  function room(id, fn) {
    const result = Promise.all([all, rooms.get(id)]).then(fn);
    const done = settled(result);
    rooms.set(id, done);
    running.add(done);
    done.then(() => {
      running.delete(done);
      if (rooms.get(id) === done) rooms.delete(id);
    });
    return result;
  }

  function global(fn) {
    const result = Promise.all([all, ...running]).then(fn);
    all = settled(result);
    return result;
  }

  return { room, global };
}
