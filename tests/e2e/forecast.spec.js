import { test, expect } from '@playwright/test';

const MOCK = {
  generated_at: '2026-06-21T12:37:00Z',
  model: 'claude-haiku-4-5',
  thresholds: { level: [20, 40, 60, 80], top_n: 4 },
  cards: [
    {
      domain: 'conflict', scope: 'country', place_ja: 'ウクライナ', place_key: 'UP',
      lat: 49, lon: 32,
      attention_score: 82, attention_level: 5, trend: 'up', confidence: 'high', horizon: '24-72h',
      signals: [{ label: '紛争 3件', source: 'GDELT', kind: 'conflict' }],
      outlook_ja: '今後72hで再拡大の恐れ', rationale_ja: '件数が平常比増加',
      ai_generated: true, status: 'active',
    },
    {
      domain: 'cyber', scope: 'global', place_ja: 'グローバル', place_key: 'GLOBAL',
      attention_score: 0, attention_level: 1, trend: 'new', confidence: 'low',
      signals: [], outlook_ja: '', rationale_ja: '',
      ai_generated: false, status: 'watch',
    },
  ],
};

test('forecasts: render, tabs, flyTo, AI badge', async ({ page }) => {
  test.setTimeout(60000); // WSL2 の WebGL globe 起動余裕
  await page.route('**/data/snapshots/forecast.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK) }));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');

  const sec = page.locator('#forecasts');

  // 8 タブ描画確認
  await expect(sec.locator('.fc-tab')).toHaveCount(8);

  // ALL タブ: ウクライナカードと AI生成バッジ
  await expect(sec.locator('.fc-card').first()).toContainText('ウクライナ');
  await expect(sec.locator('.fc-ai').first()).toContainText('AI生成');

  // conflict タブ → カード 1 枚
  await sec.locator('.fc-tab[data-dom="conflict"]').click();
  await expect(sec.locator('.fc-card')).toHaveCount(1);

  // cyber タブ → 監視中カード表示
  await sec.locator('.fc-tab[data-dom="cyber"]').click();
  await expect(sec.locator('.fc-watch')).toBeVisible();

  // ALL タブに戻してカードクリック → flyTo 副作用を window.__orbis で検証
  await sec.locator('.fc-tab[data-dom="all"]').click();
  await sec.locator('.fc-cardbtn').first().click();
  await page.waitForFunction(
    () => window.__orbis && window.__orbis.selected && window.__orbis.selected.layerId === 'forecast',
  );

  // コンソールエラーなし（favicon/font は除外）
  expect(errors.filter((e) => !/favicon|font/i.test(e))).toEqual([]);
});
