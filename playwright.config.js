import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 直列実行。全 spec が単一の http.server とリポ内データを共有するため、並列だと
  // データ到着ポーリングが競合で稀にタイムアウトする（flake）。直列で安定させる。
  workers: 1,
  use: { baseURL: 'http://localhost:8000', headless: true },
  webServer: {
    command: 'python3 -m http.server 8000',
    url: 'http://localhost:8000',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
