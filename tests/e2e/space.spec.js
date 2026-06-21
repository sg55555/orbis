import { test, expect } from '@playwright/test';

test('space: 既定で body.space-2・#starfield canvas が存在', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#starfield')).toHaveCount(1);
  await expect(page.locator('body')).toHaveClass(/space-2/);
});

test('space: ?space=off で body.space-off（周辺光なし・before）', async ({ page }) => {
  await page.goto('/?space=off');
  await expect(page.locator('body')).toHaveClass(/space-off/);
});

test('space: ?space=3 で body.space-3', async ({ page }) => {
  await page.goto('/?space=3');
  await expect(page.locator('body')).toHaveClass(/space-3/);
});
