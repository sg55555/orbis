import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAgeSec, freshnessSummary } from '../js/lib/geo.js';

test('formatAgeSec renders Japanese relative buckets', () => {
  assert.equal(formatAgeSec(0), 'たった今');
  assert.equal(formatAgeSec(59), 'たった今');
  assert.equal(formatAgeSec(60), '1分前');
  assert.equal(formatAgeSec(3599), '59分前');
  assert.equal(formatAgeSec(3600), '1時間前');
  assert.equal(formatAgeSec(86400), '1日前');
});

test('freshnessSummary shows layer count and freshest age when all current', () => {
  const now = Date.parse('2026-06-18T12:00:00Z');
  const items = [
    { label: '地震', updated: '2026-06-18T11:58:00Z' }, // 2分前
    { label: '航空', updated: '2026-06-18T11:59:30Z' }, // 30秒前→たった今
  ];
  const r = freshnessSummary(items, now);
  assert.equal(r.stale, false);
  assert.equal(r.text, '2層 · 最新 たった今');
});

test('freshnessSummary names stale layers (>6h) oldest-first with warning', () => {
  const now = Date.parse('2026-06-18T12:00:00Z');
  const items = [
    { label: '地震', updated: '2026-06-18T11:58:00Z' },  // 2分前
    { label: '気温', updated: '2026-06-16T12:00:00Z' },  // 2日前 stale
    { label: '水温', updated: '2026-06-18T03:00:00Z' },  // 9時間前 stale
  ];
  const r = freshnessSummary(items, now);
  assert.equal(r.stale, true);
  assert.equal(r.text, '3層 · 最新 2分前 · ⚠ 気温 2日前 水温 9時間前');
});

test('freshnessSummary handles empty input', () => {
  assert.deepEqual(freshnessSummary([], Date.now()), { text: 'データ取得中…', stale: false });
});
