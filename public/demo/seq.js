// 체험 데모의 SEQ(팀 요청 11/5). task를 끝내면 화면 가운데 카드로 '얼마나 쉬웠나'(1 매우 어려움 ~ 7 매우 쉬움)를 묻는다.
// 내 점수와 익명 체험 id는 이 브라우저(localStorage)에 남겨, '처음부터 다시' 하거나 다시 와도 답한 task는 다시 묻지 않는다.
// 점수는 Cloud Run 서버(/api/demo/seq, src/demo-seq.mjs)로 보내고, 다섯 task에 다 답하면 첫 화면(index.html)이 모두의 평균을 보여 준다.
// 데모의 다른 /api 요청은 브라우저 안 데모 서버가 받지만, 이것만은 진짜 서버로 간다(boot.js가 가로채기 전의 fetch를 넘긴다)
import { esc, ICON_DONE } from '../ui.js';

const KEY = 'agent-settlement.demo.seq';
const newSid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function createSeq({ fetch, base = '', storage }) {
  const saved = (() => { try { return JSON.parse(storage?.getItem(KEY)) ?? null; } catch { return null; } })();
  const state = { sid: saved?.sid || null, scores: saved?.scores ?? {}, skipped: saved?.skipped ?? [] };
  // 답하기 전에는 아무것도 남기지 않는다(첫 화면만 열어 본 사람)
  const save = () => {
    state.sid ||= newSid();
    try { storage?.setItem(KEY, JSON.stringify(state)); } catch {}
  };
  let summary = null;
  let status = 'idle'; // idle · loading · ready · error

  async function call(method, body) {
    status = 'loading';
    try {
      // keepalive: 마지막 답 바로 뒤 첫 화면으로 넘어가도 보내기가 끊기지 않게
      const init = method === 'POST' ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), keepalive: true } : {};
      const res = await fetch(`${base}/api/demo/seq`, init);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      summary = await res.json();
      status = 'ready';
    } catch {
      status = 'error'; // 보내지 못해도 내 점수는 이 브라우저에 남아 있다
    }
  }

  return {
    // 끝낸 task 중 아직 답하지도 건너뛰지도 않은 첫 task
    pending: (list) => list.find((t) => t.done && state.scores[t.id] == null && !state.skipped.includes(t.id)) ?? null,
    // 이 task들에 모두 답했거나 건너뛰었는지(첫 화면은 그때만 평균을 보인다)
    complete: (ids) => ids.every((id) => state.scores[id] != null || state.skipped.includes(id)),
    mine: () => ({ ...state.scores }),
    async rate(task, score) {
      state.scores[task] = score;
      save();
      await call('POST', { sid: state.sid, task, score });
    },
    skip(task) {
      if (!state.skipped.includes(task)) state.skipped.push(task);
      save();
    },
    load: () => call('GET'),
    summary: () => summary,
    status: () => status,
  };
}

// 끝낸 task 바로 뒤 화면 가운데에 띄우는 카드. 누르면 바로 남는다(따로 '보내기'가 없다). 별점이 아니라 양 끝에 뜻을 적은 7칸이다:
// 별은 만족도로 읽히고, SEQ는 '얼마나 쉬웠나'를 7점으로 묻는다. chosen이 있으면 고른 칸을 눌린 채로 두고 남겼다고 알린다
const particle = (n) => ([1, 3, 6, 7, 8].includes(n % 10) ? '을' : '를'); // Task 1을 · Task 2를
export function seqCardHtml(t, chosen = null) {
  const end = (s) => (s === 1 ? ' · 매우 어려움' : s === 7 ? ' · 매우 쉬움' : '');
  const buttons = [1, 2, 3, 4, 5, 6, 7].map((s) => `<button type="button" class="seq-btn" data-seq="rate" data-task="${esc(t.id)}" data-score="${s}" aria-label="${s}점${end(s)}"${chosen === s ? ' aria-pressed="true"' : ''}${chosen ? ' disabled' : ''}>${s}</button>`).join('');
  return `<div class="seq-scrim"></div>
    <section class="seq-card" role="dialog" aria-modal="true" aria-labelledby="seq-card-title" aria-describedby="seq-card-q" tabindex="-1">
      <span class="seq-check" aria-hidden="true">${ICON_DONE}</span>
      <h2 class="seq-card-title" id="seq-card-title">Task ${t.n}${particle(t.n)} 끝냈어요</h2>
      <p class="seq-card-task">${esc(t.title)}</p>
      <p class="seq-card-q" id="seq-card-q">얼마나 쉬웠나요?</p>
      <div class="seq-scale">${buttons}</div>
      <div class="seq-ends" aria-hidden="true"><span>매우 어려움</span><span>매우 쉬움</span></div>
      ${chosen ? `<p class="seq-card-done" role="status">${chosen}점을 남겼어요</p>` : `<button type="button" class="seq-skip" data-seq="skip" data-task="${esc(t.id)}">건너뛰기</button>`}
    </section>`;
}

const one = (x) => (x == null ? '–' : x.toFixed(1));
const avgOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// 첫 화면의 task 줄 오른쪽: 모두의 평균(앱의 tint 칩)과 내 점수·사람 수(작게). 평균을 불러오기 전에도 내 점수는 보인다
export function seqRowHtml(id, mine, summary) {
  const all = summary?.tasks?.[id];
  return `<span class="seq-res"><span class="chip tint seq-chip">평균 ${summary ? one(all?.avg) : '…'}</span><span class="seq-res-me">나 ${mine[id] ?? '–'}${summary ? ` · ${all?.n ?? 0}명` : ''}</span></span>`;
}

// 첫 화면의 task 목록 아래: 전체 평균, 내 평균, 응답 수, 그리고 척도의 뜻
export function seqTotalHtml(ids, mine, summary, status) {
  const myAvg = avgOf(ids.map((id) => mine[id]).filter((x) => x != null));
  const o = summary?.overall;
  const note = status === 'loading' ? '<p class="group-note" role="status">평균을 불러오는 중이에요…</p>'
    : status === 'error' ? '<p class="group-note" role="status">모두의 평균을 불러오지 못했어요. <button type="button" class="text-btn" data-seq="retry">다시 불러오기</button></p>'
    : '';
  return `<p class="seq-total"><span class="chip tint seq-chip">전체 평균 ${summary ? one(o?.avg) : '…'}</span><span>내 평균 ${one(myAvg)}</span>${summary ? `<span>응답 ${o?.n ?? 0}개</span>` : ''}</p>
    <p class="group-note">SEQ · 1 매우 어려움 ~ 7 매우 쉬움. 모두의 평균은 체험한 사람들이 task마다 남긴 점수예요.</p>${note}`;
}
