import { test, expect } from '@playwright/test';

test('globe boots and all phase-2 layers render', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#map canvas.maplibregl-canvas')).toBeVisible();

  // 凡例グループが5レイヤー分（quakes/flights/conflict/protests/trade）
  await expect(page.locator('#legend .legend-group')).toHaveCount(5);

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
});
