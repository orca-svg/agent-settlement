// 한 방에 표시 이름이 같은 사람이 있어도 AI 배분·중재 결과는 모델이 고른 그 사람에게 간다.
// 모델에게는 사람마다 겹치지 않는 표시(같은 이름이면 '김민수(1)'·'김민수(2)')로 묻고, 답은 그 표시로 uid를 찾는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ROOM } from '../public/data.js';
import { allocatePrompt, allocateWithGemini } from '../src/agents/allocate.mjs';
import { mediatePrompt, mediateWithGemini } from '../src/agents/mediate.mjs';
import { cleanLines, lineSchema, memberLabels } from '../src/agents/lines.mjs';

const members = [{ uid: 'u-a', name: '김민수' }, { uid: 'u-b', name: '김민수' }, { uid: 'u-c', name: '이영희' }];
const room = { id: 'r1', members };
const exp = {
  id: 'pub', title: '호프', payer: 'u-c', method: 'card', time: '21:30', present: ['u-a', 'u-b', 'u-c'], split: 'items',
  items: [
    { id: 'beer', time: '20:10', name: '생맥주', qty: 1, unit: 5000, tags: ['술'] },
    { id: 'fries', time: '20:15', name: '감자튀김', qty: 1, unit: 9000, tags: ['나눠 먹는 안주'] },
  ],
};
const memory = { 'u-a': ['맥주를 마셨어요'], 'u-b': ['술을 안 마셔요'], 'u-c': [] };
const enumOf = (schema) => schema.properties.consumers.items.enum;
const labelOf = (uid) => memberLabels(members).get(uid);

test('모델이 고르는 사람 선택지는 이름이 같아도 사람마다 다르다', () => {
  const labels = enumOf(lineSchema(exp, members));
  assert.deepEqual(labels, ['김민수(1)', '김민수(2)', '이영희']);
});

test('이름이 겹치지 않으면 선택지는 이름 그대로다', () => {
  assert.deepEqual(enumOf(lineSchema(exp, DEMO_ROOM.members)), DEMO_ROOM.members.map((m) => m.name));
});

test('붙인 표시가 다른 사람의 실제 이름과 겹치지 않는다', () => {
  const tricky = [{ uid: 'x', name: '김민수(1)' }, ...members];
  const labels = [...memberLabels(tricky).values()];
  assert.equal(new Set(labels).size, tricky.length);
  assert.equal(memberLabels(tricky).get('x'), '김민수(1)');
});

test('cleanLines: 같은 이름의 첫 번째 사람을 고르면 마지막 사람이 아니라 그 사람에게 배정한다', () => {
  const fallback = { beer: { consumers: ['u-a', 'u-b', 'u-c'], confidence: 0.4, reason: '규칙' }, fries: { consumers: ['u-a', 'u-b', 'u-c'], confidence: 0.4, reason: '규칙' } };
  const out = cleanLines(exp, members, [
    { id: 'beer', consumers: [labelOf('u-a')], confidence: 0.9, reason: '기억' },
    { id: 'fries', consumers: [labelOf('u-a'), labelOf('u-b')], confidence: 0.8, reason: '기억' },
  ], fallback, () => exp.present);
  assert.deepEqual(out.beer.consumers, ['u-a']);
  assert.deepEqual(out.fries.consumers, ['u-a', 'u-b']);
});

test('배분 프롬프트의 함께 있던 사람·기억 줄은 선택지와 같은 표시로 사람을 구분한다', () => {
  const { user } = allocatePrompt(exp, room, memory);
  assert.match(user, /함께 있던 사람: 김민수\(1\), 김민수\(2\), 이영희/);
  assert.match(user, /- 김민수\(1\)의 비서: “맥주를 마셨어요”/);
  assert.match(user, /- 김민수\(2\)의 비서: “술을 안 마셔요”/);
});

test('allocateWithGemini: 모델이 선택지에서 고른 사람에게 배정한다', async () => {
  const gemini = { model: 'fake', generate: async (p) => {
    const [first] = enumOf(p.schema.properties.lines.items);
    return { lines: [{ id: 'beer', consumers: [first], confidence: 0.9, reason: '기억' }, { id: 'fries', consumers: enumOf(p.schema.properties.lines.items), confidence: 0.9, reason: '안주' }] };
  } };
  const { alloc, how } = await allocateWithGemini(gemini, exp, room, memory);
  assert.equal(how, 'gemini');
  assert.deepEqual(alloc.beer.consumers, ['u-a']);
  assert.equal(alloc.beer.filled, undefined);
});

test('중재 프롬프트는 이의를 낸 사람을 같은 표시로 부른다', () => {
  const dispute = { by: 'u-b', claim: '맥주는 안 마셨어요', evidence: [] };
  const { user } = mediatePrompt({ exp, room, dispute, memoryByUid: memory });
  assert.match(user, /이의 제기\(김민수\(2\)의 비서\)/);
  assert.match(user, /- 김민수\(1\)의 비서: “맥주를 마셨어요”/);
});

test('mediateWithGemini: 같은 이름 중 모델이 고른 사람에게 다시 나눈다', async () => {
  const dispute = { by: 'u-b', claim: '맥주는 안 마셨어요', evidence: [] };
  const gemini = { model: 'fake', generate: async () => ({ summary: '맥주는 김민수(1)의 몫이에요.', lines: [
    { id: 'beer', consumers: [labelOf('u-a')], confidence: 0.9, reason: '기억', evidenceConflict: false },
    { id: 'fries', consumers: [labelOf('u-a'), labelOf('u-b'), labelOf('u-c')], confidence: 0.9, reason: '안주', evidenceConflict: false },
  ] }) };
  const { alloc } = await mediateWithGemini(gemini, { exp, room, dispute, memoryByUid: memory });
  assert.deepEqual(alloc.beer.consumers, ['u-a']);
});
