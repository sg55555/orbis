import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRingConfig, quakePlaceJa, quakesLayer } from '../js/layers/quakes.js';

test('quakePlaceJa: "N km DIR of PLACE, REGION" を日本語化', () => {
  assert.equal(quakePlaceJa('3 km W of The Geysers, CA'), 'The Geysers の西 3km（カリフォルニア州）');
  assert.equal(quakePlaceJa('37 km S of Skwentna, Alaska'), 'Skwentna の南 37km（アラスカ州）');
});

test('quakePlaceJa: 未知地域はそのまま括弧付き、非km形式は素通し', () => {
  assert.equal(quakePlaceJa('Island of Foo, Nowhere'), 'Island of Foo（Nowhere）');
  assert.equal(quakePlaceJa('Nevada'), 'ネバダ州'); // 既知単独地域は訳す
  assert.equal(quakePlaceJa(''), '');
});

test('quakes tooltip: 規模ラベル＋日本語震源', () => {
  assert.equal(quakesLayer.tooltip({ mag: 3.6, place: '3 km W of Cobb, CA' }),
    '地震 規模M3.6｜震源 Cobb の西 3km（カリフォルニア州）');
});

test('buildRingConfig: 中空リング（stroked, filled:false）', () => {
  const cfg = buildRingConfig({ points: [{ lon: 1, lat: 2, mag: 5 }] });
  assert.equal(cfg.id, 'quakes');
  assert.equal(cfg.stroked, true);
  assert.equal(cfg.filled, false);
  assert.equal(cfg.pickable, true);
  assert.deepEqual(cfg.getPosition({ lon: 1, lat: 2 }), [1, 2]);
});

test('buildRingConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildRingConfig(null).data, []);
});
