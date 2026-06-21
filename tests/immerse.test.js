import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  immerseZoom, immerseSeam, immerseGlow, immerseMediaBg, immerseClasses,
  atmosphereStops, isCompareMode, immerseGlass, DEFAULT_ZOOM, immerseNeb,
  immerseMediaPolish, immerseUi, immerseFont, immerseSec, immerseLegend,
} from '../js/lib/immerse.js';

// 没入ダイヤルの既定値は実物比較で確定した本番値。URL パラメータで下げ方向に上書きできる。

test('DEFAULT_ZOOM は確定値 2.7（globe を画面の主役に）', () => {
  assert.equal(DEFAULT_ZOOM, 2.7);
});

test('immerseNeb: 既定3（鮮やか）・?nv=1|2 で切替・不正は既定', () => {
  const def = immerseNeb('');
  const n3 = immerseNeb('?nv=3');
  assert.deepEqual(def, n3); // 既定は 3（鮮やか・ユーザー採用）
  const n1 = immerseNeb('?nv=1');
  const n2 = immerseNeb('?nv=2');
  // a(青)/b(紫) を持ち、濃さは 1<2<3（alpha が単調増加）
  const al = (s) => Number((/[\d.]+(?=\)$)/.exec(s) || [])[0]);
  assert.ok(al(n1.a) < al(n2.a) && al(n2.a) < al(n3.a), 'nv が大きいほど青ティント濃い');
  assert.ok(al(n1.b) < al(n2.b) && al(n2.b) < al(n3.b), 'nv が大きいほど紫ティント濃い');
  assert.deepEqual(immerseNeb('?nv=9'), def); // 不正は既定
});

test('immerseZoom: 未指定は既定(2.7)。?gz=55|70|85 で上書き', () => {
  assert.equal(immerseZoom(''), 2.7);
  assert.equal(immerseZoom('?gz=55'), 1.7);
  assert.equal(immerseZoom('?gz=70'), 2.2);
  assert.equal(immerseZoom('?gz=85'), 2.7);
  assert.equal(immerseZoom('?gz=99'), 2.7); // 未定義段階は既定
  assert.equal(immerseZoom('?gz=abc'), 2.7);
});

test('immerseSeam: 未指定は既定 a。?seam=b|c で上書き（無効も既定 a）', () => {
  assert.equal(immerseSeam(''), 'a');
  assert.equal(immerseSeam('?seam=b'), 'b');
  assert.equal(immerseSeam('?seam=C'), 'c');
  assert.equal(immerseSeam('?seam=z'), 'a');
});

test('immerseGlow: 未指定は既定 2。?glow=1|3 で上書き（無効も既定 2）', () => {
  assert.equal(immerseGlow(''), 2);
  assert.equal(immerseGlow('?glow=1'), 1);
  assert.equal(immerseGlow('?glow=3'), 3);
  assert.equal(immerseGlow('?glow=9'), 2);
});

test('immerseMediaBg: 未指定は既定 deep。?mbg=black で上書き（無効も既定 deep）', () => {
  assert.equal(immerseMediaBg(''), 'deep');
  assert.equal(immerseMediaBg('?mbg=black'), 'black');
  assert.equal(immerseMediaBg('?mbg=BLACK'), 'black');
  assert.equal(immerseMediaBg('?mbg=x'), 'deep');
});

test('immerseMediaPolish: 未指定は既定 a（大気グロー）。?mp=b|off で上書き（無効も既定 a）', () => {
  assert.equal(immerseMediaPolish(''), 'a');
  assert.equal(immerseMediaPolish('?mp=a'), 'a');
  assert.equal(immerseMediaPolish('?mp=b'), 'b');
  assert.equal(immerseMediaPolish('?mp=off'), 'off');
  assert.equal(immerseMediaPolish('?mp=OFF'), 'off'); // 大小無視
  assert.equal(immerseMediaPolish('?mp=x'), 'a'); // 不正は既定
});

test('immerseUi: 未指定は既定 a（大気グラス・リッチ）。?ui=b|off で上書き（無効も既定 a）', () => {
  assert.equal(immerseUi(''), 'a');
  assert.equal(immerseUi('?ui=a'), 'a');
  assert.equal(immerseUi('?ui=b'), 'b');
  assert.equal(immerseUi('?ui=off'), 'off');
  assert.equal(immerseUi('?ui=OFF'), 'off'); // 大小無視
  assert.equal(immerseUi('?ui=x'), 'a'); // 不正は既定
});

