import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fipsToJa, FIPS_JA, rootToJa, severityRank } from '../js/lib/places.js';

test('fipsToJa: 既知コードは「日本語名（CODE）」に展開', () => {
  assert.equal(fipsToJa('AS'), 'オーストラリア（AS）');
  assert.equal(fipsToJa('CH'), '中国（CH）'); // FIPSのCHは中国（スイスではない）
  assert.equal(fipsToJa('SF'), '南アフリカ（SF）');
  assert.equal(fipsToJa('UK'), 'イギリス（UK）');
  assert.equal(fipsToJa('UP'), 'ウクライナ（UP）');
  assert.equal(fipsToJa('US'), 'アメリカ（US）');
  assert.equal(fipsToJa('FS'), '仏領南方・南極地域（FS）'); // country_bounds にあり FIPS_JA 未収載だった
});

test('fipsToJa: 小文字/前後空白も正規化', () => {
  assert.equal(fipsToJa(' fr '), 'フランス（FR）');
});

test('fipsToJa: 未知コードは素のコードにフォールバック', () => {
  assert.equal(fipsToJa('ZZ'), 'ZZ');
  assert.equal(fipsToJa('OS'), 'OS');
});

test('fipsToJa: 空/null/非文字列は空文字', () => {
  assert.equal(fipsToJa(''), '');
  assert.equal(fipsToJa(null), '');
  assert.equal(fipsToJa(undefined), '');
  assert.equal(fipsToJa(123), '');
});

test('FIPS_JA: 罠コードがISOではなくFIPSの意味を持つ', () => {
  assert.equal(FIPS_JA.CH, '中国');   // ISOなら中国はCN
  assert.equal(FIPS_JA.SF, '南アフリカ');
  assert.equal(FIPS_JA.AS, 'オーストラリア');
  assert.equal(FIPS_JA.AU, 'オーストリア'); // FIPSのAUはオーストリア
});

test('FIPS_JA: 補完した係争地・属領コード（GDELT 出現・FIPS 10-4）を収載', () => {
  assert.equal(FIPS_JA.GZ, 'ガザ地区');   // ガザ地区（WE=ヨルダン川西岸 と対）
  assert.equal(FIPS_JA.JE, 'ジャージー'); // チャネル諸島
  assert.equal(FIPS_JA.KV, 'コソボ');     // FIPS 10-4 で Kosovo は KV
  assert.equal(FIPS_JA.GK, 'ガーンジー'); // チャネル諸島
  assert.equal(FIPS_JA.IM, 'マン島');     // クラウン属領
});

test('fipsToJa: 補完コードを「日本語名（CODE）」に展開（生コード露出の解消）', () => {
  assert.equal(fipsToJa('GZ'), 'ガザ地区（GZ）');
  assert.equal(fipsToJa('JE'), 'ジャージー（JE）');
  assert.equal(fipsToJa('KV'), 'コソボ（KV）');
  assert.equal(fipsToJa('GK'), 'ガーンジー（GK）');
  assert.equal(fipsToJa('IM'), 'マン島（IM）');
});

test('rootToJa: 18/19/20→暴行/戦闘/大規模暴力・他は紛争', () => {
  assert.equal(rootToJa('18'), '暴行');
  assert.equal(rootToJa('19'), '戦闘');
  assert.equal(rootToJa('20'), '大規模暴力');
  assert.equal(rootToJa('14'), '紛争');
  assert.equal(rootToJa(undefined), '紛争');
});

test('severityRank: 20>19>18>その他=0', () => {
  assert.ok(severityRank('20') > severityRank('19'));
  assert.ok(severityRank('19') > severityRank('18'));
  assert.equal(severityRank('18'), 1);
  assert.equal(severityRank('14'), 0);
});
