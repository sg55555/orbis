import { test, expect } from '@playwright/test';

const FIXTURE = {
  updated: '2026-06-20T07:00:00Z', model: 'claude-sonnet-4-6',
  lead: '世界は複数地域で緊張が続いている。',
  cards: [
    { title_ja: 'キーウ近郊で衝突', summary_ja: '…', category: 'conflict', severity: 5, lat: 50.45, lon: 30.52, place: 'キーウ', sources: [{ title: 's', url: 'https://e.com/a' }] },
    { title_ja: '世界経済の見通し', summary_ja: '…', category: 'economy', severity: 2, sources: [] },
  ],
};

test('briefing: #ai-brief が lead＋カードを描画・座標カードで flyTo', async ({ page }) => {
  test.setTimeout(60000);
  await page.route('**/data/snapshots/briefing.json**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(FIXTURE) }));
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  await expect(page.locator('#ai-brief .brief-lead')).toContainText('緊張が続いている');
  await expect(page.locator('#ai-brief .brief-card')).toHaveCount(2);

  // 座標ありカードクリック → globe 中心が変化（flyTo）
  await page.locator('#ai-brief').scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.__orbis.map.getCenter());
  await page.locator('#ai-brief .brief-card:not(.no-loc)').first().click();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);

  // 座標なしカードは .no-loc（クリック非活性）
  await expect(page.locator('#ai-brief .brief-card.no-loc')).toHaveCount(1);
});
