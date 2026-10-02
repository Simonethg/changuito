import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const css = readFileSync(join(root, 'components/landing/landing.module.css'), 'utf8');

function block(selector: string, from = 0): string {
  const start = css.indexOf(selector, from);
  assert.notEqual(start, -1, selector);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}

function contrast(fg: string, bg: string): number {
  const lum = (hex: string) => {
    const channels = [0, 2, 4].map((index) => {
      const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [lum(fg), lum(bg)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test('desktop hero places the product demo beside the headline', () => {
  const hero = block('.heroInner {');
  assert.match(hero, /align-items:\s*center/);
  assert.match(hero, /grid-template-columns:\s*minmax\(0, 1\.05fr\)/);
  const demo = block('.demo {');
  assert.match(demo, /max-width:\s*440px/);
  assert.match(demo, /justify-self:\s*end/);
});

test('a 390px viewport stacks the demo under the headline', () => {
  const narrow = css.indexOf('@media (max-width: 480px)');
  assert.notEqual(narrow, -1);
  const hero = block('.heroInner {', narrow);
  assert.match(hero, /flex-direction:\s*column/);
  const demo = block('.demo {', narrow);
  assert.match(demo, /width:\s*100%/);
});

test('secondary text clears WCAG AA on the off-white page', () => {
  const soft = css.match(/--ink-soft:\s*#([0-9a-fA-F]{6})/);
  const paper = css.match(/--paper:\s*#([0-9a-fA-F]{6})/);
  assert.ok(soft && paper);
  assert.ok(contrast(soft[1], paper[1]) >= 4.5, `${soft[1]} on ${paper[1]}`);
});
