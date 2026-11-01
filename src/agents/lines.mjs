// 메뉴 배분과 중재가 함께 쓰는 프롬프트 조각과 출력 검증.
// 모델에게는 사람 이름으로 묻고(enum), 결과는 uid로 바꿔 저장한다.

const nameOf = (members, uid) => members.find((m) => m.uid === uid)?.name ?? uid;

export function memoryText(members, memoryByUid) {
  return members
    .map((m) => {
      const list = memoryByUid[m.uid] || [];
      return `- ${m.name}의 비서: ${list.length ? list.map((x) => `“${x}”`).join(', ') : '(공유한 기억 없음)'}`;
    })
    .join('\n');
}

export function receiptTable(exp, withTime) {
  return [
    `| id | ${withTime ? '주문 시각 | ' : ''}항목 | 수량 | 단가 | 태그 |`,
    `| --- |${withTime ? ' --- |' : ''} --- | --- | --- | --- |`,
    ...exp.items.map((it) => `| ${it.id} | ${withTime ? `${it.time} | ` : ''}${it.name} | ${it.qty} | ${it.unit} | ${it.tags.join(', ')} |`),
  ].join('\n');
}

export const presentNames = (exp, members) => exp.present.map((u) => nameOf(members, u)).join(', ');

export function lineSchema(exp, members) {
  return {
    type: 'OBJECT',
    properties: {
      id: { type: 'STRING', enum: exp.items.map((i) => i.id) },
      consumers: { type: 'ARRAY', items: { type: 'STRING', enum: members.map((m) => m.name) } },
      confidence: { type: 'NUMBER', description: '0~1' },
      reason: { type: 'STRING', description: '해요체 한 문장' },
    },
    required: ['id', 'consumers', 'confidence', 'reason'],
    propertyOrdering: ['id', 'consumers', 'confidence', 'reason'],
  };
}

// 모델 출력을 영수증 줄 단위로 검증한다. 빠진 줄이나 그 자리에 없던 사람만 남은 줄은 규칙 배분으로 대신하고 filled 표시.
export function cleanLines(exp, members, raw, fallback, presentAt) {
  const uidOf = new Map(members.map((m) => [m.name, m.uid]));
  const byId = new Map((raw || []).map((l) => [l.id, l]));
  const out = {};
  for (const it of exp.items) {
    const l = byId.get(it.id);
    const present = presentAt(it);
    const consumers = [...new Set((l?.consumers || []).map((n) => uidOf.get(n)).filter((u) => u && present.includes(u)))];
    if (!l || !consumers.length) {
      out[it.id] = { ...fallback[it.id], filled: true };
      continue;
    }
    out[it.id] = {
      consumers: members.map((m) => m.uid).filter((u) => consumers.includes(u)),
      confidence: Math.round(Math.min(1, Math.max(0, Number(l.confidence) || 0)) * 100) / 100,
      reason: String(l.reason || '').slice(0, 160),
    };
  }
  return out;
}
