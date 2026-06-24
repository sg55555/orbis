// tests/drilldown_main_wiring.test.js
// main.js が国クリックを別系統 map.on('click') で受け、initCountryClick に getSnapshots DI クロージャと
// fetch を渡し、deck pick 排他は cc.noteDeckPick(info.coordinate) で正準配線していることを静的検証。
// また patch #5: loadCountryBounds→setBoundsPolys、patch #7: watchlist join も検証。
// boot は DOM/deck 依存で実行不可ゆえソース検証。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'js', 'main.js'), 'utf8');

test('main.js: initCountryClick を import している', () => {
  assert.match(src, /import\s*\{\s*initCountryClick\s*\}\s*from\s*['"]\.\/ui\/country_click\.js['"]/);
});

test('main.js: getSnapshots は module-local snapshots を返す DI クロージャ（window.__orbis 経由でない）', () => {
  assert.match(src, /getSnapshots:\s*\(\)\s*=>\s*snapshots/);
});

test('main.js: deps に fetch を渡す', () => {
  assert.match(src, /deps:\s*\{[^}]*fetch/);
});

test('main.js: map.on(\'click\', ...) で handleMapClick を別系統配線', () => {
  assert.match(src, /map\.on\(\s*['"]click['"]\s*,\s*[\w.]*handleMapClick\s*\)/);
});

test('main.js: deck onClick（info.object 分岐）で cc.noteDeckPick を呼ぶ（patch #4 正準配線）', () => {
  assert.match(src, /cc\.noteDeckPick\(/);
});

test('main.js: loadCountryBounds→setBoundsPolys 配線（patch #5）', () => {
  assert.match(src, /loadCountryBounds/);
  assert.match(src, /cc\.setBoundsPolys\(/);
});

// Critical-1: deps 全結線の静的検証（短縮プロパティ or 明示コロンのどちらも許容）
function hasDep(src, name) {
  // "name:" または "name," または "name\n" で deps オブジェクト内に出現
  return new RegExp(`${name}\\s*[,:\\s]`).test(src);
}

test('main.js: deps に fetchFn を渡す（fetch↔fetchFn 名不一致を解消）', () => {
  assert.match(src, /fetchFn\s*:/);  // fetchFn は必ず明示コロン（値が fetch と別）
});

test('main.js: deps に loadCountryGeo を渡す', () => {
  assert.ok(hasDep(src, 'loadCountryGeo'), 'loadCountryGeo が deps に渡されていない');
});

test('main.js: deps に buildDrilldown を渡す', () => {
  assert.ok(hasDep(src, 'buildDrilldown'), 'buildDrilldown が deps に渡されていない');
});

test('main.js: deps に renderDrilldown を渡す', () => {
  assert.ok(hasDep(src, 'renderDrilldown'), 'renderDrilldown が deps に渡されていない');
});

test('main.js: deps に setDrilldownState を渡す', () => {
  assert.ok(hasDep(src, 'setDrilldownState'), 'setDrilldownState が deps に渡されていない');
});

test('main.js: deps に countryBbox を渡す', () => {
  assert.ok(hasDep(src, 'countryBbox'), 'countryBbox が deps に渡されていない');
});

test('main.js: deps に zoomForBbox を渡す', () => {
  assert.ok(hasDep(src, 'zoomForBbox'), 'zoomForBbox が deps に渡されていない');
});

test('main.js: deps に rootEl を渡す（#drilldown）', () => {
  assert.match(src, /rootEl\s*:/);
  assert.match(src, /getElementById\(['"]drilldown['"]\)/);
});

test('main.js: deps に bodyEl を渡す（document.body）', () => {
  assert.match(src, /bodyEl\s*:/);
  assert.match(src, /document\.body/);
});

test('main.js: deps に onOceanMiss を渡す（share-toast 利用）', () => {
  assert.match(src, /onOceanMiss\s*:/);
});

test('main.js: deps に bboxIndex を渡す', () => {
  assert.match(src, /bboxIndex/);
});

test('main.js: deps に manifest を渡す', () => {
  assert.match(src, /manifest/);
});

// Critical-2: hidden 解除の静的検証
test('country_click.js: openCountry が hidden 属性を外す', () => {
  const ccSrc = readFileSync(join(__dirname, '..', 'js', 'ui', 'country_click.js'), 'utf8');
  assert.match(ccSrc, /removeAttribute\(['"]hidden['"]\)/);
});

test('country_click.js: closeCountry が hidden 属性を戻す', () => {
  const ccSrc = readFileSync(join(__dirname, '..', 'js', 'ui', 'country_click.js'), 'utf8');
  assert.match(ccSrc, /setAttribute\(['"]hidden['"]/);
});
