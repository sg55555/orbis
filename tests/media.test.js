import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildEmbedUrl, thumbUrl, defaultItem, itemById,
  areasPresent, camsByArea, gridCount, gridSlots, AREA_LABEL,
} from '../js/ui/media.js';

const NEWS = [
  { id: 'aljazeera', name: 'Al Jazeera English', channel_id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', region: 'ドーハ', lat: 25.28, lon: 51.53 },
  { id: 'dw', name: 'DW News', channel_id: 'UCknLrEdhRCp1aegoMqRaCZg', region: 'ベルリン', lat: 52.52, lon: 13.40 },
];
const CAMS = [
  { id: 'shibuya', name: '渋谷', region: '東京', area: 'asia', video_id: '8H3nRCFVR6Y', lat: 35.66, lon: 139.70 },
  { id: 'london', name: 'London', region: 'ロンドン', area: 'europe', video_id: 'M3EYAY2MftI', lat: 51.51, lon: -0.13 },
  { id: 'paris', name: 'Paris', region: 'パリ', area: 'europe', video_id: 'OzYp4NRZlwQ', lat: 48.86, lon: 2.29 },
];

test('buildEmbedUrl: channel_id 形式（youtube-nocookie）', () => {
  const u = buildEmbedUrl(NEWS[0]);
  assert.ok(u.startsWith('https://www.youtube-nocookie.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg'), u);
  assert.ok(u.includes('autoplay=1') && u.includes('mute=1'));
  assert.ok(!u.includes('www.youtube.com/'), '通常ドメインを使わない');
});

test('buildEmbedUrl: video_id 形式（youtube-nocookie）', () => {
  const u = buildEmbedUrl(CAMS[0]);
  assert.ok(u.startsWith('https://www.youtube-nocookie.com/embed/8H3nRCFVR6Y?'), u);
  assert.ok(u.includes('playsinline=1') && !u.includes('live_stream'));
  assert.ok(!u.includes('www.youtube.com/'), '通常ドメインを使わない');
});

test('buildEmbedUrl: 既定で日本語字幕パラメータ付き（channel/video 両形式）', () => {
  const ch = buildEmbedUrl(NEWS[0]);
  const vid = buildEmbedUrl(CAMS[0]);
  for (const u of [ch, vid]) {
    assert.ok(u.includes('cc_load_policy=1'), `cc_load_policy: ${u}`);
    assert.ok(u.includes('cc_lang_pref=ja'), `cc_lang_pref: ${u}`);
    assert.ok(u.includes('hl=ja'), `hl: ${u}`);
  }
});

test('buildEmbedUrl: captions=false で字幕パラメータを付けない', () => {
  const u = buildEmbedUrl(NEWS[0], { captions: false });
  assert.ok(!u.includes('cc_load_policy'), u);
  assert.ok(!u.includes('cc_lang_pref'), u);
  assert.ok(!u.includes('hl=ja'), u);
  assert.ok(u.includes('autoplay=1'), u); // 再生パラメータは維持
});

test('thumbUrl: video_id あり/なし', () => {
  assert.equal(thumbUrl(CAMS[0]), 'https://i.ytimg.com/vi/8H3nRCFVR6Y/hqdefault.jpg');
  assert.equal(thumbUrl({ id: 'x', channel_id: 'C' }), '');
});

test('defaultItem / itemById', () => {
  assert.equal(defaultItem(NEWS), NEWS[0]);
  assert.equal(defaultItem([]), null);
  assert.equal(defaultItem(null), null);
  assert.equal(itemById(CAMS, 'paris'), CAMS[2]);
  assert.equal(itemById(CAMS, 'nope'), null);
  assert.equal(itemById(null, 'x'), null);
});

test('areasPresent: 実在areaを定義順＋先頭all・空除外', () => {
  assert.deepEqual(areasPresent(CAMS), ['all', 'europe', 'asia']);
  assert.deepEqual(areasPresent([]), ['all']);
});

test('camsByArea: all=全件 / 指定=フィルタ / 不一致=空', () => {
  assert.equal(camsByArea(CAMS, 'all').length, 3);
  assert.deepEqual(camsByArea(CAMS, 'europe').map((c) => c.id), ['london', 'paris']);
  assert.deepEqual(camsByArea(CAMS, 'africa'), []);
});

test('gridCount: 1/4/6 維持・不正は4', () => {
  assert.equal(gridCount(1), 1);
  assert.equal(gridCount(4), 4);
  assert.equal(gridCount(6), 6);
  assert.equal(gridCount(3), 4);
  assert.equal(gridCount('6'), 6);
});

test('gridSlots: 先頭count枚＋不足はnullパディング', () => {
  assert.deepEqual(gridSlots(CAMS, 1).map((s) => s && s.id), ['shibuya']);
  assert.deepEqual(gridSlots(CAMS, 4).map((s) => s && s.id), ['shibuya', 'london', 'paris', null]);
  assert.equal(gridSlots(CAMS, 6).length, 6);
});

test('AREA_LABEL: 主要キーが日本語', () => {
  assert.equal(AREA_LABEL.all, 'すべて');
  assert.equal(AREA_LABEL.space, '宇宙');
  assert.equal(AREA_LABEL.middle_east, '中東');
});

test('buildEmbedUrl: video_id / channel_id を URL エンコードする（設定値の混入を止める）', () => {
  const v = buildEmbedUrl({ id: 'x', video_id: 'a b&autoplay=0' });
  assert.ok(v.startsWith('https://www.youtube-nocookie.com/embed/a%20b%26autoplay%3D0?'), v);
  const c = buildEmbedUrl({ id: 'y', channel_id: 'C?x=1' });
  assert.ok(c.includes('channel=C%3Fx%3D1'), c);
});

test('index.html / cams-pane.js: 埋め込み iframe に referrerpolicy が付く', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<iframe id="news-frame"[^>]*referrerpolicy="strict-origin-when-cross-origin"/);
  const cams = readFileSync(new URL('../js/ui/cams-pane.js', import.meta.url), 'utf8');
  assert.ok(cams.includes("f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');"), cams);
});

test('index.html: AI 字幕トグルの脇に送信先の注記がある', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(
    '<small class="lc-note">タブの音声をこの端末の変換サーバー（localhost:8900）へ送ります。外部には送信しません。</small>'
  ), html);
});
