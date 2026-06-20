import { test, expect } from '@playwright/test';

test.use({ hasTouch: true }); // ⓘ閉時に @media(hover:hover) の reveal が干渉しないようタッチ環境で検証（mobile-nav と同パターン）

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

test('ⓘ クリックで説明が開閉し、チェック状態は変わらない', async ({ page }) => {
  test.setTimeout(60000);
  await ready(page);
  const item = page.locator('#panel-rows .layer-item:has(.layer-row[data-id="quakes"])');
  const checkbox = page.locator('#panel-rows .layer-row[data-id="quakes"] .layer-toggle');
  const before = await checkbox.isChecked();
  await expect(item).not.toHaveClass(/desc-open/);
  await expect(item.locator('.layer-desc')).toBeHidden();
  await item.locator('.layer-info').click();
  await expect(item).toHaveClass(/desc-open/);
  await expect(item.locator('.layer-desc')).toBeVisible();
  expect(await checkbox.isChecked()).toBe(before); // ⓘ がチェックを誤トグルしない
  await item.locator('.layer-info').click();
  await expect(item).not.toHaveClass(/desc-open/);
  await expect(item.locator('.layer-desc')).toBeHidden();
});
