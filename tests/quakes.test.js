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

// --- P1: 地域・国名の日本語化拡張（USGS 形式網羅）---
test('quakePlaceJa: 米州を網羅（フル名＋2文字略号）', () => {
  assert.equal(quakePlaceJa('5 km N of Denver, Colorado'), 'Denver の北 5km（コロラド州）');
  assert.equal(quakePlaceJa('78 km NE of Tonopah, NV'), 'Tonopah の北東 78km（ネバダ州）');
});

test('quakePlaceJa: 準州・特別地域を日本語化', () => {
  assert.equal(quakePlaceJa('10 km S of Fajardo, Puerto Rico'), 'Fajardo の南 10km（プエルトリコ）');
  assert.equal(quakePlaceJa('30 km NW of Cruz Bay, U.S. Virgin Islands'),
    'Cruz Bay の北西 30km（アメリカ領ヴァージン諸島）');
});

test('quakePlaceJa: 主要国・略号を日本語化', () => {
  assert.equal(quakePlaceJa('7 km E of San Salvador, El Salvador'), 'San Salvador の東 7km（エルサルバドル）');
  assert.equal(quakePlaceJa('12 km S of Santo Domingo, Dominican Republic'),
    'Santo Domingo の南 12km（ドミニカ共和国）');
  assert.equal(quakePlaceJa('20 km W of Salta, Argentina'), 'Salta の西 20km（アルゼンチン）');
  assert.equal(quakePlaceJa('5 km N of Jamestown, Saint Helena'), 'Jamestown の北 5km（セントヘレナ）');
  assert.equal(quakePlaceJa('15 km SW of Tijuana, MX'), 'Tijuana の南西 15km（メキシコ）');
});

test('quakePlaceJa: カンマ無し形式（region / coast / 方角-of）を日本語化', () => {
  assert.equal(quakePlaceJa('Japan region'), '日本 付近');
  assert.equal(quakePlaceJa('South Sandwich Islands region'), 'サウスサンドウィッチ諸島 付近');
  assert.equal(quakePlaceJa('off the coast of Oregon'), 'オレゴン州 沖');
  assert.equal(quakePlaceJa('west of Macquarie Island'), 'マッコーリー島 の西');
});

test('quakePlaceJa: 方角接頭辞・サフィックスの "X region"・島嶼 head を日本語化', () => {
  assert.equal(quakePlaceJa('western Xizang'), 'チベット西部'); // 方角接頭辞＋地名
  assert.equal(quakePlaceJa('Izu Islands, Japan region'), '伊豆諸島（日本）'); // head島嶼＋"X region"サフィックス
  assert.equal(quakePlaceJa('central Italy'), 'イタリア中部');
  assert.equal(quakePlaceJa('eastern Honshu, Japan'), '本州東部（日本）'); // head方角接頭辞＋通常サフィックス
});
