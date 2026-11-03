import { randomUUID } from 'node:crypto';

// Keep shared monetary amounts and ordering, but unlink them from the account.
// Each room receives a different anonymous identity; there is no reverse map.
// MemoryStore publishes the transformed snapshot atomically. Persistent stores
// must implement the same operation transactionally before enabling deletion.
export function eraseUserSnapshot(cols, events, uid, now = new Date()) {
  const next = structuredClone(cols);
  const logs = structuredClone(events);
  const removedLinks = [];
  for (const col of ['users', 'agents']) next.get(col)?.delete(uid);
  for (const col of ['locationConsents', 'locationEvidence']) {
    for (const [id, doc] of next.get(col) || []) if (doc.uid === uid) next.get(col).delete(id);
  }
  for (const [roomId, room] of next.get('rooms') || []) {
    if (!room.members.some(m => m.uid === uid)) continue;
    const anonymous = `deleted-${randomUUID()}`;
    const reference = value => {
      if (typeof value === 'string') return value === uid ? anonymous : value.split(':').map(part => part === uid ? anonymous : part).join(':');
      if (Array.isArray(value)) return value.map(reference);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k === uid ? anonymous : k, reference(v)]));
      return value;
    };
    const savedRoom = reference(room);
    savedRoom.members = savedRoom.members.map(m => m.uid === anonymous ? { uid: anonymous, name: '탈퇴한 사용자', deleted: true } : m);
    next.get('rooms').set(roomId, savedRoom);
    for (const col of ['expenses', 'invoices', 'disputes', 'transfers', 'receipts']) {
      for (const [id, original] of [...next.get(col) || []]) {
        if (original.roomId !== roomId) continue;
        const saved = reference(original);
        if (col === 'expenses') {
          if (original.createdBy === uid || original.payer === uid) {
            next.get('receipts')?.delete(original.id);
            saved.hasReceipt = false;
            saved.title = '탈퇴한 사용자의 지출';
            if (saved.items) saved.items = saved.items.map(it => ({ ...it, name: '주문 항목' }));
          }
          // Allocation explanations can quote private agent memories.
          for (const line of Object.values(saved.alloc || {})) line.reason = '공유 정산 기록';
        }
        if (col === 'invoices') saved.reasons = ['공유 정산 기록'];
        if (col === 'disputes') {
          saved.claim = '개인정보 삭제 후 남긴 정산 이의';
          saved.evidence = [];
          if (saved.status !== 'resolved') { saved.status = 'open'; saved.agreedBy = []; }
          delete saved.proposal;
        }
        if (col === 'transfers' && (original.from === uid || original.to === uid)) {
          if (original.link) removedLinks.push(original.link);
          saved.link = null;
          saved.fallback = null;
          delete saved.qr;
          delete saved.qrExpiresAt;
        }
        next.get(col).delete(id);
        next.get(col).set(saved.id, saved);
      }
    }
    // Event text/meta can contain copied names, memories, account details or
    // location. Retain sequence/time/actions without retaining those copies.
    logs.set(roomId, (logs.get(roomId) || []).map(ev => {
      const out = reference(ev);
      return { seq: out.seq, roomId, at: out.at, from: out.from, to: out.to,
        kind: out.kind, text: '개인정보 삭제 후 남긴 정산 기록', ...(out.action ? { action: out.action } : {}) };
    }));
    const roomLog = logs.get(roomId);
    roomLog.push({ seq: (roomLog.at(-1)?.seq || 0) + 1, roomId, at: now.toISOString(), from: 'system', to: 'all', kind: 'account_erased', text: '탈퇴한 참여자의 개인정보를 삭제하고 정산 기록을 익명 처리했어요.' });
  }
  return { cols: next, events: logs, removedLinks };
}
