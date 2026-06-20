import { test, expect } from '@playwright/test';

test('default initial view is the overview preset', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  const on = await page.$$eval('#panel-rows .layer-row',
    (rows) => rows.filter((r) => r.querySelector('.layer-toggle').checked).map((r) => r.dataset.id).sort());
  expect(on).toEqual(['conflict', 'currents', 'news', 'protests', 'quakes']);
  await expect(page.locator('#panel-presets .preset-chip[data-preset="overview"]')).toHaveClass(/active/);
});

test('preset chips set the enabled set exclusively + custom state', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#panel-presets .preset-chip')).toHaveCount(4);

  await page.locator('#panel-presets .preset-chip[data-preset="weather"]').click();
  await page.waitForTimeout(300);
  const on = await page.$$eval('#panel-rows .layer-row',
    (rows) => rows.filter((r) => r.querySelector('.layer-toggle').checked).map((r) => r.dataset.id).sort());
  expect(on).toEqual(['airtemp', 'currents', 'sst']);
  await expect(page.locator('#panel-presets .preset-chip[data-preset="weather"]')).toHaveClass(/active/);

  // 個別トグルでズレたら custom（どの chip も active でない・カスタムラベル表示）
  // weather プリセットが quakes を OFF にしたことを前提として明示
  await expect(page.locator('#panel-rows .layer-row[data-id="quakes"] .layer-toggle')).not.toBeChecked();
  await page.locator('#panel-rows .layer-row[data-id="quakes"] .layer-toggle').check();
  await page.waitForTimeout(200);
  await expect(page.locator('#panel-presets .preset-chip.active')).toHaveCount(0);
  await expect(page.locator('#panel-presets .preset-custom')).toBeVisible();
});
