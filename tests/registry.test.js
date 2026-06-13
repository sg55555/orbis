import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeckLayers } from '../js/layers/registry.js';

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
