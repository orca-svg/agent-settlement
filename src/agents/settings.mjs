// 개인 비서 설정(#5): 기억, 규칙, 규칙 변경 기록, 처음 설정. agents 문서를 읽고 쓰는 곳은 여기와 orchestrator.setPayout뿐이다.
// 판단은 rules.mjs, 저장한 규칙이 이미 잡힌 송금에 미치는 영향은 orchestrator가 맡는다.
import { HttpError, readJson } from '../http.mjs';
import { DEFAULT_RULES, MEMORY_LIMITS, MEMORY_MAX_CHARS, AUTO_ACCEPT_MAX, ON_DISPUTE, NOTIFY, RULE_FIELDS, ruleChangeText } from '../../public/agent-rules.js';
import { sharedMemory } from './memory.mjs';

const HISTORY_MAX = 50;

const validAutoAccept = (v) => Number.isSafeInteger(v) && v >= 0 && v <= AUTO_ACCEPT_MAX;
const validSendWhen = (v) => v === 'now' || v === 'manual' || (Number.isInteger(v?.payday) && v.payday >= 1 && v.payday <= 31);
const CHECKS = {
  autoAccept: [validAutoAccept, `자동 수락 한도는 0원에서 ${AUTO_ACCEPT_MAX.toLocaleString('ko-KR')}원 사이의 정수로 정해 주세요`],
  sendWhen: [validSendWhen, '보낼 시기는 바로, 매달 1~31일, 직접 중에서 골라 주세요'],
  onDispute: [(v) => Object.hasOwn(ON_DISPUTE, v), '이의 처리 방법을 골라 주세요'],
  notify: [(v) => Object.hasOwn(NOTIFY, v), '알림 수준을 골라 주세요'],
};

// 저장된 값이 망가졌으면 비서가 더 조심하는 쪽(기본값)으로 읽는다. 한도가 이상하면 0이라 모든 청구서를 묻는다
export function normalizeRules(rules) {
  return Object.fromEntries(RULE_FIELDS.map((f) => [f, CHECKS[f][0](rules?.[f]) ? rules[f] : DEFAULT_RULES[f]]));
}

export function normalizeSettings(doc, uid) {
  return {
    ...doc,
    id: uid,
    uid,
    plan: doc?.plan ?? 'free',
    memory: Array.isArray(doc?.memory) ? doc.memory : [],
    memoryHidden: doc?.memoryHidden ?? {},
    rules: normalizeRules(doc?.rules),
    ruleHistory: doc?.ruleHistory ?? [],
    payout: doc?.payout ?? null,
    onboardedAt: doc?.onboardedAt ?? null,
  };
}

export const memoryLimit = (doc) => MEMORY_LIMITS[doc.plan] ?? MEMORY_LIMITS.free;

function cleanText(text) {
  // eslint-disable-next-line no-control-regex
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) throw new HttpError(400, '기억을 적어 주세요');
  if (s.length > MEMORY_MAX_CHARS) throw new HttpError(400, `기억은 ${MEMORY_MAX_CHARS}자까지 쓸 수 있어요`);
  return s;
}

