# ORBIS — 世界リアルタイム監視ダッシュボード

無料OSINTで世界を近リアルタイム監視するダッシュボード。Phase 1（基盤）: 地球儀 + 地震(USGS)。

## 開発
- フロント: Vanilla JS (ESM, no build)。`python3 -m http.server 8000` → http://localhost:8000
- 収集: `python3 -m collectors.quakes`（USGS → data/snapshots/quakes.json + manifest.json）

## テスト
- Python: `python3 -m pytest -q`
- JS: `node --test tests/`
- E2E: `npx playwright test`

## デプロイ（Vercel 静的）
1. GitHub に push（リポジトリ sg55555/orbis）
2. Vercel でインポート（Framework: Other / 静的）。`vercel.json` と `.vercelignore` 同梱済み。
3. GitHub Actions の `collect` が10分毎に snapshot を更新・push。

## アーキテクチャ / 設計
`docs/superpowers/specs/2026-06-13-orbis-design.md` と `docs/superpowers/plans/2026-06-13-orbis-phase1.md` 参照。
