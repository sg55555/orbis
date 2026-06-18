import { test, expect } from '@playwright/test';

// 航空機クリックの推定進路（heading 延長・FLIGHT_PROJECT_MIN=20）の実機検証。
// smoke では canvas picking の不安定さを理由に未検証だった箇所。ship-projection と同じ
// 「対象を画面中央へ jumpTo→project→click」の安定手法で、mistakes.md の教訓に従い
// 反復クリック（複数機を連続選択）で進路描画とポップアップ表記を確認する。
test('flight click projects ~20min ahead, repeatable across flights', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // flights は既定 ON。データ到着を待つ。
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.flights ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // 「飛行中（heading あり・空中・速度あり）」の機体を複数取得（シルエット層に入る機体）。
  const movers = await page.evaluate(async () => {
    const r = await fetch('/data/snapshots/flights.json');
    const j = await r.json();
    return j.points.filter((p) => p.heading != null && !p.on_ground && (p.velocity || 0) > 0).slice(0, 30);
  });
  expect(movers.length).toBeGreaterThan(2);

  async function clickFlightAt(p) {
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

  // 連続で別々の機体を 3 回クリックし、毎回 進路描画＋「約20分後」表記を確認。
  let verified = 0;
  for (const p of movers) {
    if (verified >= 3) break;
    await clickFlightAt(p);
    const hasRoute = await page.evaluate(() => {
      const o = window.__orbis.overlay;
      return ((o._props && o._props.layers) || []).some((l) => l.id === 'flight-route' || l.id === 'flight-arrival');
    });
    const hint = await page.locator('.orbis-popup .sel-hint').first().textContent().catch(() => '');
    if (hasRoute && /約20分後/.test(hint || '')) verified += 1;
  }

  // 少なくとも 2 機で（=反復クリックで）進路が「約20分後」で描画されること。
  expect(verified).toBeGreaterThanOrEqual(2);
});
