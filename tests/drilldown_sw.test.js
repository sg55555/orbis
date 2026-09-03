// tests/drilldown_sw.test.js
// SW の CACHE 版番号と bypass 方針。Phase A（Task 9）で v52・同一オリジン判定に変更。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sw = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');

test('sw.js: CACHE は orbis-v52', () => {
  assert.match(sw, /const\s+CACHE\s*=\s*['"]orbis-v52['"]/);
});

test('sw.js: bypass は「別オリジン全部」＋ローカルの生スナップショット', () => {
  // raw.githubusercontent.com / タイル / YouTube はホスト名の列挙ではなく origin 判定で素通し。
  assert.match(sw, /url\.origin !== self\.location\.origin/);
  assert.match(sw, /\/data\/snapshots\//);
  assert.doesNotMatch(sw, /cartocdn/);            // 死んだ参照は消した
  assert.doesNotMatch(sw, /raw\.githubusercontent\.com/); // ホスト名の個別列挙は不要
});
