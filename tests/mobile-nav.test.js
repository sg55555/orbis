import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSheet, shouldShowMediaHint, sheetPanelId } from '../js/ui/mobile-nav.js';

test('nextSheet: 別タブで切替（相互排他）', () => {
  assert.equal(nextSheet(null, 'layers'), 'layers');
  assert.equal(nextSheet('layers', 'feed'), 'feed');
  assert.equal(nextSheet('feed', 'layers'), 'layers');
});

test('nextSheet: 同じタブの再タップで閉じる', () => {
  assert.equal(nextSheet('layers', 'layers'), null);
  assert.equal(nextSheet('feed', 'feed'), null);
});

test('shouldShowMediaHint: media が存在し画面外のときだけ true', () => {
  assert.equal(shouldShowMediaHint(true, false), true);
  assert.equal(shouldShowMediaHint(true, true), false);
  assert.equal(shouldShowMediaHint(false, false), false);
});

test('sheetPanelId: シート名 → パネル要素 id（未知は null）', () => {
  assert.equal(sheetPanelId('layers'), 'panel');
  assert.equal(sheetPanelId('feed'), 'feed');
  assert.equal(sheetPanelId('legend'), 'legend');
  assert.equal(sheetPanelId('zzz'), null);
});
