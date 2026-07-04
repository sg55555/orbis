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
test('css: .pf-hero / .pf-shape / .pf-layer-h / .pf-events が定義済み', () => {
  assert.match(css, /\.pf-hero\s*\{/);
  assert.match(css, /\.pf-shape\s*\{/);
  assert.match(css, /\.pf-layer-h\s*\{/);
  assert.match(css, /\.pf-events\s*\{/);
});
test('css: モバイルは全幅ボトムシート（max-width:768px で #drilldown 全幅）', () => {
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
});

// v2 スキーマ要素（Task 6 profile_view.js の出力クラス）のスタイル契約
test('css: v2 因果レイヤー（.pf-layers/.pf-layer/.pf-layer-h）が定義済み', () => {
  assert.match(css, /\.pf-layers\s*\{/);
  assert.match(css, /\.pf-layer\s*\{/);
  assert.match(css, /\.pf-layer-h\s*\{/);
});
test('css: 確度バッジ .pf-conf-b と3種の確度修飾クラスが定義済み', () => {
  assert.match(css, /\.pf-conf\s*\{/);
  assert.match(css, /\.pf-conf-b\s*\{/);
  assert.match(css, /\.pf-conf-b\.pf-conf--certain\s*\{/);
  assert.match(css, /\.pf-conf-b\.pf-conf--inferred\s*\{/);
  assert.match(css, /\.pf-conf-b\.pf-conf--time\s*\{/);
});
test('css: 年表 .pf-timeline / 観光 .pf-tourism / 所属国リンク .pf-belongs-link / 脚注 .pf-dig・.pf-ev-basis が定義済み', () => {
  assert.match(css, /\.pf-timeline\s*\{/);
  assert.match(css, /\.pf-tourism\s*\{/);
  assert.match(css, /\.pf-belongs-link\s*\{/);
  assert.match(css, /\.pf-ev-basis,\s*\.pf-dig\s*\{/);
});
test('css: 旧 .pf-sec* （死コード・Task 6 で置換済み）は削除されている', () => {
  assert.doesNotMatch(css, /\.pf-sections\s*\{/);
  assert.doesNotMatch(css, /\.pf-sec\s*\{/);
  assert.doesNotMatch(css, /\.pf-sec-h\s*\{/);
  assert.doesNotMatch(css, /\.pf-sec-ic\b/);
});

// 面禁則：確度バッジは border-color/box-shadow(glow) で区別し、background は極薄フィルに留める
// （見た目そのものの GPU レンダリングは headless では検証できないため、ここは構造契約のみ）
test('css: 確度バッジ修飾クラスは縁(border-color)とglow(box-shadow)で区別し、生の高不透明度な面(background)を持たない', () => {
  const rules = css.match(/\.pf-conf-b\.pf-conf--\w+\s*\{[^}]*\}/g) || [];
  assert.equal(rules.length, 3, '3種の確度修飾クラス（certain/inferred/time）が見つかること');
  for (const rule of rules) {
    assert.match(rule, /border-color:/, `${rule} に border-color が必要`);
    assert.match(rule, /box-shadow:/, `${rule} に box-shadow(glow) が必要`);
    // background があるなら rgba(...) か color-mix(...) の低アルファ表現のみ許容し、
    // 生の不透明 hex（例: background: #223344;）のような「面」は禁止。
    const bgMatch = rule.match(/background:\s*([^;]+);/);
    if (bgMatch) {
      const bgVal = bgMatch[1];
      assert.ok(
        /^(rgba\(|color-mix\()/.test(bgVal.trim()),
        `${rule} の background は rgba()/color-mix() の低アルファのみ許容（面禁則）: ${bgVal}`
      );
      // rgba(...) 直書きの場合はアルファ値そのものを検査（color-mix は既存の低%表現を目視で担保）
      const rgbaAlpha = bgVal.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/);
      if (rgbaAlpha) {
        assert.ok(parseFloat(rgbaAlpha[1]) <= 0.12, `${rule} の background アルファは薄いフィルに留めること: ${bgVal}`);
      }
    }
  }
});
test('css: 観光枠 .pf-tourism は縁(border)＋既存の淡カード(--bg-card-soft)で分析レイヤーと視覚的に分離', () => {
  const rule = (css.match(/\.pf-tourism\s*\{[^}]*\}/) || [''])[0];
  assert.match(rule, /border:/);
  assert.match(rule, /var\(--bg-card-soft\)/);
});
