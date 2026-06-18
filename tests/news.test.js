import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY, categoryOf } from '../js/lib/news_categories.js';

test('CATEGORY: 8カテゴリ・各label/color(RGB3要素)', () => {
  const keys = Object.keys(CATEGORY);
  assert.equal(keys.length, 8);
  for (const k of keys) {
    assert.ok(typeof CATEGORY[k].label === 'string');
    assert.equal(CATEGORY[k].color.length, 3);
  }
});

test('categoryOf: 未知キーは other にフォールバック', () => {
  assert.equal(categoryOf('disaster').label, '災害・事故');
  assert.equal(categoryOf('nope'), CATEGORY.other);
  assert.equal(categoryOf(undefined), CATEGORY.other);
});
