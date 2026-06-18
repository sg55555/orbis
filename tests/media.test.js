import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbedUrl, defaultItem, itemById } from '../js/ui/media.js';

const NEWS = [
  { id: 'aljazeera', name: 'Al Jazeera English', channel_id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', region: 'ドーハ', lat: 25.28, lon: 51.53 },
  { id: 'dw', name: 'DW News', channel_id: 'UCknLrEdhRCp1aegoMqRaCZg', region: 'ベルリン', lat: 52.52, lon: 13.40 },
];
const CAM = { id: 'shibuya', name: '渋谷', channel_id: undefined, video_id: '8H3nRCFVR6Y', region: '東京', lat: 35.66, lon: 139.70 };

test('buildEmbedUrl: channel_id 形式（live_stream）', () => {
  const u = buildEmbedUrl(NEWS[0]);
  assert.ok(u.startsWith('https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg'));
  assert.ok(u.includes('autoplay=1') && u.includes('mute=1'));
});

test('buildEmbedUrl: video_id 形式（embed/<id>）', () => {
  const u = buildEmbedUrl(CAM);
  assert.ok(u.startsWith('https://www.youtube.com/embed/8H3nRCFVR6Y?'));
  assert.ok(u.includes('autoplay=1') && u.includes('mute=1') && u.includes('playsinline=1'));
  assert.ok(!u.includes('live_stream'));
});

test('defaultItem: 先頭 / 空・null は null', () => {
  assert.equal(defaultItem(NEWS), NEWS[0]);
  assert.equal(defaultItem([]), null);
  assert.equal(defaultItem(null), null);
});

test('itemById: 一致 / 不一致 null', () => {
  assert.equal(itemById(NEWS, 'dw'), NEWS[1]);
  assert.equal(itemById(NEWS, 'nope'), null);
  assert.equal(itemById(null, 'dw'), null);
});