export function createAgentSettings({ store, clock = () => new Date(), orchestrator }) {
  const read = async (uid) => normalizeSettings(await store.get('agents', uid), uid);
  // 본인에게만 내려가는 모양. 계좌도 그대로 들어 있으니 다른 사람에게 보내는 응답에 쓰지 않는다
  const view = (doc) => ({ ...doc, memoryLimit: memoryLimit(doc) });
  const saved = async (doc) => view(await store.put('agents', doc));

  function withRules(doc, input) {
    const rules = { ...doc.rules };
    const history = [...doc.ruleHistory];
    const at = clock().toISOString();
    for (const field of RULE_FIELDS.filter((f) => input?.[f] !== undefined)) {
      const [valid, message] = CHECKS[field];
      if (!valid(input[field])) throw new HttpError(400, message);
      const to = field === 'sendWhen' && input[field].payday ? { payday: input[field].payday } : input[field];
      if (JSON.stringify(to) === JSON.stringify(rules[field])) continue;
      history.push({ at, field, from: rules[field], to, text: ruleChangeText(field, rules[field], to) });
      rules[field] = to;
    }
    return { ...doc, rules, ruleHistory: history.slice(-HISTORY_MAX) };
  }

  // 보낼 시기가 바뀌면 아직 보내지 않은 송금의 알림 시각도 함께 옮긴다
  async function afterRules(before, after) {
    if (JSON.stringify(before.rules.sendWhen) !== JSON.stringify(after.rules.sendWhen)) await orchestrator.applySendWhen(after.uid, after.rules.sendWhen);
  }

  function withMemory(doc, text) {
    const s = cleanText(text);
    if (doc.memory.includes(s)) throw new HttpError(409, '이미 있는 기억이에요');
    const limit = memoryLimit(doc);
    if (doc.memory.length >= limit) throw new HttpError(409, `무료 요금제는 기억을 ${limit}개까지 둘 수 있어요. 하나를 지우고 더해 주세요`);
    return { ...doc, memory: [...doc.memory, s] };
  }

  // 기억은 글자로 가리킨다. 방별 공유 선택도 같은 글자를 보므로, 고칠 때 함께 바꾸고 지울 때 함께 지운다
  const eachRoom = (hidden, fn) => Object.fromEntries(Object.entries(hidden).map(([roomId, list]) => [roomId, fn(list)]));
  const mustHave = (doc, text) => {
    if (!doc.memory.includes(text)) throw new HttpError(404, '그 기억을 찾을 수 없어요');
  };

  return {
    get: async (uid) => view(await read(uid)),

    // 방 화면이 매번 부르는 요약. 계좌번호 없이 있는지만 알린다
    async summary(uid, roomId) {
      const doc = await read(uid);
      const { autoAccept, sendWhen, onDispute, notify } = doc.rules;
      return {
        onboarded: Boolean(doc.onboardedAt), autoAccept, sendWhen, onDispute, notify,
        memoryCount: doc.memory.length, sharedCount: sharedMemory(doc, roomId).length, memoryLimit: memoryLimit(doc), hasPayout: Boolean(doc.payout),
      };
    },

    async updateRules(uid, input) {
      const before = await read(uid);
      const out = await saved(withRules(before, input));
      await afterRules(before, out);
      return out;
    },

    async finishOnboarding(uid, { rules, memory } = {}) {
      const before = await read(uid);
      let doc = withRules(before, rules);
      if (String(memory ?? '').trim() && !doc.memory.includes(cleanText(memory))) doc = withMemory(doc, memory);
      const out = await saved({ ...doc, onboardedAt: doc.onboardedAt ?? clock().toISOString() });
      await afterRules(before, out);
      return out;
    },

    addMemory: async (uid, text) => saved(withMemory(await read(uid), text)),

    async editMemory(uid, from, to) {
      const doc = await read(uid);
      mustHave(doc, from);
      const s = cleanText(to);
      if (s === from) return view(doc);
      if (doc.memory.includes(s)) throw new HttpError(409, '이미 있는 기억이에요');
      return saved({
        ...doc,
        memory: doc.memory.map((m) => (m === from ? s : m)),
        memoryHidden: eachRoom(doc.memoryHidden, (list) => list.map((m) => (m === from ? s : m))),
      });
    },

    async deleteMemory(uid, text) {
      const doc = await read(uid);
      mustHave(doc, text);
      return saved({
        ...doc,
        memory: doc.memory.filter((m) => m !== text),
        memoryHidden: eachRoom(doc.memoryHidden, (list) => list.filter((m) => m !== text)),
      });
    },

    // 새 기억과 새 방은 공유가 기본이고, 이 방에 보이고 싶지 않은 기억만 끈다
    async shareMemory(uid, roomId, text, shared) {
      const doc = await read(uid);
      mustHave(doc, text);
      const rest = (doc.memoryHidden[roomId] ?? []).filter((m) => m !== text);
      const hidden = shared ? rest : [...rest, text];
      const { [roomId]: _, ...others } = doc.memoryHidden;
      return saved({ ...doc, memoryHidden: hidden.length ? { ...others, [roomId]: hidden } : others });
    },
  };
}

export function registerAgentSettingsRoutes(routes, { settings, orchestrator, whoAmI, member }) {
  const mine = (path, fn) => routes.post(`/api/me/agent${path}`, async ({ req }) => {
    const { uid } = await whoAmI(req);
    return fn(uid, await readJson(req));
  });

  routes.get('/api/me/agent', async ({ req }) => settings.get((await whoAmI(req)).uid));
  mine('/rules', (uid, body) => settings.updateRules(uid, body));
  mine('/onboarding', (uid, body) => settings.finishOnboarding(uid, body));
  mine('/memory', (uid, { text }) => settings.addMemory(uid, text));
  mine('/memory/edit', (uid, { from, to }) => settings.editMemory(uid, from, to));
  mine('/memory/delete', (uid, { text }) => settings.deleteMemory(uid, text));
  // 받을 계좌는 사람마다 하나. 방 없이 바꿔도 내가 받을 모든 방의 대기 중 송금이 함께 바뀐다
  mine('/payout', async (uid, body) => {
    await orchestrator.setPayout(null, uid, body);
    return settings.get(uid);
  });

  routes.post('/api/rooms/:id/agent/shared', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    const { text, shared } = await readJson(req);
    return settings.shareMemory(me.uid, params.id, text, Boolean(shared));
  });
}
