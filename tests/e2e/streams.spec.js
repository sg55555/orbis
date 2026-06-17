import { test, expect } from '@playwright/test';

// YouTube Live バーの構造検証（描画/トグル/タブ/ src / flyTo）。
// 注: 映像の再生(decode)は headless Chromium のコーデック制約で不可のためアサートしない。
test('streams bar: render, toggle, tabs, src, flyTo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // 既定は折りたたみ・iframe src 空
  const bar = page.locator('#streams');
  await expect(bar).toHaveClass(/collapsed/);
  expect(await page.locator('#stream-frame').getAttribute('src')).toBeFalsy();

  // タブ数 = config 件数
  const channels = await page.evaluate(async () => (await (await fetch('config/live_channels.json')).json()));
  expect(channels.length).toBeGreaterThan(0);
  await expect(page.locator('#stream-tabs .stream-tab')).toHaveCount(channels.length);

  // 展開すると先頭チャンネルが再生対象になる（src に channel_id が入る）
  await page.locator('#streams-toggle').click();
  await expect(bar).not.toHaveClass(/collapsed/);
  await page.waitForTimeout(200);
  const src0 = await page.locator('#stream-frame').getAttribute('src');
  expect(src0).toContain(channels[0].channel_id);
  expect(src0).toContain('mute=1');

  // 2件以上あれば、別タブクリックで src 切替＋地図が本拠地へ flyTo
  if (channels.length > 1) {
    const before = await page.evaluate(() => window.__orbis.map.getCenter());
    await page.locator(`.stream-tab[data-id="${channels[1].id}"]`).click();
    await page.waitForTimeout(1800); // flyTo 完了待ち
    const src1 = await page.locator('#stream-frame').getAttribute('src');
    expect(src1).toContain(channels[1].channel_id);
    const after = await page.evaluate(() => window.__orbis.map.getCenter());
    expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  }

  // 折りたたむと src が空（再生停止）
  await page.locator('#streams-toggle').click();
  await expect(bar).toHaveClass(/collapsed/);
  await page.waitForTimeout(150);
  expect(await page.locator('#stream-frame').getAttribute('src')).toBeFalsy();
});
