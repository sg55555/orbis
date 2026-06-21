import { test, expect } from '@playwright/test';

test('凡例：既定折りたたみ→展開でタブ2つ・全段表示・タブ切替', async ({ page }) => {
  await page.goto('/');
  const legend = page.locator('#legend');
  await expect(legend).toBeVisible();
  // 既定は折りたたみ（タブ非表示）
  await expect(page.locator('#legend .legend-tabs')).toBeHidden();
  // 展開
  await page.locator('#legend .legend-collapse').click();
  await expect(page.locator('#legend .legend-tabs')).toBeVisible();
  await expect(page.locator('#legend .legend-tab')).toHaveCount(2);
  // 凡例タブ：全10レイヤーのブロック＋地震は4段
  await expect(page.locator('#legend .legend-body[data-body="legend"] .legend-layer')).toHaveCount(10);
  const quake = page.locator('#legend .legend-layer', { hasText: '地震' });
  await expect(quake.locator('.legend-tier')).toHaveCount(4);
  // 使い方タブへ切替
  await page.locator('#legend .legend-tab[data-tab="help"]').click();
  await expect(page.locator('#legend .legend-help-list li')).toHaveCount(5);
  await expect(page.locator('#legend .legend-body[data-body="legend"]')).toBeHidden();
});

test('?legend=off で凡例を隠す', async ({ page }) => {
  await page.goto('/?legend=off');
  await expect(page.locator('#legend')).toBeHidden();
});
