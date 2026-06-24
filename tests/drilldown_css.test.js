// tests/drilldown_css.test.js
// 非重畳 split の CSS 契約を検証（実 paint は実機サニティ／ここは契約存在の回帰ガード）。
// blur-bleed 回避の絶対要件: #drilldown に backdrop-filter / glass を一切使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '..', 'css', 'orbis.css'), 'utf8');

test('css: body.drill-open で #map-wrap を grid 化し #map を物理縮小（position 上書き）', () => {
  assert.match(css, /body\.drill-open\s+#map-wrap\s*\{[^}]*display:\s*grid/);
  // #map のみ position 上書き（他オーバーレイは触らない）
  assert.match(css, /body\.drill-open\s+#map\s*\{[^}]*position:\s*static/);
});

test('css: #drilldown は不透明純色背景・backdrop-filter / glass-blur を使わない（blur-bleed 回避）', () => {
  // #drilldown / .drill-panel の宣言ブロックを抽出
  const m = css.match(/#drilldown(?:\.drill-panel)?\s*\{[^}]*\}/g) || [];
  assert.ok(m.length > 0, '#drilldown ルールが存在');
  const joined = m.join('\n');
  assert.match(joined, /background:\s*#070b14/);
  assert.doesNotMatch(joined, /backdrop-filter/);
  assert.doesNotMatch(joined, /var\(--glass-blur\)/);
});

test('css: モバイルで下半分 grid 行（globe 上・詳細下）', () => {
  assert.match(css, /body\.drill-open\s+#map-wrap\s*\{[^}]*grid-template-rows/);
});
