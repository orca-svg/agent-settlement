// #2 내 계정의 프로필 편집. 색은 시스템 색 견본에서 고르고, 고르는 대로 미리보기가 바뀐다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILE_COLORS, profileFormHtml } from '../public/profile-form.js';

const radios = (html) => [...html.matchAll(/<input type="radio" name="color" value="(#[0-9a-f]{6})"([^>]*)>/gi)].map(([, value, rest]) => ({ value, checked: /\bchecked\b/.test(rest) }));

test('profileFormHtml: 견본마다 라디오 하나, 지금 색만 골라져 있다', () => {
  const html = profileFormHtml({ name: '준엽', color: '#5856D6' });
  const r = radios(html);
  assert.equal(r.length, PROFILE_COLORS.length);
  assert.deepEqual(r.filter((x) => x.checked).map((x) => x.value.toLowerCase()), ['#5856d6']);
  for (const [, label] of PROFILE_COLORS) assert.match(html, new RegExp(`aria-label="${label}"`));
  assert.doesNotMatch(html, /지금 색/);
});

test('profileFormHtml: 견본에 없는 색이면 지우지 않고 맨 앞에 지금 색으로 둔다', () => {
  const r = radios(profileFormHtml({ name: '준엽', color: '#112233' }));
  assert.equal(r.length, PROFILE_COLORS.length + 1);
  assert.deepEqual(r[0], { value: '#112233', checked: true });
  assert.ok(r.slice(1).every((x) => !x.checked));
});

test('profileFormHtml: 이름은 이스케이프하고 미리보기는 첫 글자를 쓴다', () => {
  const html = profileFormHtml({ name: '<b>민수', color: '#007aff' });
  assert.doesNotMatch(html, /<b>민수/);
  assert.match(html, /&lt;b&gt;민수/);
  assert.match(html, /class="avatar xl"[^>]*>&lt;</);
});
