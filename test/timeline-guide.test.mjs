// #7 타임라인 올리기 안내 시트(public/timeline-guide.js). 누르면 바로 파일 고르기가 아니라,
// 휴대폰 Google 지도에서 내보내는 방법과 함께 'Google 지도 열기'와 '내보낸 파일 고르기' 중에서 고르게 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guessOs, guideHtml, TIMELINE_URL } from '../public/timeline-guide.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

test('기기 추정: iPhone·iPad는 ios, Android는 android, 나머지는 컴퓨터', () => {
  assert.equal(guessOs(IPHONE, 5), 'ios');
  assert.equal(guessOs(IPAD, 5), 'ios', 'iPadOS Safari는 Mac처럼 보이지만 터치 지점이 여럿이다');
  assert.equal(guessOs(ANDROID, 5), 'android');
  assert.equal(guessOs(MAC, 0), 'computer');
  assert.equal(guessOs('', 0), 'computer');
});

test('iPhone: Google 지도 앱 설정에서 내보내는 단계와 파일 이름, 두 선택지', () => {
  const html = guideHtml({ os: 'ios', phone: true });
  assert.match(html, /<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*data-id="ios"/, 'iPhone 탭이 골라져 있다');
  assert.match(html, /<button[^>]*role="radio"[^>]*aria-checked="false"[^>]*data-id="android"/);
  for (const step of ['Google 지도 앱', '설정', '개인 콘텐츠', '타임라인 데이터 내보내기', '파일에 저장', 'location-history.json']) assert.ok(html.includes(step), step);
  assert.equal((html.match(/<li/g) ?? []).length, 3, '단계는 셋');
  assert.ok(html.match(/<li>[\s\S]*?<\/li>/g).every((li) => /^<li><span>[\s\S]*<\/span><\/li>$/.test(li)), '단계 글은 한 덩어리(번호 원과 나란한 grid 칸 하나)');
  assert.match(html, /<button[^>]*class="btn"[^>]*data-action="timeline-file"[^>]*>내보낸 파일 고르기</, '파일 고르기가 주 버튼');
  const link = html.match(/<a [^>]*>[^<]*Google 지도 열기/)?.[0] ?? '';
  assert.ok(link.includes(`href="${TIMELINE_URL}"`) && link.includes('target="_blank"') && link.includes('rel="noopener"'), 'Google 지도는 새 창(앱)으로 연다');
  assert.match(link, /class="btn secondary"/);
});

test('Android: 지도 앱이 아니라 휴대폰 설정 앱의 위치 › 타임라인에서 내보낸다', () => {
  const html = guideHtml({ os: 'android', phone: true });
  assert.match(html, /aria-checked="true"[^>]*data-id="android"/);
  for (const step of ['설정 앱', '위치', '위치 서비스', '타임라인 데이터 내보내기', '내보내기 완료']) assert.ok(html.includes(step), step);
  assert.ok(!html.includes('개인 콘텐츠'));
  assert.match(html, /Google 지도 열기/);
});

test('컴퓨터: 타임라인은 휴대폰에만 있어서 지도 링크 대신 파일을 옮겨 오라고 안내한다', () => {
  const html = guideHtml({ os: 'ios', phone: false });
  assert.ok(!html.includes(TIMELINE_URL) && !html.includes('Google 지도 열기'), '컴퓨터에서는 타임라인이 열리지 않으니 링크를 두지 않는다');
  assert.match(html, /휴대폰에만 있어요/);
  assert.match(html, /data-action="timeline-file"/);
});

test('파일은 이 기기에서만 읽는다고 먼저 알린다', () => {
  assert.match(guideHtml({ os: 'ios', phone: true }), /이 기기에서만 읽어요/);
});

test('안내 시트는 이의 시트 위에 한 겹 더 올라오고, 닫기는 안내만 닫는다', () => {
  const html = readFileSync(new URL('../public/room.html', import.meta.url), 'utf8');
  const guide = html.match(/<div class="sheet-root"[^>]*id="guide-root"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.ok(guide, '#guide-root가 따로 있다');
  assert.match(guide, /role="dialog"[^>]*aria-labelledby="guide-title"/);
  assert.equal((guide.match(/data-action="close-guide"/g) ?? []).length, 2, '배경과 닫기 버튼 모두 안내만 닫는다');
  assert.ok(!guide.includes('close-sheet'), '이의 시트까지 닫지 않는다');
});

test('타임라인 올리기 줄은 바로 파일을 고르지 않고 안내 시트를 연다(다시 고르기는 바로)', () => {
  const src = readFileSync(new URL('../public/room.js', import.meta.url), 'utf8');
  const rows = src.match(/data-action="timeline-[a-z]+"[^`]*?Google 지도 타임라인 올리기/g) ?? [];
  assert.equal(rows.length, 2, '방 화면 줄과 이의 시트 줄');
  assert.ok(rows.every((r) => r.startsWith('data-action="timeline-guide"')));
  assert.match(src, /data-action="timeline-pick">다른 파일 고르기/);
});
