import { test, expect } from '@playwright/test';

test('検索ボックス：入力で候補が出る', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await page.locator('#search-input').fill('日本');
  const opt = page.locator('#search-results .search-opt').first();
  await expect(opt).toBeVisible({ timeout: 3000 });
  await expect(opt).toContainText('日本');
});

test('?search=off で検索ボックス非表示', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?search=off');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#search')).toBeHidden();
});

test('候補選択で国の中心へ flyTo', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await page.locator('#search-input').fill('日本');
  await page.locator('#search-results .search-opt').first().click();
  await page.waitForTimeout(2000); // flyTo（duration 1500）着地待ち
  const c = await page.evaluate(() => {
    const m = window.__orbis.map; const ctr = m.getCenter();
    return { lng: +ctr.lng.toFixed(1), lat: +ctr.lat.toFixed(1) };
  });
  expect(Math.abs(c.lng - 135.7)).toBeLessThan(2.5);
  expect(Math.abs(c.lat - 36.2)).toBeLessThan(2.5);
});
