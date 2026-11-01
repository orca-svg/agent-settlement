// Gemini REST 호출. 키가 없으면 createGemini가 null을 돌려주고, 호출하는 쪽이 규칙으로 대신한다.
const API = 'https://generativelanguage.googleapis.com/v1beta';

// GEMINI_MODEL이 없으면 이 키로 쓸 수 있는 최신 Flash 모델을 고른다.
export async function resolveModel(key, preferred) {
  if (preferred) return preferred;
  try {
    const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    const names = ((await res.json()).models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace('models/', ''));
    const flash = names
      .map((n) => ({ n, m: n.match(/^gemini-(\d+(?:\.\d+)?)-flash(-preview)?$/) }))
      .filter((x) => x.m)
      .sort((a, b) => Number(b.m[1]) - Number(a.m[1]) || (a.m[2] ? 1 : 0) - (b.m[2] ? 1 : 0));
    if (flash.length) return flash[0].n;
  } catch (e) {
    console.warn('모델 목록 조회 실패, 기본 모델 사용:', e.message);
  }
  return 'gemini-flash-latest';
}

function thinkingConfig(model) {
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  if (/gemini-3/.test(model)) return { thinkingLevel: 'low' };
  return undefined;
}

// generate({ system, user, schema, images }) → 스키마 모양의 객체. images는 [{ mimeType, data(base64) }].
export function createGemini({ key, model }) {
  if (!key) return null;
  return {
    model,
    async generate({ system, user, schema, images = [] }) {
      const parts = [...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })), { text: user }];
      const body = (withThinking) => JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
          temperature: 0.2,
          ...(withThinking && thinkingConfig(model) ? { thinkingConfig: thinkingConfig(model) } : {}),
        },
      });
      const call = (withThinking) => fetch(`${API}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: body(withThinking),
        signal: AbortSignal.timeout(45000),
      });
      let res = await call(true);
      if (res.status === 400) res = await call(false); // thinkingConfig를 모르는 모델 대비
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || `Gemini HTTP ${res.status}`);
      const text = (json.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text).join('');
      return JSON.parse(text);
    },
  };
}

// 이번 달 Gemini 호출을 maxCalls회로 묶는다(#10). 넘으면 generate()가 실패해서
// 호출하는 쪽(allocate/mediate)이 이미 하던 대로 규칙으로 대신한다.
export function withMonthlyBudget(gemini, { maxCalls = 0, now = () => new Date() } = {}) {
  if (!gemini || !maxCalls) return gemini;
  let month = null;
  let count = 0;
  return {
    ...gemini,
    async generate(args) {
      const key = now().toISOString().slice(0, 7); // YYYY-MM
      if (key !== month) {
        month = key;
        count = 0;
      }
      if (count >= maxCalls) throw new Error(`이번 달 Gemini 호출 한도(${maxCalls}회)를 넘었어요`);
      count++;
      return gemini.generate(args);
    },
  };
}
