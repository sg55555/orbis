import { test, expect } from '@playwright/test';

test('globe boots, loading clears, and quake layer renders points', async ({ page }) => {
  await page.goto('/');

  // ローディングが消える（map load 完了）
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // canvas（MapLibre）が存在
  await expect(page.locator('#map canvas.maplibregl-canvas')).toBeVisible();

  // 凡例が4バンド描画されている
  await expect(page.locator('#legend-rows .row')).toHaveCount(4);

  // ポーリングで地震点が読み込まれる（committed snapshot を読む・件数>0）
  await expect.poll(
    async () => page.evaluate(() => window.__orbis && window.__orbis.lastCount),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // 鮮度表示が更新されている
  await expect(page.locator('#freshness')).toContainText('地震データ');
});
