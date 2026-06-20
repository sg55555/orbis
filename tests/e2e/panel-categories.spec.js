import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
}

test('レイヤーパネルが3カテゴリ見出しで分類表示される', async ({ page }) => {
  test.setTimeout(60000);
  await ready(page);
  const heads = await page.$$eval('#panel-rows .layer-cat-head', (els) => els.map((e) => e.textContent.trim()));
  expect(heads).toEqual(['出来事', '移動', '環境']);
  await expect(page.locator('#panel-rows .layer-cat[data-cat="events"] .layer-row[data-id="quakes"]')).toHaveCount(1);
  await expect(page.locator('#panel-rows .layer-cat[data-cat="mobility"] .layer-row[data-id="flights"]')).toHaveCount(1);
  await expect(page.locator('#panel-rows .layer-cat[data-cat="environment"] .layer-row[data-id="sst"]')).toHaveCount(1);
});
