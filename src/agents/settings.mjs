// 개인 비서 설정(#5): 기억, 규칙, 규칙 변경 기록, 처음 설정. agents 문서를 읽고 쓰는 곳은 여기와 orchestrator.setPayout뿐이다.
// 판단은 rules.mjs가 맡는다. 바꾼 규칙은 다음 청구서부터 적용되고, 이미 만들어진 청구서·송금은 그대로 둔다.
import { HttpError, readJson } from '../http.mjs';
import { DEFAULT_RULES, MEMORY_LIMITS, MEMORY_MAX_CHARS, AUTO_ACCEPT_MAX, ON_DISPUTE, NOTIFY, RULE_FIELDS, ruleChangeText, sendWhenOf } from '../../public/agent-rules.js';

const HISTORY_MAX = 50;
// 방마다 그 방에만 쓸 값을 따로 정할 수 있는 규칙. 알림 수준은 화면 설정이라 방마다 나누지 않는다
export const ROOM_RULES = ['autoAccept', 'sendWhen', 'onDispute'];

const validAutoAccept = (v) => Number.isSafeInteger(v) && v >= 0 && v <= AUTO_ACCEPT_MAX;
// 예전 화면이 보내는 '바로'('now')도 받되 '편할 때'로 저장한다(sendWhenOf)
const validSendWhen = (v) => v === 'now' || v === 'manual' || (Number.isInteger(v?.payday) && v.payday >= 1 && v.payday <= 31);
const cleanValue = (field, v) => (field === 'sendWhen' ? (v.payday ? { payday: v.payday } : sendWhenOf(v)) : v);
const CHECKS = {
  autoAccept: [validAutoAccept, `자동 수락 한도는 0원에서 ${AUTO_ACCEPT_MAX.toLocaleString('ko-KR')}원 사이의 정수로 정해 주세요`],
  sendWhen: [validSendWhen, '보낼 시기는 편할 때나 매달 1~31일 중에서 골라 주세요'],
  onDispute: [(v) => Object.hasOwn(ON_DISPUTE, v), '이의 처리 방법을 골라 주세요'],
  notify: [(v) => Object.hasOwn(NOTIFY, v), '알림 수준을 골라 주세요'],
};

// 저장된 값이 망가졌으면 비서가 더 조심하는 쪽(기본값)으로 읽는다. 한도가 이상하면 0이라 모든 청구서를 묻는다
export function normalizeRules(rules) {
  return Object.fromEntries(RULE_FIELDS.map((f) => [f, CHECKS[f][0](rules?.[f]) ? cleanValue(f, rules[f]) : DEFAULT_RULES[f]]));
}

// 예전에 방에서 끈 규칙(rulesOff: 그 방에서는 안전한 기본값)은 그 방 전용 값으로 옮겨 읽는다
const fromRulesOff = (off) => Object.fromEntries(Object.entries(off ?? {})
  .map(([roomId, fields]) => [roomId, Object.fromEntries((fields ?? []).filter((f) => ROOM_RULES.includes(f)).map((f) => [f, DEFAULT_RULES[f]]))])
  .filter(([, rules]) => Object.keys(rules).length));

export function normalizeSettings(doc, uid) {
  const { rulesOff, ...rest } = doc ?? {};
  return {
    ...rest,
    id: uid,
    uid,
    plan: doc?.plan ?? 'free',
    memory: Array.isArray(doc?.memory) ? doc.memory : [],
    memoryHidden: doc?.memoryHidden ?? {},
    roomRules: { ...fromRulesOff(rulesOff), ...(doc?.roomRules ?? {}) },
    rules: normalizeRules(doc?.rules),
    ruleHistory: Array.isArray(doc?.ruleHistory) ? doc.ruleHistory : [],
    payout: doc?.payout ?? null,
    onboardedAt: doc?.onboardedAt ?? null,
  };
}

// 이 방에서 실제로 쓰는 규칙. 내 계정의 기본 설정(rules)이 모든 방에 쓰이고, 이 방에서 따로 정한 칸(roomRules)만 덮는다.
// 저장된 방 값이 망가졌으면 그 칸은 기본 설정을 따른다
export function rulesIn(settings, roomId) {
  const own = settings.roomRules?.[roomId] ?? {};
  return { ...settings.rules, ...Object.fromEntries(ROOM_RULES.filter((f) => own[f] !== undefined && CHECKS[f][0](own[f])).map((f) => [f, cleanValue(f, own[f])])) };
}

export const memoryLimit = (doc) => MEMORY_LIMITS[doc.plan] ?? MEMORY_LIMITS.free;

function cleanText(text) {
  if (typeof text !== 'string') throw new HttpError(400, '기억을 적어 주세요');
  // eslint-disable-next-line no-control-regex
  const s = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) throw new HttpError(400, '기억을 적어 주세요');
  if (s.length > MEMORY_MAX_CHARS) throw new HttpError(400, `기억은 ${MEMORY_MAX_CHARS}자까지 쓸 수 있어요`);
  return s;
}

