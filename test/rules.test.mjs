// 비서의 규칙 판단: 청구서를 받았을 때 수락할지, 주인에게 물을지, 이의를 낼지. 그리고 언제 보낼지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInvoice, nextSendAt } from '../src/agents/rules.mjs';
import { evidenceFor } from '../src/agents/evidence.mjs';

const settings = (autoAccept, onDispute = 'ask') => ({ rules: { autoAccept, sendWhen: 'now', onDispute } });
const leftAt = [{ kind: 'left_at', time: '22:55', summary: '22:55 단톡방 메시지 “먼저 들어갈게”' }];

test('받을 돈이 있거나 0원이면 수락', () => {
  assert.deepEqual(evaluateInvoice({ invoice: { net: 1200 }, settings: settings(0), evidence: [] }), { decision: 'accept', reasons: ['받을 돈이 있어요'] });
  assert.deepEqual(evaluateInvoice({ invoice: { net: 0 }, settings: settings(0), evidence: [] }), { decision: 'accept', reasons: ['정산할 금액이 없어요'] });
});

test('자동 수락 한도 안이면 수락, 넘으면 주인에게 묻는다', () => {
  assert.deepEqual(evaluateInvoice({ invoice: { net: -150000 }, settings: settings(150000), evidence: [] }), { decision: 'accept', reasons: ['자동 수락 한도 안이에요'] });
  assert.deepEqual(evaluateInvoice({ invoice: { net: -50001 }, settings: settings(50000), evidence: [] }), { decision: 'ask', reasons: ['자동 수락 한도를 넘어서 주인에게 물어요'] });
});

test('근거가 있고 규칙이 evidence면 이의를 낸다', () => {
  assert.deepEqual(evaluateInvoice({ invoice: { net: -10000 }, settings: settings(50000, 'evidence'), evidence: leftAt }), { decision: 'dispute', reasons: ['22:55 단톡방 메시지 “먼저 들어갈게”'] });
});

test('근거가 있어도 규칙이 ask면 한도대로 판단한다', () => {
  assert.equal(evaluateInvoice({ invoice: { net: -10000 }, settings: settings(50000, 'ask'), evidence: leftAt }).decision, 'accept');
  assert.equal(evaluateInvoice({ invoice: { net: -90000 }, settings: settings(50000, 'ask'), evidence: leftAt }).decision, 'ask');
});

test('nextSendAt: 바로면 지금', () => {
  assert.equal(nextSendAt(new Date('2026-11-01T03:00:00Z'), 'now'), '2026-11-01T03:00:00.000Z');
});

test('nextSendAt: 월급날이면 다음 그날 09:00 KST', () => {
  assert.equal(nextSendAt(new Date('2026-11-01T03:00:00Z'), { payday: 25 }), '2026-11-25T00:00:00.000Z');
  // 25일 08:59 KST면 오늘, 10:00 KST면 다음 달
  assert.equal(nextSendAt(new Date('2026-11-24T23:59:00Z'), { payday: 25 }), '2026-11-25T00:00:00.000Z');
  assert.equal(nextSendAt(new Date('2026-11-25T01:00:00Z'), { payday: 25 }), '2026-12-25T00:00:00.000Z');
  // 12월 25일 뒤면 해를 넘긴다
  assert.equal(nextSendAt(new Date('2026-12-26T00:00:00Z'), { payday: 25 }), '2027-01-25T00:00:00.000Z');
});

test('nextSendAt: 그달에 없는 날짜면 그달 마지막 날', () => {
  assert.equal(nextSendAt(new Date('2026-11-01T03:00:00Z'), { payday: 31 }), '2026-11-30T00:00:00.000Z');
});

test('evidenceFor: 데모 방의 2차 바에서 민수만 떠난 시각 근거가 있다', async () => {
  const room = { id: 'demo-ab12' };
  const bar = { id: 'demo-ab12-bar' };
  const ev = await evidenceFor('ms', bar, room);
  assert.deepEqual(ev.map((e) => [e.kind, e.time ?? null]), [['left_at', '22:55'], ['text', null]]);
  assert.deepEqual(await evidenceFor('cs', bar, room), []);
  assert.deepEqual(await evidenceFor('ms', { id: 'trip-bar' }, { id: 'trip' }), []);
});
