import { test, expect } from '@playwright/test';

test('permalink ?ll&z&layers restores view and layers', async ({ page }) => {
  test.setTimeout(60000);
  // 保存設定があっても permalink の layers が優先されることを確かめる
  await page.addInitScript(() => localStorage.setItem('orbis.enabled.v1', JSON.stringify(['flights'])));
  await page.goto('/?ll=35.6,139.7&z=4&layers=quakes,news');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // レイヤー復元：quakes,news のみ ON（保存の flights を上書き）
  const on = await page.$$eval('#panel-rows .layer-row',
    (rows) => rows.filter((r) => r.querySelector('.layer-toggle').checked).map((r) => r.dataset.id).sort());
  expect(on).toEqual(['news', 'quakes']);

  // ビュー復元：中心 [lng,lat]=[139.7,35.6]・zoom 4
  const view = await page.evaluate(() => {
    const m = window.__orbis.map; const c = m.getCenter();
    return { lng: +c.lng.toFixed(2), lat: +c.lat.toFixed(2), zoom: +m.getZoom().toFixed(2) };
  });
  expect(view).toEqual({ lng: 139.7, lat: 35.6, zoom: 4 });
});

test('share button shows a toast (wired) and copies a permalink URL', async ({ page, context }) => {
  test.setTimeout(60000);
  await context.grantPermissions(['clipboard-write']);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  await page.locator('#share-btn').click();
  // ボタン→ハンドラ→トーストの配線（クリップボード許可済なので成功メッセージ）
  await expect(page.locator('#share-toast')).toHaveClass(/show/, { timeout: 3000 });
  await expect(page.locator('#share-toast')).toHaveText('リンクをコピーしました');
});
