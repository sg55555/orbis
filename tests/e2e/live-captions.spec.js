import { test, expect } from '@playwright/test';

// オーバーレイ構造 / mock WS 字幕 / 直近2行 / 指数バックオフ再接続 / cc連携 を検証。
// getDisplayMedia は headless で出せないため音声取得経路は対象外（手動受入）。
test('live-captions: overlay構造・mock WS字幕・再接続・cc連携', async ({ page }) => {
  test.setTimeout(60000); // WebGL globe 起動 + メディア配線で既定30sを超えうるため延長
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // オーバーレイは #media-news の .media-player 内・pointer-events:none
  const overlay = page.locator('#media-news .media-player .lc-overlay');
  await expect(overlay).toHaveCount(1);
  expect(await overlay.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

  // AI字幕トグル存在・既定OFF
  await expect(page.locator('#lc-toggle')).toHaveCount(1);
  await expect(page.locator('#lc-toggle')).not.toBeChecked();

  // mock WS で caption が下端に出る
  await page.evaluate(() => {
    const listeners = {};
    const mockWs = {
      addEventListener: (t, cb) => { listeners[t] = cb; }, send() {}, close() {}, readyState: 1,
      _fire: (t, d) => listeners[t] && listeners[t](d),
    };
    window.LC_WS_FACTORY = () => mockWs;
    window._lcWs = mockWs;
    window._lcCtrl = window.__orbis.liveCaptions.connect('ws://x/ws');
    window._lcWs._fire('open', {});
    window._lcWs._fire('message', { data: JSON.stringify({ type: 'caption', ja: 'こんにちは世界' }) });
  });
  await expect(page.locator('#media-news .lc-rows')).toContainText('こんにちは世界');

  // 直近2行だけ保持
  await page.evaluate(() => {
    for (let i = 0; i < 4; i++) window._lcWs._fire('message', { data: JSON.stringify({ type: 'caption', ja: '訳' + i }) });
  });
  await expect(page.locator('#media-news .lc-row')).toHaveCount(2);
  await expect(page.locator('#media-news .lc-rows')).toContainText('訳3');

  // close → 指数バックオフ再接続（factory が再度呼ばれる）
  await page.evaluate(() => {
    window.LC_RECONNECT_BASE_MS = 20;
    window._calls = 0; window._inst = [];
    window.LC_WS_FACTORY = () => {
      window._calls++;
      const ls = {};
      const i = { addEventListener: (t, cb) => { ls[t] = cb; }, send() {}, close() {}, readyState: 1, _fire: (t, d) => ls[t] && ls[t](d) };
      window._inst.push(i); return i;
    };
    window._lcCtrl2 = window.__orbis.liveCaptions.connect('ws://x/ws');
  });
  await expect.poll(() => page.evaluate(() => window._calls)).toBe(1);
  await page.evaluate(() => window._inst[0]._fire('close', {}));
  await expect.poll(() => page.evaluate(() => window._calls), { timeout: 3000, intervals: [50] }).toBeGreaterThanOrEqual(2);

  // cc連携: #lc-toggle ON で #media-cc-toggle が OFF になる
  // （getDisplayMedia は headless で失敗するが onActivate は await 前に同期実行されるため cc は外れる）
  await expect(page.locator('#media-cc-toggle')).toBeChecked();
  await page.locator('#lc-toggle').check();
  await expect(page.locator('#media-cc-toggle')).not.toBeChecked();
});
