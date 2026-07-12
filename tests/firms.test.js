import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frpToRadius, frpToColor, nearestCountry, acqToMs, buildFireConfig, firmsLayer,
} from '../js/layers/firms.js';
import { getLayer, tooltipFor, feedLayers, descFor } from '../js/layers/registry.js';

test('frpToRadius: √FRP を 3..24px にクランプ', () => {
  assert.equal(frpToRadius(0), 3);
  assert.ok(frpToRadius(100) > frpToRadius(25));
  assert.equal(frpToRadius(1e6), 24);
});

test('frpToColor: 弱=黄 / 中=橙 / 強=赤', () => {
  assert.deepEqual(frpToColor(10), [255, 214, 64]);
  assert.deepEqual(frpToColor(50), [255, 140, 32]);
  assert.deepEqual(frpToColor(500), [255, 64, 32]);
});

test('nearestCountry: 座標→最寄り国の日本語名', () => {
  assert.equal(nearestCountry(133.4, -24.9), 'オーストラリア'); // AS centroid 近傍
});

test('acqToMs: FIRMS の date/time を epoch ms(UTC) に', () => {
  assert.equal(acqToMs('2026-07-12', '0312'), Date.UTC(2026, 6, 12, 3, 12));
});

test('buildFireConfig: filled・暖色・半径∝FRP', () => {
  const cfg = buildFireConfig({ points: [{ lon: 1, lat: 2, frp: 50 }] });
  assert.equal(cfg.id, 'firms');
  assert.equal(cfg.filled, true);
  assert.equal(cfg.stroked, false);
  assert.deepEqual(cfg.getPosition(cfg.data[0]), [1, 2]);
  assert.deepEqual(cfg.getFillColor(cfg.data[0]).slice(0, 3), [255, 140, 32]);
  assert.ok(cfg.getRadius(cfg.data[0]) > 3);
});

test('buildFireConfig: 空 snapshot は data=[]', () => {
  assert.deepEqual(buildFireConfig(null).data, []);
});

test('firmsLayer: 統一IF＋tooltip＋feed', () => {
  const snap = { points: [{ id: 'x', lon: 133.4, lat: -24.9, frp: 42.5, confidence: 'high', acq_date: '2026-07-12', acq_time: '0312' }] };
  assert.equal(firmsLayer.id, 'firms');
  const tip = firmsLayer.tooltip(snap.points[0]);
  assert.ok(tip.includes('山火事') && tip.includes('オーストラリア') && tip.includes('42.5'));
  assert.equal(firmsLayer.tooltip(null), null);
  const items = firmsLayer.toFeedItems(snap);
  assert.equal(items[0].layerId, 'firms');
  assert.equal(items[0].lon, 133.4);
  assert.ok(items[0].title.includes('🔥'));
});

test('registry: firms が登録され tooltip/feed/説明 経由で引ける', () => {
  assert.ok(getLayer('firms'));
  assert.ok(tooltipFor('firms', { frp: 10, lon: 0, lat: 0, confidence: 'nominal', acq_date: '2026-07-12', acq_time: '0100' }));
  assert.ok(feedLayers().some((l) => l.id === 'firms'));
  assert.ok(descFor('firms').includes('FIRMS'));
});
