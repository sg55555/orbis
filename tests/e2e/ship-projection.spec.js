import { test, expect } from '@playwright/test';

// 船クリックの推定進路を 10 時間延長（SHIP_PROJECT_MIN=600）に変更した件の実機検証。
// mistakes.md の教訓に従い、反復クリック（複数の船を連続選択）で進路描画とポップアップ表記を確認する。
test('ship click projects ~10h ahead, repeatable across ships', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // 船舶レイヤーを ON（既定 OFF）
  await page.locator('.layer-row[data-id="ships"] .layer-toggle').check();
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.ships ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // スナップショットから「移動中（sog>0）かつ針路あり」の船を複数取得
  const movers = await page.evaluate(async () => {
    const r = await fetch('/data/snapshots/ships.json');
    const j = await r.json();
    return j.points.filter((p) => p.sog > 1 && p.cog != null).slice(0, 30);
  });
  expect(movers.length).toBeGreaterThan(2);

  async function clickShipAt(p) {
    // 対象船を画面中央に据えて十分ズーム（シルエットが数px）→ deck picking が当たる
    await page.evaluate(({ lon, lat }) => {
      window.__orbis.map.jumpTo({ center: [lon, lat], zoom: 7 });
    }, { lon: p.lon, lat: p.lat });
    await page.waitForTimeout(500);
    const px = await page.evaluate(({ lon, lat }) => {
      const pt = window.__orbis.map.project([lon, lat]);
      return { x: pt.x, y: pt.y };
    }, { lon: p.lon, lat: p.lat });
    await page.mouse.click(px.x, px.y);
    await page.waitForTimeout(400);
  }

  // 連続で別々の船を 3 回クリックし、毎回 進路描画＋「約10時間後」表記を確認
  let verified = 0;
  for (const p of movers) {
    if (verified >= 3) break;
    await clickShipAt(p);
    const hasRoute = await page.evaluate(() => {
      const o = window.__orbis.overlay;
      return ((o._props && o._props.layers) || []).some((l) => l.id === 'ship-route' || l.id === 'ship-arrival');
    });
    const hint = await page.locator('.orbis-popup .sel-hint').first().textContent().catch(() => '');
    if (hasRoute && /約10時間後/.test(hint || '')) {
      verified += 1;
    }
  }

  // 少なくとも 2 隻で（=反復クリックで）進路が「約10時間後」で描画されること
  expect(verified).toBeGreaterThanOrEqual(2);
});
