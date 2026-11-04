// 데모 진행자: 철수·영희·민수가 할 일을 대신 한다. 방문자('나')가 무엇을 하든 저장소의 지금 상태를 보고 다음 일을 고른다.
// 그래서 페이지를 옮기거나 새로 고쳐도(타이머가 사라져도) 다음 요청 때 이어서 한다. 친구의 일은 모두 실제 API를 거친다
// (그 사람의 신원으로 부르므로 비서 규칙·기록·검증이 실제 서비스와 같다).
import { isForeign, active } from '../core.js';
import { kstDay } from '#src/rooms/fx.mjs';
import { isFlagged, awaitsSender } from '#src/actions.mjs';
import { FRIENDS, friendOf, friendExpenses } from './scenario.js';

// 사람이 하는 것처럼 보이게 기다리는 시간(ms)
const PACE = { join: 1400, agree: 900, expense: 900, answer: 1800, mediate: 1500, agreeProposal: 2600, send: 2200, confirm: 2600 };

export function createDirector({ store, call, schedule, clock }) {
  const pending = new Set(); // 예약해 둔 일의 열쇠. 같은 일을 두 번 예약하지 않는다
  const failed = new Set(); // 실패한 일은 다시 하지 않는다(같은 오류로 끝없이 되풀이하지 않게). 방문자가 화면에서 직접 이어 갈 수 있다
  let running = 0;
  const waiters = [];

  const roomPath = (room, rest = '') => `/api/rooms/${encodeURIComponent(room.id)}${rest}`;
  const isFriend = (uid) => Boolean(friendOf(uid));

  // key의 일을 delay 뒤에 한다. 하기 직전에 아직 할 일인지 다시 본다(그사이 방문자가 바꿨을 수 있다)
  function later(key, delay, still, work) {
    if (pending.has(key) || failed.has(key)) return;
    pending.add(key);
    running += 1;
    schedule(async () => {
      try {
        if (await still()) await work();
      } catch (e) {
        failed.add(key);
        console.warn('[demo] 진행자 일 실패:', key, e.message);
      } finally {
        pending.delete(key);
        await nudge().catch(() => {});
        running -= 1;
        if (!running) for (const w of waiters.splice(0)) w();
      }
    }, delay);
  }

  async function act(as, method, path, body) {
    const out = await call(method, path, body, as);
    if (out.status >= 400) throw new Error(out.body?.error || `HTTP ${out.status}`);
    return out.body;
  }

  // 지금 상태에서 친구들이 할 일을 모두 예약한다
  async function nudge() {
    for (const room of (await store.roomsOf('me')).filter((r) => r.status !== 'done')) await plan(room);
  }

  async function plan(room) {
    const fresh = () => store.get('rooms', room.id);
    const started = room.status === 'settling' || room.status === 'done';
    const here = (r, uid) => r.members.some((m) => m.uid === uid && active(m));

    // 1. 초대 링크가 생기면 셋이 차례로 들어와 환율 정책에 동의한다
    const invite = await store.get('invites', room.id);
    if (invite && !started) {
      FRIENDS.forEach((f, i) => {
        if (here(room, f.uid)) return;
        later(`join:${room.id}:${f.uid}`, PACE.join * (i + 1), async () => !here(await fresh(), f.uid), () =>
          act(f.uid, 'POST', `/api/invites/${encodeURIComponent(invite.token)}/join`, { agree: true }));
      });
    }
    if (isForeign(room) && !started) {
      for (const f of FRIENDS.filter((x) => here(room, x.uid) && !room.policyAgreedBy.includes(x.uid))) {
        later(`policy:${room.id}:${f.uid}:${room.policy}`, PACE.agree, async () => {
          const r = await fresh();
          return here(r, f.uid) && !r.policyAgreedBy.includes(f.uid) && r.status !== 'settling';
        }, () => act(f.uid, 'POST', roomPath(room, '/policy/agree'), {}));
      }
    }

    // 2. 셋이 모두 들어오면 각자의 비서가 여행 지출을 남긴다(이미 남긴 것은 건너뛴다)
    const expenses = await store.list('expenses', { roomId: room.id });
    const members = room.members.filter(active).map((m) => m.uid);
    const has = (list, by, title) => list.some((e) => e.createdBy === by && e.title === title);
    if (FRIENDS.every((f) => members.includes(f.uid)) && !started) {
      friendExpenses(room, members, kstDay(clock())).forEach(({ key, by, input }, i) => {
        if (has(expenses, by, input.title)) return;
        later(`expense:${room.id}:${key}`, PACE.expense * (i + 1), async () => {
          const r = await fresh();
          return r.status !== 'settling' && r.status !== 'done' && !has(await store.list('expenses', { roomId: room.id }), by, input.title);
        }, () => act(by, 'POST', roomPath(room, '/expenses'), { expense: input }));
      });
    }

    // 3. 친구가 남긴 영수증 줄은 그 친구의 비서가 나누고, 근거가 약해 짐작한 줄은 그대로 확인한다
    for (const e of expenses.filter((x) => isFriend(x.createdBy) && x.items?.length && x.split === 'items')) {
      const path = roomPath(room, `/expenses/${encodeURIComponent(e.id)}`);
      if (!e.alloc) {
        later(`allocate:${e.id}`, PACE.expense, async () => !(await store.get('expenses', e.id))?.alloc, () => act(e.createdBy, 'POST', `${path}/allocate`, {}));
      } else if (e.items.some((it) => isFlagged(e.alloc[it.id]))) {
        later(`guesses:${e.id}`, PACE.expense, async () => {
          const now = await store.get('expenses', e.id);
          return Boolean(now?.alloc) && now.items.some((it) => isFlagged(now.alloc[it.id]));
        }, () => act(e.createdBy, 'POST', `${path}/confirm-guesses`, {}));
      }
    }

    // 4. 비서가 친구에게 물은 청구서는 친구가 확인하고 받는다
    for (const inv of (await store.list('invoices', { roomId: room.id })).filter((i) => i.status === 'asked' && isFriend(i.to) && i.version === room.version)) {
      later(`answer:${inv.id}`, PACE.answer, async () => (await store.get('invoices', inv.id))?.status === 'asked', () =>
        act(inv.to, 'POST', roomPath(room, `/invoices/${encodeURIComponent(inv.id)}/answer`), { decision: 'accept' }));
    }

    // 5. 친구가 낸 지출에 온 이의: 중재를 맡기고, 중재안이 나오면 동의한다
    for (const d of await store.list('disputes', { roomId: room.id })) {
      const exp = expenses.find((e) => e.id === d.expenseId);
      if (!exp) continue;
      const path = roomPath(room, `/disputes/${encodeURIComponent(d.id)}`);
      if (d.status === 'open' && isFriend(exp.payer)) {
        later(`mediate:${d.id}`, PACE.mediate, async () => (await store.get('disputes', d.id))?.status === 'open', () => act(exp.payer, 'POST', `${path}/mediate`, {}));
      }
      if (d.status === 'proposed') {
        for (const uid of [...new Set([exp.payer, d.by])].filter((u) => isFriend(u) && !d.agreedBy.includes(u))) {
          later(`agree:${d.id}:${uid}`, PACE.agreeProposal, async () => {
            const now = await store.get('disputes', d.id);
            return now?.status === 'proposed' && !now.agreedBy.includes(uid);
          }, () => act(uid, 'POST', `${path}/agree`, {}));
        }
      }
    }

    // 6. 송금: 친구가 보낼 돈은 송금 앱을 열고 보냈다고 하고, 친구가 받을 돈은 들어오면 받았다고 한다
    for (const t of (await store.list('transfers', { roomId: room.id })).filter((x) => x.version === room.version)) {
      const path = roomPath(room, `/transfers/${encodeURIComponent(t.id)}`);
      if (isFriend(t.from) && awaitsSender(t)) {
        later(`send:${t.id}`, PACE.send, async () => awaitsSender(await store.get('transfers', t.id)), async () => {
          if (['scheduled', 'due'].includes(t.status)) await act(t.from, 'POST', `${path}/approve`, {});
          await act(t.from, 'POST', `${path}/sent`, {});
        });
      }
      if (isFriend(t.to) && t.status === 'sent' && !t.notReceivedAt) {
        later(`confirm:${t.id}`, PACE.confirm, async () => {
          const now = await store.get('transfers', t.id);
          return now?.status === 'sent' && !now.notReceivedAt;
        }, () => act(t.to, 'POST', `${path}/confirm`, {}));
      }
    }
  }

  return {
    nudge: () => nudge().catch((e) => console.warn('[demo] 진행자:', e.message)),
    // 예약한 일이 모두 끝날 때까지 기다린다(테스트용)
    idle: () => (running ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve()),
  };
}
