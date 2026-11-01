// 같은 입력이면 Gemini에게 다시 묻지 않는다. 키는 모델에 실제로 보내는 내용(모델·지시·질문·스키마) 전체의 해시라서,
// 영수증 줄·함께 있던 사람·비서 기억 중 하나라도 바뀌면 자연히 새로 묻는다. 서버 메모리에만 두고, 오래 안 쓴 것부터 버린다.
import { createHash } from 'node:crypto';

export const promptKey = (model, { system, user, schema }) =>
  createHash('sha256').update(JSON.stringify([model, system, user, schema])).digest('hex');

export function createCache({ max = 200, ttlMs = 24 * 3600_000, now = Date.now } = {}) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      map.delete(key);
      if (now() - hit.at > ttlMs) return undefined;
      map.set(key, hit); // Map은 넣은 순서를 지키므로, 방금 쓴 것을 맨 뒤로 옮긴다
      return structuredClone(hit.value);
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value: structuredClone(value), at: now() });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get size() {
      return map.size;
    },
  };
}
