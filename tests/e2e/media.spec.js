import { test, expect } from '@playwright/test';

// メディア領域の構造検証（描画/カテゴリ切替/src/flyTo/可視時再生）。
// 注: 映像の再生(decode)は headless Chromium のコーデック制約で不可のためアサートしない。
test('media section: render, category switch, src, flyTo, visibility play', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  const media = page.locator('#media');
  await expect(media).toHaveCount(1);

  // 設定を読む
  const news = await page.evaluate(async () => (await (await fetch('config/live_channels.json')).json()));
  const cams = await page.evaluate(async () => ((await (await fetch('config/live_cameras.json')).json().catch(() => []))));
  expect(news.length).toBeGreaterThan(0);

  // 既定カテゴリ=ニュース。セレクタ件数 = news 件数。
  await expect(page.locator('#media-selector .media-item')).toHaveCount(news.length);

  // #media を可視化（IntersectionObserver で再生対象がセットされる）
  await page.locator('#media').scrollIntoViewIfNeeded();
  // src が非空になるまで最大 3s 待つ
  await expect.poll(
    () => page.locator('#media-frame').getAttribute('src'),
    { timeout: 3000 }
  ).toBeTruthy();

  const src0 = await page.locator('#media-frame').getAttribute('src');
  // ニュース先頭は channel_id 形式（live_stream?channel=…）
  expect(src0).toContain(news[0].channel_id);

  // ニュース項目クリックで flyTo（地図中心が変化）＋ src 更新
  if (news.length > 1) {
    const before = await page.evaluate(() => window.__orbis.map.getCenter());
    await page.locator(`.media-item[data-id="${news[1].id}"]`).click();
    await page.waitForTimeout(1800);
    expect(await page.locator('#media-frame').getAttribute('src')).toContain(news[1].channel_id);
    const after = await page.evaluate(() => window.__orbis.map.getCenter());
    expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  }

  // カメラタブに切替 → セレクタが cameras 件数になり、src が video_id 形式に
  if (cams.length > 0) {
    await page.locator('.media-cat[data-cat="cameras"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#media-selector .media-item')).toHaveCount(cams.length);
    const srcC = await page.locator('#media-frame').getAttribute('src');
    // カメラは video_id ベース（embed/VIDEO_ID 形式）
    expect(srcC).toContain(cams[0].video_id);
  }

  // 上に戻ると不可視 → src 空（停止）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  expect(await page.locator('#media-frame').getAttribute('src')).toBeFalsy();
});
