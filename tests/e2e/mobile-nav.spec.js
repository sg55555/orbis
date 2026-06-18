import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('mobile: globe全画面・ボトムシート開閉・相互排他・メディア導線', async ({ page }) => {
  test.setTimeout(60000); // WebGL globe 起動が WSL2 で重い
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 20000 });

  // 既定：シート閉（globe 全画面）。タブバーは表示。
  await expect(page.locator('#mobile-tabs')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // レイヤータブ → panel シート
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'layers');
  await expect(page.locator('.mobile-tab[data-sheet="layers"]')).toHaveAttribute('aria-expanded', 'true');

  // フィードタブ → feed に切替（相互排他：layers は閉じる）
  await page.locator('.mobile-tab[data-sheet="feed"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'feed');
  await expect(page.locator('.mobile-tab[data-sheet="layers"]')).toHaveAttribute('aria-expanded', 'false');

  // 同じタブ再タップで閉じる
  await page.locator('.mobile-tab[data-sheet="feed"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // 開く → 幕(globe 上部の被っていない位置)タップで閉じる
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'layers');
  await page.locator('#sheet-scrim').click({ position: { x: 195, y: 60 } });
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // 開く → Esc で閉じる
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // ▼メディア導線で #media へスクロール（存在時）
  const hint = page.locator('#media-hint');
  if (await hint.isVisible()) {
    await hint.click();
    await page.waitForTimeout(900);
    const top = await page.evaluate(() => document.getElementById('media').getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
  }
});
