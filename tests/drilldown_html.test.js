// tests/drilldown_html.test.js
// index.html に #drilldown パネル（render 層が querySelector する DOM 構造）が存在することを検証。
// mobile-tabs を触っていない（3ボタン hardcode 維持）ことも回帰ガード。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

test('index.html: #drilldown aside と必須 child クラスが存在', () => {
  assert.match(html, /<aside id="drilldown"[^>]*class="drill-panel"[^>]*hidden/);
  assert.match(html, /class="dd-head"/);
  assert.match(html, /class="dd-title"/);
  assert.match(html, /class="dd-watch"/);
  assert.match(html, /class="dd-close"/);
  assert.match(html, /class="dd-state"/);
  assert.match(html, /class="dd-body"/);
  assert.match(html, /class="dd-watchlist"/);
  assert.match(html, /class="dd-wl-list"/);
});

test('index.html: mobile-tabs は3ボタンのまま（mobile-nav.js 無改修の前提を守る）', () => {
  const tabs = (html.match(/class="mobile-tab"/g) || []).length;
  assert.equal(tabs, 3, 'mobile-tab は layers/feed/legend の3つから増えていない');
});
