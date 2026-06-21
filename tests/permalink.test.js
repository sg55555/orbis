import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePermalink, buildPermalink } from '../js/lib/permalink.js';

test('parsePermalink: 正常な ll/z/layers を解析（center は [lng,lat] 順）', () => {
  const r = parsePermalink('?ll=35.6,139.7&z=4.5&layers=quakes,conflict,news');
  assert.deepEqual(r.center, [139.7, 35.6]);
  assert.equal(r.zoom, 4.5);
  assert.deepEqual(r.layers, ['quakes', 'conflict', 'news']);
});

test('parsePermalink: 欠落は各 null', () => {
  const r = parsePermalink('');
  assert.equal(r.center, null);
  assert.equal(r.zoom, null);
  assert.equal(r.layers, null);
  const r2 = parsePermalink('?foo=bar');
  assert.equal(r2.center, null);
  assert.equal(r2.zoom, null);
  assert.equal(r2.layers, null);
});

test('parsePermalink: 範囲外/非数値/不正形式は null', () => {
  assert.equal(parsePermalink('?ll=200,400').center, null); // 緯度経度範囲外
  assert.equal(parsePermalink('?ll=abc,def').center, null);
  assert.equal(parsePermalink('?ll=35.6').center, null); // カンマ無し
  assert.equal(parsePermalink('?z=99').zoom, null); // ズーム範囲外
  assert.equal(parsePermalink('?z=abc').zoom, null);
});

test('parsePermalink: 似た名前のパラメータを誤認しない（gz/cmap 等）', () => {
  // ?gz=55 の z や ?cmap の ll に引っ張られない
  assert.equal(parsePermalink('?gz=55').zoom, null);
  assert.equal(parsePermalink('?gz=55&z=3').zoom, 3);
});

test('parsePermalink: layers の空要素除去・空値→[]・キー無し→null', () => {
  assert.deepEqual(parsePermalink('?layers=quakes,,news,').layers, ['quakes', 'news']);
  assert.deepEqual(parsePermalink('?layers=').layers, []); // 空値=全OFF
  assert.equal(parsePermalink('?z=3').layers, null); // キー無し
});

test('buildPermalink: 丸め（4桁/2桁）・join・未指定キー省略', () => {
  const url = buildPermalink('https://x.app/', { center: [139.76543, 35.61234], zoom: 4.567, layers: ['quakes', 'news'] });
  assert.equal(url, 'https://x.app/?ll=35.6123,139.7654&z=4.57&layers=quakes,news');
  assert.equal(buildPermalink('https://x.app/', { zoom: 3 }), 'https://x.app/?z=3.00');
  assert.equal(buildPermalink('https://x.app/', {}), 'https://x.app/'); // 全欠落＝baseのみ
  assert.equal(buildPermalink('https://x.app/', { layers: [] }), 'https://x.app/?layers='); // 空配列=全OFF
});

test('round-trip: build→parse で一致（丸め誤差内）', () => {
  const center = [139.7654, 35.6123], zoom = 4.57, layers = ['quakes', 'conflict'];
  const url = buildPermalink('https://x.app/', { center, zoom, layers });
  const r = parsePermalink(url.slice(url.indexOf('?')));
  assert.deepEqual(r.center, center);
  assert.equal(r.zoom, zoom);
  assert.deepEqual(r.layers, layers);
});
