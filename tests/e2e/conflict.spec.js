import { test, expect } from '@playwright/test';

test('feed aggregates conflict by country and chips filter it', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // 紛争データ到着（既定 ON）
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.conflict ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // チップ行が出る（全＋地震/紛争/抗議/ニュース のうち有効分）
  await expect(page.locator('#feed-chips .feed-chip')).not.toHaveCount(0);

  // 集約行（×N バッジ）がフィードに出る
  await expect(page.locator('#feed .feed-row .feed-count').first()).toBeVisible({ timeout: 15000 });

  // 「紛争」チップを押すと紛争行が消え、他レイヤー行は残る
  const conflictRows = () => page.locator('#feed .feed-row .feed-dot[style*="255,60,80"]');
  expect(await conflictRows().count()).toBeGreaterThan(0);
  await page.locator('#feed-chips .feed-chip[data-chip="conflict"]').click();
  await page.waitForTimeout(300);
  expect(await conflictRows().count()).toBe(0);
  await expect(page.locator('#feed .feed-row')).not.toHaveCount(0); // 他は残る

  // 「全」で復帰
  await page.locator('#feed-chips .feed-chip[data-all="1"]').click();
  await page.waitForTimeout(300);
  expect(await conflictRows().count()).toBeGreaterThan(0);

  // 集約行クリック→国サマリ popup＋flyTo
  const before = await page.evaluate(() => window.__orbis.map.getCenter());
  await conflictRows().first().click();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  await expect(page.locator('.orbis-popup .sel-meta').first()).toContainText('24h');
});
