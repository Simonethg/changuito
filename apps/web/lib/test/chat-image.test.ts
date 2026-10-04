import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isChatImage, MAX_IMAGE_CHARS } from '../chat-image.ts';

const jpeg = { mediaType: 'image/jpeg', data: 'aaaa' };

test('a short jpeg passes', () => {
  assert.equal(isChatImage(jpeg), true);
});

test('padding and the alphabet are checked', () => {
  assert.equal(isChatImage({ mediaType: 'image/png', data: 'abc' }), false);
  assert.equal(isChatImage({ mediaType: 'image/webp', data: 'ab+/' }), true);
  assert.equal(isChatImage({ mediaType: 'image/gif', data: '@@@@' }), false);
});

test('anything that is not a photo is refused', () => {
  assert.equal(isChatImage(null), false);
  assert.equal(isChatImage({ mediaType: 'image/svg+xml', data: 'aaaa' }), false);
  assert.equal(isChatImage({ mediaType: 'image/jpeg', data: '' }), false);
  assert.equal(isChatImage({ mediaType: 'image/jpeg' }), false);
  assert.equal(isChatImage({ data: 'aaaa' }), false);
});

test('a photo past the hop budget is refused', () => {
  assert.equal(isChatImage({ mediaType: 'image/jpeg', data: 'a'.repeat(MAX_IMAGE_CHARS + 4) }), false);
});
