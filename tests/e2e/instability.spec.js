import { test, expect } from '@playwright/test';

const MOCK = {
  updated: '2026-06-20T12:00:00Z', model: 'claude-haiku-4-5',
  thresholds: { mag_min: 4.5, top_n: 8 },
  countries: [
    { code: 'IZ', name_ja: 'イラク', score: 87, level: 5, rank: 1, lat: 33.2, lon: 43.9,
      components: { conflict: 120, protests: 8, news: 3, quakes: 0 },
      counts: { conflict: 210, protests: 7, news: 2, quakes: 0 },
      trend: { dod: { delta: 12, dir: 'up' }, normal: { deltaPct: 34, dir: 'up' }, isNew: false },
      narrative_ja: '戦闘が集中。', top_events: [] },
    { code: 'US', name_ja: 'アメリカ合衆国', score: 40, level: 3, rank: 2, lat: 38.9, lon: -77.0,
      components: { conflict: 10, protests: 12, news: 4, quakes: 1 },
      counts: { conflict: 5, protests: 9, news: 3, quakes: 1 },
      trend: { dod: { delta: 1, dir: 'flat' }, normal: { deltaPct: 30, dir: 'up' }, isNew: false },
      top_events: [] },
  ],
};

test('国家不安定性インデックス: 描画とクリックflyTo', async ({ page }) => {
  test.setTimeout(60000); // WSL2 の WebGL globe 起動余裕
  await page.route('**/data/snapshots/instability.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK) }));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  const rows = page.locator('#instability .ins-rank-list .ins-rowbtn');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#instability')).toContainText('イラク');
  await expect(page.locator('#instability .ins-mover-list .ins-rowbtn')).toHaveCount(2); // 両国 up
  await rows.first().click();
  await page.waitForFunction(() => window.__orbis && window.__orbis.selected
    && window.__orbis.selected.layerId === 'instability');
  expect(errors.filter((e) => !/favicon|font/i.test(e))).toEqual([]);
});
