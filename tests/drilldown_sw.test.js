// tests/drilldown_sw.test.js
// SW の CACHE 版番号が Phase2 で v45 に上がっていることを検証（新コード/CSS を確実に配信させる）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sw = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');

test('sw.js: CACHE は orbis-v45', () => {
  assert.match(sw, /const\s+CACHE\s*=\s*['"]orbis-v45['"]/);
});

test('sw.js: bypass 条件（snapshots/raw/cartocdn）は維持', () => {
  assert.match(sw, /raw\.githubusercontent\.com/);
  assert.match(sw, /\/data\/snapshots\//);
  assert.match(sw, /cartocdn/);
});
