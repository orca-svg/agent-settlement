// 영수증 사진 읽기. Gemini가 사진에서 읽은 내용을 검증해 '초안'으로 돌려준다. 저장은 사람이 확인한 뒤 POST /expenses로 한다.
import { TAGS } from '../domain/types.mjs';
import { money } from '../../public/core.js';

const UNREADABLE = '영수증을 읽지 못했어요';

function prompt(room) {
  const currencies = ['KRW', room.fx?.currency].filter(Boolean);
  const system = [
    '너는 영수증 사진을 읽는 도우미다. 사진에 보이는 것만 적고, 보이지 않는 것은 지어내지 않는다.',
    '',
    '규칙:',
    '1. 영수증이 아니거나 글자를 읽을 수 없으면 items를 빈 배열로, total을 0으로 낸다.',
    '2. total은 영수증의 최종 결제 금액(할인·봉사료·세금 반영 후)이다. 금액은 모두 정수다.',
    '3. items는 메뉴 줄만 적는다. 소계·합계·세금·할인 줄은 items에 넣지 않는다.',
    `4. 각 줄의 tags는 다음 중에서만 고른다: ${TAGS.join(', ')}. 맞는 것이 없으면 기타.`,
    '5. 줄마다 주문 시각이 찍혀 있으면 time에 HH:MM으로, 없으면 빈 문자열.',
    '6. date는 YYYY-MM-DD, time은 결제 시각 HH:MM. 읽을 수 없으면 빈 문자열.',
    `7. currency는 다음 중 하나: ${currencies.join(', ')}. 엔화(¥, 円)면 JPY, 원화(₩, 원)면 KRW.`,
  ].join('\n');
  const schema = {
    type: 'OBJECT',
    properties: {
      merchant: { type: 'STRING' },
      currency: { type: 'STRING' },
      date: { type: 'STRING' },
      time: { type: 'STRING' },
      total: { type: 'INTEGER' },
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            qty: { type: 'INTEGER' },
            unit: { type: 'INTEGER' },
            time: { type: 'STRING' },
            tags: { type: 'ARRAY', items: { type: 'STRING', enum: TAGS } },
          },
          required: ['name', 'qty', 'unit', 'tags'],
        },
      },
    },
    required: ['merchant', 'currency', 'total', 'items'],
    propertyOrdering: ['merchant', 'currency', 'date', 'time', 'total', 'items'],
  };
  return { system, user: '이 영수증 사진을 읽어 JSON으로 내라.', schema };
}

// → ReceiptDraft { ok, reason?, merchant, currency, date, time, total, items, warnings, source }
export async function extractReceipt(gemini, { image, room }) {
  const empty = { merchant: '', currency: 'KRW', date: '', time: '', total: 0, items: [], warnings: [] };
  if (!gemini) return { ...empty, ok: false, reason: '사진 읽기는 AI 서버가 필요해요', source: 'rules' };
  let raw;
  try {
    raw = await gemini.generate({ ...prompt(room), images: [image] });
  } catch (e) {
    console.warn('[receipt] Gemini 실패:', e.message);
    return { ...empty, ok: false, reason: `${UNREADABLE} (AI 응답 실패)`, source: 'rules' };
  }

  const currencies = ['KRW', room.fx?.currency].filter(Boolean);
  const currency = String(raw.currency || '').toUpperCase();
  const total = Math.round(Number(raw.total) || 0);
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 50).map((it, i) => ({
    id: `line-${i + 1}`,
    name: String(it.name || `항목 ${i + 1}`).trim().slice(0, 40),
    qty: Math.min(99, Math.max(1, Math.round(Number(it.qty) || 1))),
    unit: Math.round(Number(it.unit) || 0),
    ...(/^\d{2}:\d{2}$/.test(it.time || '') ? { time: it.time } : {}),
    tags: [...new Set((Array.isArray(it.tags) ? it.tags : []).map((t) => (TAGS.includes(t) ? t : '기타')))],
  }));
  const base = {
    merchant: String(raw.merchant || '').trim().slice(0, 40),
    currency: currencies.includes(currency) ? currency : 'KRW',
    date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : '',
    time: /^\d{2}:\d{2}$/.test(raw.time || '') ? raw.time : '',
    total,
    source: gemini.model,
  };
  if (!items.length || total <= 0) return { ...empty, ...base, items: [], ok: false, reason: UNREADABLE };
  if (!currencies.includes(currency)) return { ...empty, ...base, items: [], ok: false, reason: `이 방에서 쓰지 않는 통화(${currency || '알 수 없음'})의 영수증이에요` };

  const warnings = [];
  const sum = items.reduce((s, it) => s + it.qty * it.unit, 0);
  if (sum !== total) {
    items.push({ id: 'adj', name: '차액 조정', qty: 1, unit: total - sum, tags: ['기타'] });
    warnings.push(`줄의 합과 합계가 ${money(Math.abs(total - sum), base.currency)} 달라 차액 조정 줄을 넣었어요. 할인·봉사료인지 확인해 주세요`);
  }
  return { ...base, ok: true, items, warnings };
}
