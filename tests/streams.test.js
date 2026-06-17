import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbedUrl, defaultChannel, channelById } from '../js/ui/streams.js';

const CH = [
  { id: 'aljazeera', name: 'Al Jazeera English', channel_id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', region: 'ドーハ', lat: 25.28, lon: 51.53 },
  { id: 'dw', name: 'DW News', channel_id: 'UCknLrEdhRCp1aegoMqRaCZg', region: 'ベルリン', lat: 52.52, lon: 13.40 },
];

test('buildEmbedUrl: channel_id を埋め込み autoplay/mute を含む', () => {
  const u = buildEmbedUrl(CH[0]);
  assert.ok(u.includes('channel=UCNye-wNBqNL5ZzHSJj3l8Bg'));
  assert.ok(u.includes('autoplay=1'));
  assert.ok(u.includes('mute=1'));
  assert.ok(u.startsWith('https://www.youtube.com/embed/live_stream'));
});

test('defaultChannel: 先頭を返す / 空配列・非配列は null', () => {
  assert.equal(defaultChannel(CH), CH[0]);
  assert.equal(defaultChannel([]), null);
  assert.equal(defaultChannel(null), null);
});

test('channelById: 一致を返す / 不一致は null', () => {
  assert.equal(channelById(CH, 'dw'), CH[1]);
  assert.equal(channelById(CH, 'nope'), null);
  assert.equal(channelById(null, 'dw'), null);
});
