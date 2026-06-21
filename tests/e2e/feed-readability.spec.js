import { test, expect } from '@playwright/test';

// フィード可読性レイヤー（?feed=on|off 既定on）。on=タイトル最大2行で折返し（幅260pxの
// 1行省略 ellipsis を解消）、off=before（nowrap+ellipsis）。クラス付与は data 非依存で安定検証、
// 折返し挙動は feed-row 描画後に computed style で検証。

test('feed: 既定で body.feed-on（タイトル最大2行・採用値）', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/feed-on/);
});

test('feed: ?feed=off で body.feed-off（before・1行省略）', async ({ page }) => {
  await page.goto('/?feed=off');
  await expect(page.locator('body')).toHaveClass(/feed-off/);
});

test('feed: ?feed=on でフィードのタイトルが折返し可（white-space:normal）', async ({ page }) => {
  await page.goto('/?feed=on');
  await page.waitForSelector('#feed .feed-row', { timeout: 20000 });
  const ws = await page.locator('#feed .feed-title').first().evaluate(el => getComputedStyle(el).whiteSpace);
  expect(ws).toBe('normal');
});

test('feed: ?feed=off ではタイトルが nowrap（1行省略 ellipsis）', async ({ page }) => {
  await page.goto('/?feed=off');
  await page.waitForSelector('#feed .feed-row', { timeout: 20000 });
  const ws = await page.locator('#feed .feed-title').first().evaluate(el => getComputedStyle(el).whiteSpace);
  expect(ws).toBe('nowrap');
});
