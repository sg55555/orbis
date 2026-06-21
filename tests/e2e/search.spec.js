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