test('immerseFont: 未指定は既定 on（display フォント）。?font=off で上書き（無効も既定 on）', () => {
  assert.equal(immerseFont(''), 'on');
  assert.equal(immerseFont('?font=on'), 'on');
  assert.equal(immerseFont('?font=off'), 'off');
  assert.equal(immerseFont('?font=OFF'), 'off'); // 大小無視
  assert.equal(immerseFont('?font=x'), 'on'); // 不正は既定
});

test('immerseSec: 未指定は既定 on（セクション構造）。?sec=off で上書き（無効も既定 on）', () => {
  assert.equal(immerseSec(''), 'on');
  assert.equal(immerseSec('?sec=on'), 'on');
  assert.equal(immerseSec('?sec=off'), 'off');
  assert.equal(immerseSec('?sec=OFF'), 'off'); // 大小無視
  assert.equal(immerseSec('?sec=x'), 'on'); // 不正は既定
});

test('immerseClasses: 既定で seam-a・mbg-deep・mp-a・ui-a・font-on・sec-on・legend-on。指定で上書き', () => {
  assert.deepEqual(immerseClasses(''), ['seam-a', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on']);
  assert.deepEqual(immerseClasses('?seam=b'), ['seam-b', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on']);
  assert.deepEqual(immerseClasses('?mbg=black'), ['seam-a', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on']);
  assert.deepEqual(immerseClasses('?seam=c&mbg=black&glass=off'), ['seam-c', 'glass-off', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on']);
  assert.deepEqual(immerseClasses('?glass=on'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on']); // glass=on はクラス無し
  assert.deepEqual(immerseClasses('?mp=off'), ['seam-a', 'mbg-deep', 'mp-off', 'ui-a', 'font-on', 'sec-on', 'legend-on']); // media before
  assert.deepEqual(immerseClasses('?ui=off&font=off'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-off', 'font-off', 'sec-on', 'legend-on']); // 本編 before
  assert.deepEqual(immerseClasses('?ui=b'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-b', 'font-on', 'sec-on', 'legend-on']); // 計器
  assert.deepEqual(immerseClasses('?sec=off'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-off', 'legend-on']); // セクション before
});

test('atmosphereStops: glow level で atmosphere-blend のストップ（大きいほど強く・減衰を遅らせ広く）', () => {
  assert.deepEqual(atmosphereStops(1), [0, 0.55, 4, 0.28, 7, 0]);
  assert.deepEqual(atmosphereStops(2), [0, 0.85, 6, 0.45, 9, 0]);
  assert.deepEqual(atmosphereStops(3), [0, 1.0, 10, 0.6, 14, 0]);
  assert.deepEqual(atmosphereStops(99), atmosphereStops(1));
});

test('isCompareMode: ?compare=1 のみ true（比較中は SW 無効化の判定）', () => {
  assert.equal(isCompareMode('?compare=1'), true);
  assert.equal(isCompareMode('?gz=85&compare=1&seam=a'), true);
  assert.equal(isCompareMode('?gz=85'), false);
  assert.equal(isCompareMode(''), false);
  assert.equal(isCompareMode('?compare=0'), false);
  assert.equal(isCompareMode('?compare=10'), false);
});

test('immerseGlass: ?glass=on|soft|off（大小無視）、未指定/無効は on', () => {
  assert.equal(immerseGlass('?glass=off'), 'off');
  assert.equal(immerseGlass('?glass=soft'), 'soft');
  assert.equal(immerseGlass('?glass=ON'), 'on');
  assert.equal(immerseGlass(''), 'on');
  assert.equal(immerseGlass('?glass=x'), 'on');
});

test('immerseLegend: 未指定は既定 on。?legend=off で上書き（無効も既定 on・大小無視）', () => {
  assert.equal(immerseLegend(''), 'on');
  assert.equal(immerseLegend('?legend=off'), 'off');
  assert.equal(immerseLegend('?legend=ON'), 'on');
  assert.equal(immerseLegend('?legend=OFF'), 'off');
  assert.equal(immerseLegend('?legend=x'), 'on');
});

test('immerseClasses: legend- を常時付与（既定 legend-on、?legend=off で legend-off）', () => {
  assert.ok(immerseClasses('').includes('legend-on'));
  assert.ok(immerseClasses('?legend=off').includes('legend-off'));
});
