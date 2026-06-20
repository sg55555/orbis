import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, smooth, ease, currentBootVariant, bootMinMs,
  bootFeeds, remainingHold, progressFor, project,
} from '../js/lib/boot-fx.js';

test('clamp: 範囲内/外', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

test('smooth: 端点と中点、域外はクランプ', () => {
  assert.equal(smooth(0), 0);
  assert.equal(smooth(1), 1);
  assert.equal(smooth(0.5), 0.5);
  assert.equal(smooth(-1), 0);
  assert.equal(smooth(2), 1);
});

test('ease: 区間を 0..1 に正規化して smooth', () => {
  assert.equal(ease(50, 0, 100), 0.5);
  assert.equal(ease(-10, 0, 100), 0);
  assert.equal(ease(150, 0, 100), 1);
});

test('currentBootVariant: ?boot を読む・既定は 12', () => {
  assert.equal(currentBootVariant('?boot=1'), '1');
  assert.equal(currentBootVariant('?x=1&boot=3'), '3');
  assert.equal(currentBootVariant('?boot=12'), '12');
  assert.equal(currentBootVariant(''), '12');
  assert.equal(currentBootVariant('?boot=9'), '12');
});

test('bootMinMs: 既定2400・数値のみ採用', () => {
  assert.equal(bootMinMs('?bootmin=1000'), 1000);
  assert.equal(bootMinMs('?bootmin=0'), 0);
  assert.equal(bootMinMs(''), 2400);
  assert.equal(bootMinMs('?bootmin=abc'), 2400);
});

test('bootFeeds: 2=full(7) / その他=slim(5)・各要素は[名,状態]', () => {
  const full = bootFeeds('2');
  assert.equal(full.length, 7);
  const slim = bootFeeds('12');
  assert.equal(slim.length, 5);
  for (const f of full.concat(slim)) {
    assert.equal(Array.isArray(f), true);
    assert.equal(typeof f[0], 'string');
    assert.equal(typeof f[1], 'string');
  }
});

test('remainingHold: 最小表示までの残り（経過が min 以上なら 0）', () => {
  assert.equal(remainingHold(1000, 2400), 1400);
  assert.equal(remainingHold(3000, 2400), 0);
  assert.equal(remainingHold(0, 2400), 2400);
});

test('progressFor: 0..1・total<=0 は 0', () => {
  assert.equal(progressFor(0, 5), 0);
  assert.equal(progressFor(5, 5), 1);
  assert.equal(progressFor(2, 4), 0.5);
  assert.equal(progressFor(1, 0), 0);
});

test('project: 正面中心は z>0、裏面は z<0、縁は z≈0', () => {
  const c = project(0, 0, 0, 0, 100, 200, 200); // 赤道・本初子午線＝正面中心
  assert.ok(Math.abs(c.x - 200) < 1e-9 && Math.abs(c.y - 200) < 1e-9);
  assert.ok(c.z > 0.99);
  const back = project(0, 180, 0, 0, 100, 200, 200); // 裏側
  assert.ok(back.z < 0);
  const limb = project(0, 90, 0, 0, 100, 200, 200); // 縁
  assert.ok(Math.abs(limb.z) < 1e-9);
});