export function createAgentSettings({ store, clock = () => new Date() }) {
  const read = async (uid) => normalizeSettings(await store.get('agents', uid), uid);
  // 본인에게 내려가는 모양. 계좌번호 전체는 설정 화면에 필요 없으니 끝 4자리만 보낸다(바꿀 때는 새로 입력한다)
  const view = ({ payout, ...doc }) => ({
    ...doc,
    payout: payout ? { bank: payout.bank, holder: payout.holder, last4: String(payout.accountNo ?? '').replace(/\D/g, '').slice(-4) } : null,
    memoryLimit: memoryLimit(doc),
  });
  const saved = async (doc) => {
    await store.put('agents', doc);
    return view(doc);
  };

  function withRules(doc, input) {
    const rules = { ...doc.rules };
    const history = [...doc.ruleHistory];
    const at = clock().toISOString();
    for (const field of RULE_FIELDS.filter((f) => input?.[f] !== undefined)) {
      const [valid, message] = CHECKS[field];
      if (!valid(input[field])) throw new HttpError(400, message);
      const to = cleanValue(field, input[field]);
      if (JSON.stringify(to) === JSON.stringify(rules[field])) continue;
      history.push({ at, field, from: rules[field], to, text: ruleChangeText(field, rules[field], to) });
      rules[field] = to;
    }
    return { ...doc, rules, ruleHistory: history.slice(-HISTORY_MAX) };
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

    // 방 화면이 매번 부르는 요약(본인에게만). 계좌번호 없이 있는지만 알린다.
    // roomId가 있으면 그 방에서 실제로 쓰는 값, 그 방에서 따로 정한 칸(custom), 내 계정의 기본 설정(defaults)을 준다
    async summary(uid, roomId) {
      const doc = await read(uid);
      const { autoAccept, sendWhen, onDispute, notify } = roomId ? rulesIn(doc, roomId) : doc.rules;
      const own = roomId ? doc.roomRules[roomId] ?? {} : {};
      return {
        onboarded: Boolean(doc.onboardedAt), autoAccept, sendWhen, onDispute, notify, hasPayout: Boolean(doc.payout),
        custom: ROOM_RULES.filter((f) => own[f] !== undefined),
        defaults: Object.fromEntries(ROOM_RULES.map((f) => [f, doc.rules[f]])),
      };
    },

    updateRules: async (uid, input) => saved(withRules(await read(uid), input)),

    async finishOnboarding(uid, { rules } = {}) {
      const doc = withRules(await read(uid), rules);
      return saved({ ...doc, onboardedAt: doc.onboardedAt ?? clock().toISOString() });
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

    // 이 방에만 쓸 값을 정한다. { autoAccept?, sendWhen?, onDispute? }에서 값을 주면 그 칸을 정하고, null이면 기본 설정을 따르게 비운다.
    // 다 비우면 그 방의 흔적을 지운다. 기본 설정(rules)은 건드리지 않는다
    async setRoomRules(uid, roomId, input) {
      const fields = Object.keys(input ?? {});
      if (fields.some((f) => !ROOM_RULES.includes(f))) throw new HttpError(400, '방마다 정할 수 있는 규칙은 자동 수락 한도, 보낼 시기, 이의 처리예요');
      const doc = await read(uid);
      const own = { ...(doc.roomRules[roomId] ?? {}) };
      for (const f of fields) {
        const v = input[f];
        if (v === null) {
          delete own[f];
          continue;
        }
        const [valid, message] = CHECKS[f];
        if (!valid(v)) throw new HttpError(400, message);
        own[f] = cleanValue(f, v);
      }
      const { [roomId]: _, ...others } = doc.roomRules;
      return saved({ ...doc, roomRules: Object.keys(own).length ? { ...others, [roomId]: own } : others });
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

export function registerAgentSettingsRoutes(routes, { settings, authenticate, member }) {
  const body = async (req) => {
    const json = await readJson(req);
    return json && typeof json === 'object' ? json : {}; // 'null' 같은 본문도 500이 아니라 검증 오류로 끝나게
  };
  const mine = (path, fn) => routes.post(`/api/me/agent${path}`, async ({ req }) => {
    const { uid } = await authenticate(req);
    return fn(uid, await body(req));
  });

  routes.get('/api/me/agent', async ({ req }) => settings.get((await authenticate(req)).uid));
  mine('/rules', (uid, input) => settings.updateRules(uid, input));
  mine('/onboarding', (uid, input) => settings.finishOnboarding(uid, input));
  mine('/memory', (uid, { text }) => settings.addMemory(uid, text));
  mine('/memory/edit', (uid, { from, to }) => settings.editMemory(uid, from, to));
  mine('/memory/delete', (uid, { text }) => settings.deleteMemory(uid, text));

  routes.post('/api/rooms/:id/agent/rules', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    return settings.setRoomRules(me.uid, params.id, await body(req));
  });

  routes.post('/api/rooms/:id/agent/shared', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    const { text, shared } = await body(req);
    return settings.shareMemory(me.uid, params.id, text, Boolean(shared));
  });
}
