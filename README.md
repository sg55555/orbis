# ORBIS — 世界リアルタイム監視ダッシュボード

無料OSINTで世界を近リアルタイム監視するダッシュボード。地球儀 + 地震(USGS) + 航空(OpenSky) + 紛争/抗議(GDELT) + 貿易ルート(静的)。

**Phase 3（操作性・分かりやすさ・動き）**: 引くと丸い地球が星空に浮かぶズームアウトビュー。左パネルでレイヤーをON/OFF＋件数表示（localStorage永続化・折りたたみ可）。マーカーにホバーで詳細ツールチップ（便名/高度・規模/場所・出典など）。右フィードで最新イベント（地震/紛争/抗議）を時系列表示＋クリックで地図がその地点へ移動。貿易ルートを流れる粒子と新規イベントの出現パルス（`prefers-reduced-motion` 尊重）。

## 開発
- フロント: Vanilla JS (ESM, no build)。`python3 -m http.server 8000` → http://localhost:8000
- 収集: `python3 -m collectors.quakes`（USGS → data/snapshots/quakes.json + manifest.json）
- 収集: `python3 -m collectors.flights`（OpenSky → data/snapshots/flights.json）
- 収集: `python3 -m collectors.gdelt_events`（GDELT → data/snapshots/conflict.json + protests.json）

## テスト
- Python: `python3 -m pytest -q`
- JS: `node --test tests/*.test.js`（または `npm run test:js`）
- E2E: `npx playwright test`

## デプロイ（Vercel 静的）
1. GitHub に push（リポジトリ sg55555/orbis）
2. Vercel でインポート（Framework: Other / 静的）。`vercel.json` と `.vercelignore` 同梱済み。
3. GitHub Actions の `collect` が10分毎に snapshot を更新・push。

## アーキテクチャ / 設計
`docs/superpowers/specs/2026-06-13-orbis-design.md` と `docs/superpowers/plans/2026-06-13-orbis-phase1.md` 参照。
