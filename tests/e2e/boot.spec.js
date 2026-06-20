import { test, expect } from '@playwright/test';

test('起動画面: 構造と ORBIS 表示、map ready で #loading が hidden になる', async ({ page }) => {
  test.setTimeout(60000); // WSL2 の WebGL globe 起動は既定30sに張り付くため延長
  await page.goto('/');
  await expect(page.locator('#boot-fx')).toHaveCount(1);
  await expect(page.locator('#loading .boot-word')).toHaveText('ORBIS');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 20000 });
});
