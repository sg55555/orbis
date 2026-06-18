import { test, expect } from '@playwright/test';

// 2ペイン メディア領域の構造検証（描画/局タブ/地域タブ/分割/サムネ選択src/flyTo/可視制御）。
// 注: 映像の再生(decode)は headless Chromium のコーデック制約で不可のためアサートしない。
test('media dual-pane: news + cameras structure', async ({ page }) => {
  test.setTimeout(60000); // 2ペイン＋全枠再生＋分割＋1画面と検証が多く、各 flyTo/再生待ちで既定30sを超えるため延長
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

  // IFrame Player API（字幕の日本語自動翻訳用）：news は enablejsapi=1 付き＋APIスクリプト注入。
  // 字幕の実表示は headless では検証不可（decode不可）→構造のみ。実表示は実ブラウザ確認。
  expect(await page.locator('#news-frame').getAttribute('src')).toContain('enablejsapi=1');
  await expect.poll(
    () => page.locator('script[src*="youtube.com/iframe_api"]').count(),
    { timeout: 3000 },
  ).toBeGreaterThan(0);

  // カメラ初回再生：地域/分割を一切触らず、初回スクロールだけで全非emptyセルが再生srcを持つ。
  // 退行防止：iframe.src='' がページURLに解決され !f.src 判定で再生開始を取りこぼしたバグ。
  await expect.poll(async () => {
    const srcs = await page.locator('#cams-grid .cam-cell:not(.empty) iframe').evaluateAll(
      (fs) => fs.map((f) => f.getAttribute('src') || ''),
    );
    return srcs.length > 0 && srcs.every((s) => s.includes('youtube.com/embed/'));
  }, { timeout: 3000 }).toBe(true);

  // 字幕トグル：既定ON → src に cc_lang_pref=ja。OFFにすると消える。再ONで復活。
  await expect(page.locator('#media-cc-toggle')).toBeChecked();
  expect(await page.locator('#news-frame').getAttribute('src')).toContain('cc_lang_pref=ja');
  await page.locator('#media-cc-toggle').uncheck();
  await expect.poll(() => page.locator('#news-frame').getAttribute('src'), { timeout: 2000 })
    .not.toContain('cc_lang_pref=ja');
  await page.locator('#media-cc-toggle').check();
  await expect.poll(() => page.locator('#news-frame').getAttribute('src'), { timeout: 2000 })
    .toContain('cc_lang_pref=ja');

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

  // 1画面モード：カメラ名ピル行が出て、地域(すべて)のカメラ数ぶん。グリッドは1セル。
  await page.locator('.mode-btn[data-mode="1"]').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#cams-one-tabs')).toBeVisible();
  await expect(page.locator('#cams-one-tabs .cam-one-tab')).toHaveCount(cams.length);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(1);

  // ピルで1画面の表示カメラを切替（グリッド1セルの dataset.id がピルに一致）
  const pill2 = page.locator('#cams-one-tabs .cam-one-tab').nth(2);
  const pill2Id = await pill2.getAttribute('data-id');
  await pill2.click();
  await page.waitForTimeout(400);
  expect(await page.locator('#cams-grid .cam-cell').first().getAttribute('data-id')).toBe(pill2Id);

  // 4分割に戻して、セルの⛶で1画面化（そのカメラが1画面に）
  await page.locator('.mode-btn[data-mode="4"]').click();
  await page.waitForTimeout(400);
  const targetCell = page.locator('#cams-grid .cam-cell:not(.empty)').nth(1);
  const targetId = await targetCell.getAttribute('data-id');
  await targetCell.locator('.cam-expand').click();
  await page.waitForTimeout(400);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(1);
  expect(await page.locator('#cams-grid .cam-cell').first().getAttribute('data-id')).toBe(targetId);

  // 上に戻ると不可視 → news/cam の src 空（停止）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  expect(await page.locator('#news-frame').getAttribute('src')).toBeFalsy();
  const anyCamSrc = await page.locator('#cams-grid .cam-cell iframe').evaluateAll(
    (frames) => frames.map((f) => f.getAttribute('src')).filter(Boolean),
  );
  expect(anyCamSrc.length).toBe(0);
});
