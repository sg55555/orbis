import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, DEFAULT_PRESET, presetById, applyPreset, activePresetId } from '../js/lib/presets.js';
import { allLayerIds } from '../js/layers/registry.js';

test('PRESETS の全レイヤーIDが registry に実在', () => {
  const ids = new Set(allLayerIds());
  for (const p of PRESETS) for (const id of p.layers) assert.ok(ids.has(id), `${p.id}: 未知レイヤー ${id}`);
});
test('DEFAULT_PRESET は overview / 概観の中身', () => {
  assert.equal(DEFAULT_PRESET, 'overview');
  assert.deepEqual(presetById('overview').layers, ['quakes', 'news', 'conflict', 'protests', 'currents']);
});
test('applyPreset: その層だけの排他集合', () => {
  assert.deepEqual([...applyPreset('weather')].sort(), ['airtemp', 'currents', 'sst']);
});
test('applyPreset: 未知idは空集合', () => {
  assert.equal(applyPreset('zzz').size, 0);
});
test('activePresetId: 完全一致でid、部分/余分は null(カスタム)', () => {
  assert.equal(activePresetId(new Set(['sst', 'currents', 'airtemp'])), 'weather');
  assert.equal(activePresetId(new Set(['sst', 'currents'])), null);
  assert.equal(activePresetId(new Set(['sst', 'currents', 'airtemp', 'quakes'])), null);
});
