import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);

// master から再生成された PWA PNG が存在し非空であること（壊れ/空ファイル検出）。
for (const [f, min] of [
  ['icons/icon-512.png', 8000],
  ['icons/icon-192.png', 1500],
  ['icons/apple-touch-icon.png', 1500],
]) {
  test(`${f} が生成され非空`, () => {
    const s = statSync(new URL(f, root));
    assert.ok(s.size > min, `${f} サイズ ${s.size} が小さすぎ`);
  });
}

test('icon-master.svg が viewBox 512 の自己完結SVG', () => {
  const svg = readFileSync(new URL('icon-master.svg', root), 'utf8');
  assert.match(svg, /viewBox="0 0 512 512"/);
  assert.ok(!svg.includes('<text'), '<text> 非使用（幾何で表現）');
});
