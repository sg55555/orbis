import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fipsToJa, FIPS_JA } from '../js/lib/places.js';

test('fipsToJa: 既知コードは「日本語名（CODE）」に展開', () => {
  assert.equal(fipsToJa('AS'), 'オーストラリア（AS）');
  assert.equal(fipsToJa('CH'), '中国（CH）'); // FIPSのCHは中国（スイスではない）
  assert.equal(fipsToJa('SF'), '南アフリカ（SF）');
  assert.equal(fipsToJa('UK'), 'イギリス（UK）');
  assert.equal(fipsToJa('UP'), 'ウクライナ（UP）');
  assert.equal(fipsToJa('US'), 'アメリカ（US）');
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
