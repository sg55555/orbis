import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeckLayers, tooltipFor } from '../js/layers/registry.js';

const single = { id: 'a', toDeckLayer: (snap) => ({ kind: 'one', v: snap.v }) };
const multi = { id: 'b', toDeckLayer: (snap) => [{ kind: 'p' }, { kind: 'q' }] };

test('buildDeckLayers flattens single and array results, only enabled+present', () => {
  const enabled = new Set(['a', 'b']);
  const snaps = { a: { v: 1 }, b: {} };
  const out = buildDeckLayers(enabled, snaps, [single, multi]);
  assert.deepEqual(out, [{ kind: 'one', v: 1 }, { kind: 'p' }, { kind: 'q' }]);
});

test('buildDeckLayers skips disabled and missing-snapshot layers', () => {
  const out = buildDeckLayers(new Set(['a']), {}, [single, multi]);
  assert.deepEqual(out, []);
});

test('buildDeckLayers: ctx を toDeckLayer に渡す', () => {
  let seen = null;
  const fake = { id: 'x', toDeckLayer: (snap, ctx) => { seen = ctx; return []; } };
  buildDeckLayers(new Set(['x']), { x: { points: [] } }, [fake], { zoom: 7 });
  assert.deepEqual(seen, { zoom: 7 });
});

test('tooltipFor: flights-dot は flights のツールチップに解決', () => {
  assert.equal(tooltipFor('flights-dot', { callsign: 'AB', alt: null, on_ground: true, velocity: 0 }),
    '便名 AB｜高度 地上｜速度 0m/s');
});
