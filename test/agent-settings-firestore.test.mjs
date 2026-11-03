// #5를 FirestoreStore 위에서: 비서 문서가 그대로 저장되고, 계좌는 잠기고, 계좌를 바꾸면 여러 방의 송금이 함께 바뀌는지.
// 에뮬레이터가 있을 때만 돈다(npm run test:emulators).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptedStore } from '../src/store/encrypted.mjs';
import { seedDemoRoom } from '../src/dev/seed.mjs';
import { createOrchestrator } from '../src/agents/orchestrator.mjs';
import { createAgentSettings } from '../src/agents/settings.mjs';
import { roomMemory } from '../src/agents/memory.mjs';

const skip = !(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST) && 'Firestore·Storage 에뮬레이터 없음';
const load = () => import('./helpers/firestore-emulator.mjs');

test('Firestore: 규칙·기억·방별 공유·변경 기록이 저장되고 계좌만 잠긴다', { skip }, async () => {
  const { emulatorStore } = await load();
  const inner = emulatorStore();
  const store = encryptedStore(inner, Buffer.alloc(32, 5));
  const settings = createAgentSettings({ store, clock: () => new Date('2026-11-10T03:00:00Z') });
  await settings.finishOnboarding('u1', { rules: { autoAccept: 30_000, sendWhen: { payday: 10 }, onDispute: 'mediator', notify: 'all' } });
  await settings.addMemory('u1', '술을 마시지 않아요');
  await settings.shareMemory('u1', 'room-a', '술을 마시지 않아요', false);
  const v = await settings.get('u1');
  assert.deepEqual(v.rules, { autoAccept: 30_000, sendWhen: { payday: 10 }, onDispute: 'mediator', notify: 'all' });
  assert.deepEqual(v.memoryHidden, { 'room-a': ['술을 마시지 않아요'] });
  assert.equal(v.ruleHistory.length, 4);
  const room = (id) => ({ id, members: [{ uid: 'u1', name: '가' }] });
  assert.deepEqual((await roomMemory(store, room('room-a'))).u1, []);
  assert.deepEqual((await roomMemory(store, room('room-b'))).u1, ['술을 마시지 않아요']);
  await settings.deleteMemory('u1', '술을 마시지 않아요');
  assert.deepEqual((await settings.get('u1')).memory, []);
});

test('Firestore: 직접 보내기 송금은 알리지 않고, 계좌를 바꾸면 두 방의 대기 송금이 바뀌며 저장본은 잠겨 있다', { skip }, async () => {
  const { emulatorStore } = await load();
  const inner = emulatorStore();
  const store = encryptedStore(inner, Buffer.alloc(32, 6));
  await seedDemoRoom(store, { id: 'fs-a' });
  await seedDemoRoom(store, { id: 'fs-b' });
  for (const uid of ['me', 'cs', 'yh', 'ms']) {
    const a = await store.get('agents', uid);
    await store.put('agents', { ...a, rules: { autoAccept: 1_000_000, sendWhen: uid === 'ms' ? 'manual' : 'now', onDispute: 'ask' } });
  }
  const orch = createOrchestrator({ store, clock: () => new Date('2026-11-10T03:00:00Z') });
  await orch.sendInvoices('fs-a', 'me');
  await orch.sendInvoices('fs-b', 'me');
  const ms = (await store.list('transfers', { roomId: 'fs-a' })).find((t) => t.from === 'ms');
  assert.equal(ms.remindAt, null, 'Firestore에도 null로 남는다');
  await orch.tick();
  assert.equal((await store.get('transfers', ms.id)).status, 'scheduled');
  await orch.setPayout('fs-a', 'me', { bank: '토스뱅크', accountNo: '1000-7777-8888', holder: '나' });
  for (const id of ['fs-a', 'fs-b']) {
    const t = (await store.list('transfers', { roomId: id })).find((x) => x.from === 'ms' && x.to === 'me');
    assert.match(t.link, /accountNo=100077778888/, id);
  }
  const raw = JSON.stringify([await inner.get('agents', 'me'), await inner.list('transfers', { to: 'me' })]);
  assert.ok(!raw.includes('100077778888') && !raw.includes('1000-7777-8888'));
});
