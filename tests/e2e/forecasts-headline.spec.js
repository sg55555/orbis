import { test, expect } from '@playwright/test';

// #forecasts の見出し(他スレ所有 markup .fc-title)を sec-on 時に統一見出し(sec-h・オーロラ下線)へ
// 寄せた CSS の回帰テスト。視覚(Saira フォント等)は GPU 依存ゆえ、border-bottom の有無を構造的に検証する。

test('forecasts: sec-on（既定）で fc-title に統一見出しのオーロラ下線が付く', async ({ page }) => {
  await page.goto('/');
  await page.locator('#forecasts .fc-title').scrollIntoViewIfNeeded();
  await expect(page.locator('#forecasts .fc-title')).toHaveCSS('border-bottom-width', '1px');
});

test('forecasts: ?sec=off では fc-title に下線なし（before）', async ({ page }) => {
  await page.goto('/?sec=off');
  const bw = await page.locator('#forecasts .fc-title').evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(bw).toBe('0px');
});
