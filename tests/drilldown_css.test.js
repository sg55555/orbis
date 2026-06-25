// tests/drilldown_css.test.js
// 中央フロート＋スクリム CSS 契約を検証（実 paint は実機サニティ／ここは契約存在の回帰ガード）。
// blur-bleed 回避の絶対要件: #drilldown に backdrop-filter / glass を一切使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '..', 'css', 'orbis.css'), 'utf8');

test('css: #drilldown は中央フロート（fixed・中央寄せ・幅 min(…px,95vw) でキャップ）', () => {
  const m = (css.match(/#drilldown(?:\.drill-panel)?\s*\{[^}]*\}/g) || []).join('\n');
  assert.match(m, /position:\s*fixed/);
  assert.match(m, /width:\s*min\(\s*\d+px,\s*95vw\)/);
});
test('css: #drilldown は backdrop-filter / glass-blur を使わない（blur-bleed 回避）', () => {
  const m = (css.match(/#drilldown(?:\.drill-panel)?\s*\{[^}]*\}/g) || []).join('\n');
  assert.doesNotMatch(m, /backdrop-filter/);
});
test('css: #drill-scrim（暗幕）と body.drill-open 表示契約', () => {
  assert.match(css, /#drill-scrim\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /body\.drill-open\s+#drill-scrim/);
});
test('css: .pf-hero / .pf-shape / .pf-sec-h / .pf-events が定義済み', () => {
  assert.match(css, /\.pf-hero\s*\{/);
  assert.match(css, /\.pf-shape\s*\{/);
  assert.match(css, /\.pf-sec-h\s*\{/);
  assert.match(css, /\.pf-events\s*\{/);
});
test('css: モバイルは全幅ボトムシート（max-width:768px で #drilldown 全幅）', () => {
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
});
