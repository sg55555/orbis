import { test, expect } from '@playwright/test';

test('globe boots, layers render, panel toggles, feed flies', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#map canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#starfield')).toBeVisible();

  // 左パネルに8レイヤー行（地震/航空/紛争/抗議/貿易/海流/気温/船舶）
  await expect(page.locator('#panel .layer-row')).toHaveCount(8);

  // データ到着
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.quakes ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.flights ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.trade ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // トグル: quakes を OFF にするとチェックが外れる
  await page.locator('.layer-row[data-id="quakes"] .layer-toggle').uncheck();
  await expect(page.locator('.layer-row[data-id="quakes"] .layer-toggle')).not.toBeChecked();

  // フィード: item が出てクリックで地図中心が変わる
  await expect(page.locator('#feed .feed-row').first()).toBeVisible({ timeout: 15000 });
  const before = await page.evaluate(() => window.__orbis.map.getCenter());
  await page.locator('#feed .feed-row').first().click();
  await page.waitForTimeout(1800); // flyTo 完了待ち
  const after = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);

  // フィードクリックで選択が記録される（着地リティクル用）
  const sel = await page.evaluate(() => window.__orbis.selected);
  expect(sel && typeof sel.lon === 'number' && typeof sel.lat === 'number').toBe(true);

  // 着地点ポップアップ（イベント名＋移動ガイド）が表示される
  await expect(page.locator('.orbis-popup .sel-title')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.orbis-popup .sel-hint')).toContainText('移動');

  // ズームアウトで低 zoom（球体ビュー）に到達できる
  await page.evaluate(() => window.__orbis.map.setZoom(0.3));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__orbis.map.getZoom())).toBeLessThan(1);

  // 実際に globe 投影が効いている（平面メルカトル＋世界の横繰り返しではない）
  expect(await page.evaluate(() => window.__orbis.map.getProjection().type)).toBe('globe');
  expect(await page.evaluate(() => window.__orbis.map.getRenderWorldCopies())).toBe(false);

  // deck.gl レイヤーが globe に整合（縁の点でも MapLibre 投影と一致：mercator なら大きくズレる）
  const drift = await page.evaluate(() => {
    const m = window.__orbis.map;
    const vp = window.__orbis.overlay._deck.getViewports()[0];
    const c = [-0.13, 51.5]; // ロンドン（投影中心から遠い＝ズレが出やすい）
    const mp = m.project(c); const dp = vp.project(c);
    return Math.hypot(dp[0] - mp.x, dp[1] - mp.y);
  });
  expect(drift).toBeLessThan(2);

  // 航空=飛行機シルエット(SolidPolygon) が deck に存在（flights は ON のまま）
  const hasFlights = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    return ((o._props && o._props.layers) || []).some((l) => l.id === 'flights');
  });
  expect(hasFlights).toBe(true);

  // 地震を再度 ON にすると地震リング(quakes)が描画される
  await page.locator('.layer-row[data-id="quakes"] .layer-toggle').check();
  await page.waitForTimeout(300);
  const hasQuakes = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    return ((o._props && o._props.layers) || []).some((l) => l.id === 'quakes');
  });
  expect(hasQuakes).toBe(true);

  // 海流(currents)が deck に描画されている（既定 ON・静的ロード後）
  const hasCurrents = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    return ((o._props && o._props.layers) || []).some((l) => l.id === 'currents');
  });
  expect(hasCurrents).toBe(true);

  // 気温(airtemp)は既定OFF。ON にすると BitmapLayer(or 格子) が deck に描画される。
  await expect(page.locator('.layer-row[data-id="airtemp"] .layer-toggle')).not.toBeChecked();
  await page.locator('.layer-row[data-id="airtemp"] .layer-toggle').check();
  await page.waitForTimeout(400);
  const hasAirtemp = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    return ((o._props && o._props.layers) || []).some((l) => l.id === 'airtemp');
  });
  expect(hasAirtemp).toBe(true);

  // 船舶(ships)は既定OFF。ON にすると船体シルエット(SolidPolygon)が deck に描画される。
  // 本番データはキー設定後に存在。e2e ではトグル ON が反映され例外が出ないことを担保し、
  // データがある場合のみ deck レイヤー存在も確認する（描画の画素検証は本番 Playwright）。
  await expect(page.locator('.layer-row[data-id="ships"] .layer-toggle')).not.toBeChecked();
  await page.locator('.layer-row[data-id="ships"] .layer-toggle').check();
  await page.waitForTimeout(400);
  await expect(page.locator('.layer-row[data-id="ships"] .layer-toggle')).toBeChecked();
  const shipsLayerOk = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    const has = window.__orbis.counts && window.__orbis.counts.ships > 0;
    const present = ((o._props && o._props.layers) || []).some((l) => l.id === 'ships');
    return !has || present; // データがあるなら描画されているはず
  });
  expect(shipsLayerOk).toBe(true);

  // 航空クリックの進路ライン＋到達点＋ポップアップは canvas ピックが座標依存で
  // 不安定なため e2e では検証せず、Playwright スクショの目視で担保する（plan Task 11）。
});
