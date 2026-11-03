// 개인 비서 설정(#5): 기억, 규칙, 규칙 변경 기록, 처음 설정. agents 문서를 읽고 쓰는 곳은 여기와 orchestrator.setPayout뿐이다.
// 판단은 rules.mjs가 맡는다. 바꾼 규칙은 다음 청구서부터 적용되고, 이미 만들어진 청구서·송금은 그대로 둔다.
import { HttpError, readJson } from '../http.mjs';
import { DEFAULT_RULES, MEMORY_LIMITS, MEMORY_MAX_CHARS, AUTO_ACCEPT_MAX, ON_DISPUTE, NOTIFY, RULE_FIELDS, ruleChangeText } from '../../public/agent-rules.js';

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
    ruleHistory: Array.isArray(doc?.ruleHistory) ? doc.ruleHistory : [],
    payout: doc?.payout ?? null,
    onboardedAt: doc?.onboardedAt ?? null,
  };
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
      const to = field === 'sendWhen' && input[field].payday ? { payday: input[field].payday } : input[field];
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

    // 방 화면이 매번 부르는 요약. 계좌번호 없이 있는지만 알린다
    async summary(uid) {
      const doc = await read(uid);
      const { autoAccept, sendWhen, notify } = doc.rules;
      return { onboarded: Boolean(doc.onboardedAt), autoAccept, sendWhen, notify, hasPayout: Boolean(doc.payout) };
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

export function registerAgentSettingsRoutes(routes, { settings, whoAmI, member }) {
  const body = async (req) => {
    const json = await readJson(req);
    return json && typeof json === 'object' ? json : {}; // 'null' 같은 본문도 500이 아니라 검증 오류로 끝나게
  };
  const mine = (path, fn) => routes.post(`/api/me/agent${path}`, async ({ req }) => {
    const { uid } = await whoAmI(req);
    return fn(uid, await body(req));
  });

  routes.get('/api/me/agent', async ({ req }) => settings.get((await whoAmI(req)).uid));
  mine('/rules', (uid, input) => settings.updateRules(uid, input));
  mine('/onboarding', (uid, input) => settings.finishOnboarding(uid, input));
  mine('/memory', (uid, { text }) => settings.addMemory(uid, text));
  mine('/memory/edit', (uid, { from, to }) => settings.editMemory(uid, from, to));
  mine('/memory/delete', (uid, { text }) => settings.deleteMemory(uid, text));

  routes.post('/api/rooms/:id/agent/shared', async ({ req, params }) => {
    const { me } = await member(req, params.id);
    const { text, shared } = await body(req);
    return settings.shareMemory(me.uid, params.id, text, Boolean(shared));
  });
}
