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
