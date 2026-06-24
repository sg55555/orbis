import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRingConfig, quakePlaceJa, quakesLayer } from '../js/layers/quakes.js';

test('quakePlaceJa: "N km DIR of PLACE, REGION" を地域（国）先頭で日本語化', () => {
  assert.equal(quakePlaceJa('3 km W of The Geysers, CA'), 'カリフォルニア州（アメリカ） The Geysers の西 3km');
  assert.equal(quakePlaceJa('37 km S of Skwentna, Alaska'), 'アラスカ州（アメリカ） Skwentna の南 37km');
});

test('quakePlaceJa: 未知地域は地域先頭でそのまま、空文字は空', () => {
  assert.equal(quakePlaceJa('Island of Foo, Nowhere'), 'Nowhere Island of Foo');
  assert.equal(quakePlaceJa('Nevada'), 'ネバダ州（アメリカ）'); // 既知単独地域は地域（国）
  assert.equal(quakePlaceJa(''), '');
});

test('quakes tooltip: 規模ラベル＋地域（国）先頭の日本語震源', () => {
  assert.equal(quakesLayer.tooltip({ mag: 3.6, place: '3 km W of Cobb, CA' }),
    '地震 規模M3.6｜震源 カリフォルニア州（アメリカ） Cobb の西 3km');
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
test('quakePlaceJa: 米州を網羅（フル名＋2文字略号）・国名アメリカ付き', () => {
  assert.equal(quakePlaceJa('5 km N of Denver, Colorado'), 'コロラド州（アメリカ） Denver の北 5km');
  assert.equal(quakePlaceJa('78 km NE of Tonopah, NV'), 'ネバダ州（アメリカ） Tonopah の北東 78km');
});

test('quakePlaceJa: 準州・特別地域を日本語化（国名アメリカ・名前に含む場合は二重化しない）', () => {
  assert.equal(quakePlaceJa('10 km S of Fajardo, Puerto Rico'), 'プエルトリコ（アメリカ） Fajardo の南 10km');
  assert.equal(quakePlaceJa('30 km NW of Cruz Bay, U.S. Virgin Islands'),
    'アメリカ領ヴァージン諸島 Cruz Bay の北西 30km'); // 既に「アメリカ」を含むので（アメリカ）を付けない
});

test('quakePlaceJa: 主要国・略号を日本語化（国そのものは重複括弧を付けない）', () => {
  assert.equal(quakePlaceJa('7 km E of San Salvador, El Salvador'), 'エルサルバドル San Salvador の東 7km');
  assert.equal(quakePlaceJa('12 km S of Santo Domingo, Dominican Republic'),
    'ドミニカ共和国 Santo Domingo の南 12km');
  assert.equal(quakePlaceJa('20 km W of Salta, Argentina'), 'アルゼンチン Salta の西 20km');
  assert.equal(quakePlaceJa('5 km N of Jamestown, Saint Helena'), 'セントヘレナ Jamestown の北 5km');
  assert.equal(quakePlaceJa('15 km SW of Tijuana, MX'), 'メキシコ Tijuana の南西 15km'); // MX→メキシコ（アメリカ誤判定しない）
});

test('quakePlaceJa: カンマ無し形式（region / coast / 方角-of）を地域（国）先頭で日本語化', () => {
  assert.equal(quakePlaceJa('Japan region'), '日本 付近');
  assert.equal(quakePlaceJa('South Sandwich Islands region'), 'サウスサンドウィッチ諸島 付近');
  assert.equal(quakePlaceJa('off the coast of Oregon'), 'オレゴン州（アメリカ） 沖');
  assert.equal(quakePlaceJa('west of Macquarie Island'), 'マッコーリー島 の西');
});

test('quakePlaceJa: 方角接頭辞・サフィックスの "X region"・島嶼 head を地域（国）付きで日本語化', () => {
  assert.equal(quakePlaceJa('western Xizang'), 'チベット西部（中国）'); // 方角接頭辞＋地名＋親国
  assert.equal(quakePlaceJa('Izu Islands, Japan region'), '日本 伊豆諸島'); // region=日本 先頭＋head島嶼
  assert.equal(quakePlaceJa('central Italy'), 'イタリア中部'); // 国そのもの＝親国なし
  assert.equal(quakePlaceJa('eastern Honshu, Japan'), '日本 本州東部'); // region=日本 先頭＋head方角接頭辞
});

// --- 地域名（国名）化＝国名が必ず見える（オーナー要望） ---
test('quakePlaceJa: 国名・地域名を先頭に出し、国名が必ず含まれる', () => {
  // 米国の地震は州だけでなく「（アメリカ）」を必ず表示（折角の国名日本語化を活かす）
  const ca = quakePlaceJa('8 km W of Cobb, CA');
  assert.ok(ca.startsWith('カリフォルニア州（アメリカ）'), `先頭が地域（国）: ${ca}`);
  // 中国の小地域も親国を表示
  assert.ok(quakePlaceJa('western Xizang').includes('（中国）'));
  // 日本の島も国名「日本」が見える
  assert.ok(quakePlaceJa('eastern Honshu, Japan').includes('日本'));
  // 国そのものは重複括弧を付けない（チリ（チリ）にしない）
  const cl = quakePlaceJa('5 km N of X, Chile');
  assert.equal(cl, 'チリ X の北 5km');
  assert.ok(!cl.includes('（チリ）'));
});
