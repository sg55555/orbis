import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// 既存 js/lib/geo.js の性質を固定するだけ（実装前から緑）。updateFreshness の 2 群分割そのものは
// 下の静的ガード＋Task 10 の e2e（#freshness の textContent）が測る。
test('freshnessSummary: staleSec=24h で AI 3 層＋news の停止を名指しする（既存 geo.js の性質）', () => {
  const now = Date.parse('2026-09-03T00:00:00Z');
  const items = [
    { label: 'ニュース', updated: '2026-08-23T08:08:43Z' },
    { label: 'ブリーフィング', updated: '2026-08-23T08:14:18Z' },
  ];
  const r = freshnessSummary(items, now, 24 * 3600);
  assert.equal(r.stale, true);
  assert.match(r.text, /^2層 · 最新 10日前 · ⚠ /);
  assert.match(r.text, /ニュース 10日前/);
  assert.match(r.text, /ブリーフィング 10日前/);
});

// updateFreshness は main.js の module 内関数で、maplibre/deck を読む main.js は node:test から
// import できない。ここは 2 群分割の式を**丸ごと**固定する静的ガード（部分文字列だけだと引数の
// 取り違えを見逃すため）。実挙動は Task 10 の e2e（#freshness の textContent に `／ AI `）が測る。
test('main.js: #freshness は AI 3 層＋news を FRESH_AI_MS（24h）で別集計する', () => {
  const src = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ FRESH_AI_MS \} from '\.\/ui\/ai-meta\.js';/);
  assert.ok(src.includes(
    "(l.id === 'news' ? aiItems : items).push({ label: l.label, updated: snap.updated });"),
  'news だけ 24h 群へ振り分ける');
  assert.ok(src.includes(
    'const ai = aiItems.length\n    ? freshnessSummary(aiItems, Date.now(), FRESH_AI_MS / 1000)\n    : null;'),
  'AI 群は FRESH_AI_MS 基準で別集計する');
  assert.ok(src.includes('el.textContent = ai ? `${text} ／ AI ${ai.text}` : text;'),
    'レイヤー群と AI 群のテキストを連結する');
  assert.ok(src.includes("el.classList.toggle('stale', stale || !!(ai && ai.stale));"),
    'stale は OR で合成する');
  assert.ok(src.includes('const _aiSnaps ='), 'AI スナップショットは module-local に持つ');
  assert.ok(!src.includes('window.__orbis.instability, window.__orbis.forecasts'),
    'AI 3 層のデータ経路は _aiSnaps 一本（window.__orbis はデバッグ用ミラー）');
});
