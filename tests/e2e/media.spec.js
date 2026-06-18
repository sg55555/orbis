import { test, expect } from '@playwright/test';

// 2ペイン メディア領域の構造検証（描画/局タブ/地域タブ/分割/サムネ選択src/flyTo/可視制御）。
// 注: 映像の再生(decode)は headless Chromium のコーデック制約で不可のためアサートしない。
test('media dual-pane: news + cameras structure', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // 2ペイン存在
  await expect(page.locator('#media-news')).toHaveCount(1);
  await expect(page.locator('#media-cams')).toHaveCount(1);

  const news = await page.evaluate(async () => (await (await fetch('config/live_channels.json')).json()));
  const cams = await page.evaluate(async () => (await (await fetch('config/live_cameras.json')).json().catch(() => [])));
  expect(news.length).toBeGreaterThan(0);
  expect(cams.length).toBeGreaterThan(0);

  // 局タブ件数 = news 件数
  await expect(page.locator('#news-tabs .news-tab')).toHaveCount(news.length);

  // 可視化 → news/選択cam の src がセットされる
  await page.locator('#media').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('#news-frame').getAttribute('src'), { timeout: 3000 }).toBeTruthy();
  expect(await page.locator('#news-frame').getAttribute('src')).toContain(news[0].channel_id);

  // 局タブ切替で news-frame src 更新＋flyTo
  if (news.length > 1) {
    const before = await page.evaluate(() => window.__orbis.map.getCenter());
    await page.locator(`.news-tab[data-id="${news[1].id}"]`).click();
    await page.waitForTimeout(1800);
    expect(await page.locator('#news-frame').getAttribute('src')).toContain(news[1].channel_id);
    const after = await page.evaluate(() => window.__orbis.map.getCenter());
    expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  }

  // 地域タブ：先頭は「すべて」、1つ以上
  const areaTabs = page.locator('#area-tabs .area-tab');
  expect(await areaTabs.count()).toBeGreaterThanOrEqual(1);
  await expect(areaTabs.first()).toHaveText('すべて');

  // 分割モード切替：6→6セル、1→1セル、4→4セル
  await page.locator('.mode-btn[data-mode="6"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(6);
  await page.locator('.mode-btn[data-mode="1"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(1);
  await page.locator('.mode-btn[data-mode="4"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(4);

  // 全枠同時再生：可視時、全非emptyセルが iframe 再生 src を持つ
  await expect.poll(async () => {
    const srcs = await page.locator('#cams-grid .cam-cell:not(.empty) iframe').evaluateAll(
      (frames) => frames.map((f) => f.getAttribute('src')),
    );
    return srcs.length > 1 && srcs.every((s) => s && s.includes('youtube.com/embed/'));
  }, { timeout: 3000 }).toBe(true);

  // カメラクリックで flyTo（地図中心が変化・地上カメラ）
  const firstCell = page.locator('#cams-grid .cam-cell:not(.empty)').first();
  const camBefore = await page.evaluate(() => window.__orbis.map.getCenter());
  await firstCell.click();
  await page.waitForTimeout(1500);
  const camAfter = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(camAfter.lng !== camBefore.lng || camAfter.lat !== camBefore.lat).toBe(true);

  // 上に戻ると不可視 → news/cam の src 空（停止）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  expect(await page.locator('#news-frame').getAttribute('src')).toBeFalsy();
  const anyCamSrc = await page.locator('#cams-grid .cam-cell iframe').evaluateAll(
    (frames) => frames.map((f) => f.getAttribute('src')).filter(Boolean),
  );
  expect(anyCamSrc.length).toBe(0);
});
