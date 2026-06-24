import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCode, removeCode, hasCode, orderByInstability } from '../js/lib/drilldown/watchlist.js';

test('addCode: 末尾追加・順序保持・新配列を返し元を破壊しない', () => {
  const base = ['UP', 'RS'];
  const next = addCode(base, 'JA');
  assert.deepEqual(next, ['UP', 'RS', 'JA']);
  assert.deepEqual(base, ['UP', 'RS']); // 元は不変
});

test('addCode: 重複は追加しない（既存順を保持）', () => {
  assert.deepEqual(addCode(['UP', 'RS'], 'UP'), ['UP', 'RS']);
});

test('addCode: 上限30。30件で先頭を落として末尾追加（FIFO）', () => {
  const full = Array.from({ length: 30 }, (_, i) => 'C' + i); // C0..C29
  const next = addCode(full, 'NEW');
  assert.equal(next.length, 30);
  assert.equal(next[0], 'C1');          // 先頭 C0 が落ちる
  assert.equal(next[29], 'NEW');        // 末尾に NEW
});

test('addCode: 空/不正 code は無視（元と同等の配列）', () => {
  assert.deepEqual(addCode(['UP'], ''), ['UP']);
  assert.deepEqual(addCode(['UP'], null), ['UP']);
});

test('addCode: list が非配列なら code 1件の新配列', () => {
  assert.deepEqual(addCode(null, 'UP'), ['UP']);
  assert.deepEqual(addCode(undefined, 'UP'), ['UP']);
});

test('removeCode: 指定 code を除いた新配列・順序保持', () => {
  const base = ['UP', 'RS', 'JA'];
  assert.deepEqual(removeCode(base, 'RS'), ['UP', 'JA']);
  assert.deepEqual(base, ['UP', 'RS', 'JA']); // 元は不変
});

test('removeCode: 無い code は元と同等', () => {
  assert.deepEqual(removeCode(['UP'], 'ZZ'), ['UP']);
});

test('removeCode: list が非配列なら空配列', () => {
  assert.deepEqual(removeCode(null, 'UP'), []);
});

test('hasCode: 含むなら true / 含まないなら false', () => {
  assert.equal(hasCode(['UP', 'RS'], 'RS'), true);
  assert.equal(hasCode(['UP', 'RS'], 'JA'), false);
  assert.equal(hasCode(null, 'UP'), false);
});

test('orderByInstability: instability score の降順に並べ替える', () => {
  const list = ['JA', 'UP', 'RS'];
  const countries = [
    { code: 'UP', score: 90 },
    { code: 'RS', score: 70 },
    { code: 'JA', score: 5 },
  ];
  assert.deepEqual(orderByInstability(list, countries), ['UP', 'RS', 'JA']);
});

test('orderByInstability: instability に無い国（圏外）は score 0 扱いで末尾', () => {
  const list = ['JA', 'UP', 'XX'];
  const countries = [{ code: 'UP', score: 90 }, { code: 'JA', score: 50 }];
  // UP(90) > JA(50) > XX(0)
  assert.deepEqual(orderByInstability(list, countries), ['UP', 'JA', 'XX']);
});

test('orderByInstability: 同 score は元の list 順を保つ（安定）', () => {
  const list = ['A', 'B', 'C'];
  const countries = [{ code: 'A', score: 10 }, { code: 'B', score: 10 }, { code: 'C', score: 10 }];
  assert.deepEqual(orderByInstability(list, countries), ['A', 'B', 'C']);
});

test('orderByInstability: countries 欠落でも落ちない（list をそのまま返す）', () => {
  assert.deepEqual(orderByInstability(['A', 'B'], null), ['A', 'B']);
  assert.deepEqual(orderByInstability(['A', 'B'], []), ['A', 'B']);
});

test('orderByInstability: list が非配列なら空配列', () => {
  assert.deepEqual(orderByInstability(null, [{ code: 'A', score: 1 }]), []);
});
