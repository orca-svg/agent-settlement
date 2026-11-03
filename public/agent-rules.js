// 비서 규칙(#5)의 값과 표시 문구. 서버(판단·기록)와 화면(설정)이 같은 글을 쓰도록 여기에 모은다. DOM을 건드리지 않는다.
import { won } from './core.js';
import { MEMORY_LIMIT } from './data.js';

// 설정하기 전의 기본값. 한도 0이라 모든 청구서를 먼저 묻고, 비서가 스스로 받는 돈은 없다
export const DEFAULT_RULES = { autoAccept: 0, sendWhen: 'now', onDispute: 'ask', notify: 'actions' };

// 요금제별 기억 개수. 구독 결제는 범위 밖이라 지금은 무료 요금제만 있다
export const MEMORY_LIMITS = { free: MEMORY_LIMIT };
export const MEMORY_MAX_CHARS = 60;
export const AUTO_ACCEPT_MAX = 10_000_000;
export const AUTO_ACCEPT_PRESETS = [0, 10_000, 30_000, 50_000, 100_000];

export const ON_DISPUTE = {
  ask: '나에게 묻기',
  evidence: '근거가 있으면 이의 제기',
  mediator: '중재 비서에게 맡기기',
};
export const NOTIFY = { actions: '확인할 일만', all: '모든 진행 상황' };

export const sendWhenLabel = (sendWhen) => {
  if (sendWhen === 'manual') return '직접 보내기';
  return sendWhen?.payday ? `매달 ${sendWhen.payday}일에 보내기` : '바로 보내기';
};
export const autoAcceptLabel = (n) => (n > 0 ? `${won(n)}까지 자동 수락` : '항상 나에게 묻기');

const FIELDS = {
  autoAccept: ['자동 수락 한도', (v) => won(v)],
  sendWhen: ['보낼 시기', sendWhenLabel],
  onDispute: ['이의 처리', (v) => ON_DISPUTE[v] ?? v],
  notify: ['알림', (v) => NOTIFY[v] ?? v],
};
export const RULE_FIELDS = Object.keys(FIELDS);

// 규칙 변경 기록 한 줄
export const ruleChangeText = (field, from, to) => `${FIELDS[field][0]}: ${FIELDS[field][1](from)} → ${FIELDS[field][1](to)}`;

// 이 기록이 알림(종 배지)에 잡히는지. 기록 자체는 알림 수준과 상관없이 모두 남고 볼 수 있다
export const notifies = (event, uid, level = DEFAULT_RULES.notify) => level === 'all' || event.action?.for === uid;
