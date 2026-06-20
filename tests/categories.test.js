import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, groupLayers } from '../js/lib/categories.js';
import { allLayerIds } from '../js/layers/registry.js';

const fakeLayers = (ids) => ids.map((id) => ({ id, label: id.toUpperCase() }));
const ALL = ['quakes', 'flights', 'conflict', 'protests', 'trade', 'sst', 'currents', 'airtemp', 'ships', 'news'];

test('groupLayers: 3カテゴリを順に返し各群の中身が正しい', () => {
  const groups = groupLayers(fakeLayers(ALL));
  assert.deepEqual(groups.map((g) => g.id), ['events', 'mobility', 'environment']);
  assert.deepEqual(groups[0].layers.map((l) => l.id), ['quakes', 'conflict', 'protests', 'news']);
  assert.deepEqual(groups[1].layers.map((l) => l.id), ['flights', 'ships', 'trade']);
  assert.deepEqual(groups[2].layers.map((l) => l.id), ['sst', 'currents', 'airtemp']);
});

test('groupLayers: 群内順は CATEGORIES.layerIds の順（入力順に依存しない）', () => {
  const groups = groupLayers(fakeLayers(['news', 'protests', 'conflict', 'quakes']));
  assert.deepEqual(groups[0].layers.map((l) => l.id), ['quakes', 'conflict', 'protests', 'news']);
});

test('groupLayers: 未収載レイヤーは末尾「その他」群', () => {
  const groups = groupLayers(fakeLayers(['quakes', 'zzz']));
  const other = groups[groups.length - 1];
  assert.equal(other.id, 'other');
  assert.equal(other.label, 'その他');
  assert.deepEqual(other.layers.map((l) => l.id), ['zzz']);
});

test('groupLayers: 該当0件のカテゴリはスキップ（空見出しを出さない）', () => {
  const groups = groupLayers(fakeLayers(['quakes']));
  assert.deepEqual(groups.map((g) => g.id), ['events']);
});

test('整合性: registry の全 layer id がちょうど1カテゴリに属す', () => {
  for (const id of allLayerIds()) {
    const hits = CATEGORIES.filter((c) => c.layerIds.includes(id));
    assert.equal(hits.length, 1, `${id} が属すカテゴリ数=${hits.length}`);
  }
});

test('整合性: CATEGORIES の全 layerId が registry に実在', () => {
  const ids = new Set(allLayerIds());
  for (const c of CATEGORIES) for (const id of c.layerIds) assert.ok(ids.has(id), `${c.id}: 未知 ${id}`);
});
