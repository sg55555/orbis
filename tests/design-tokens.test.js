import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/orbis.css', import.meta.url), 'utf8');
const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
assert.ok(rootMatch, ':root ブロックが存在する');
const root = rootMatch[1];

// :root 内で定義されたカスタムプロパティ名を収集（コメント内の --name: は除外）
const rootNoComments = root.replace(/\/\*[\s\S]*?\*\//g, '');
const defs = [...rootNoComments.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);

test('foundation 代表トークンが :root に定義されている', () => {
  const required = [
    '--bg-0', '--bg-1', '--bg-panel', '--bg-control', '--bg-card',
    '--accent-cyan', '--accent-purple',
    '--text-bright', '--text-heading', '--text-2', '--text-muted', '--text-muted-2', '--text-muted-3',
    '--rim-cyan-16', '--rim-cyan-18', '--rim-cyan-20', '--rim-cyan-22', '--rim-cyan-35', '--rim-cyan-46', '--rim-cyan-68', '--rim-white-05',
    '--glow-cyan', '--glow-cyan-strong', '--glow-cyan-active', '--glow-cyan-aurora', '--glow-shadow',
    '--cat-stale', '--cat-amber-border', '--cat-amber-glow',
  ];
  const missing = required.filter((t) => !defs.includes(t));
  assert.deepEqual(missing, [], `未定義トークン: ${missing.join(', ')}`);
});

test('既存変数の値が保持されている', () => {
  assert.match(root, /--cyan:\s*#39d0ff/);
  assert.match(root, /--bg:\s*#05080f/);
  assert.match(root, /--glass-rim:\s*rgba\(90,\s*200,\s*255,\s*0?\.22\)/);
});

test(':root にカスタムプロパティの重複定義が無い', () => {
  const seen = new Set();
  const dup = [];
  for (const d of defs) {
    if (seen.has(d)) dup.push(d);
    else seen.add(d);
  }
  assert.deepEqual(dup, [], `重複定義: ${dup.join(', ')}`);
});
