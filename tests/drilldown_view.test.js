import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degradedNoticeHtml } from '../js/lib/drilldown/drilldown_view.js';

test('degradedNoticeHtml: 4種すべてが固有の説明文を返す', () => {
  const extra = degradedNoticeHtml('extra');
  const ocean = degradedNoticeHtml('ocean');
  const missing = degradedNoticeHtml('missing');
  const fetcherror = degradedNoticeHtml('fetcherror');
  // 各文言は固有（取り違え防止）
  assert.match(extra, /県別集計/);
  assert.match(ocean, /国を特定/);
  assert.match(missing, /データがありません|未整備/);
  assert.match(fetcherror, /再試行|取得に失敗/);
  // 4種すべて互いに異なる
  const set = new Set([extra, ocean, missing, fetcherror]);
  assert.equal(set.size, 4);
});

test('degradedNoticeHtml: 既知の class でラップされ DOM 非依存の文字列', () => {
  const html = degradedNoticeHtml('extra');
  assert.match(html, /class="dd-degraded"/);
  assert.equal(typeof html, 'string');
});

test('degradedNoticeHtml: 未知 kind は汎用フォールバック文（落ちない）', () => {
  const html = degradedNoticeHtml('unknown-kind-xyz');
  assert.equal(typeof html, 'string');
  assert.match(html, /class="dd-degraded"/);
});
