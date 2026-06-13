import { test, expect } from '@playwright/test';

test('globe boots, layers render, panel toggles, feed flies', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#map canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#starfield')).toBeVisible();

  // 左パネルに5レイヤー行
  await expect(page.locator('#panel .layer-row')).toHaveCount(5);

  // データ到着
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.quakes ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.flights ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.trade ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // トグル: quakes を OFF にするとチェックが外れる
  await page.locator('.layer-row[data-id="quakes"] .layer-toggle').uncheck();
  await expect(page.locator('.layer-row[data-id="quakes"] .layer-toggle')).not.toBeChecked();

  // フィード: item が出てクリックで地図中心が変わる
  await expect(page.locator('#feed .feed-row').first()).toBeVisible({ timeout: 15000 });
  const before = await page.evaluate(() => window.__orbis.map.getCenter());
  await page.locator('#feed .feed-row').first().click();
  await page.waitForTimeout(1800); // flyTo 完了待ち
  const after = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);

  // フィードクリックで選択が記録される（着地マーカー用）
  const sel = await page.evaluate(() => window.__orbis.selected);
  expect(sel && typeof sel.lon === 'number' && typeof sel.lat === 'number').toBe(true);

  // ズームアウトで低 zoom（球体ビュー）に到達できる
  await page.evaluate(() => window.__orbis.map.setZoom(0.3));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__orbis.map.getZoom())).toBeLessThan(1);
});
