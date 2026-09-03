# ORBIS — 世界リアルタイム監視ダッシュボード

無料OSINTで世界を近リアルタイム監視するダッシュボード。地球儀 + 地震(USGS) + 航空(OpenSky) + 紛争/抗議(GDELT) + 貿易ルート(静的)。

**Phase 3（操作性・分かりやすさ・動き）**: 引くと丸い地球が星空に浮かぶズームアウトビュー。左パネルでレイヤーをON/OFF＋件数表示（localStorage永続化・折りたたみ可）。マーカーにホバーで詳細ツールチップ（便名/高度・規模/場所・出典など）。右フィードで最新イベント（地震/紛争/抗議）を時系列表示＋クリックで地図がその地点へ移動。貿易ルートを流れる粒子と新規イベントの出現パルス（`prefers-reduced-motion` 尊重）。

**Phase 3.5（デザイン磨き）**: ベースマップをネオン濃紺のベクター地図（OpenFreeMap・キー不要）に刷新。海と陸を色で分け、国名・主要都市を日本語表示。引くと球体が星空に浮く。紛争/抗議は赤/緑のヒートマップで地帯を塗り、フィードのイベントをクリックすると飛び先にネオンの着地マーカー。ツールチップは項目名付き（便名/高度/速度 等）、左パネルに各レイヤーの説明を表示。

## 開発
- フロント: Vanilla JS (ESM, no build)。`python3 -m http.server 8000` → http://localhost:8000
- **本番と同じヘッダー/ルーティングで見たいとき**は e2e ハーネスを使う（`vercel.json` の `builds`/`routes` を `tests/vercel_routes.py` で評価して配信＝CSP・Cache-Control・308・catch-all 404 まで再現する）:
  ```bash
  python3 tests/harness/serve.py --port 8790
  ```
  → http://127.0.0.1:8790 （`--csp-override "<csp>"` で CSP ヘッダーだけ差し替えられる）
- データ源の切替: `?data=github`＝本番データ（`raw.githubusercontent.com/sg55555/orbis-data`・読み取りのみ）／`?data=local`＝`data/snapshots/`（ローカル収集が必要）。無指定なら localhost は local・それ以外は github。
- e2e 用フック: `?e2e=1` を付けたときだけ `window.__orbis.e2e`（`applyDataStyles(document)` の適用数など）を公開する（受入 e2e が globe 投影や data-style の適用を確認するため。通常の導線では未定義）。
- 収集: `python3 -m collectors.quakes`（USGS → data/snapshots/quakes.json + manifest.json）
- 収集: `python3 -m collectors.flights`（OpenSky → data/snapshots/flights.json）
- 収集: `python3 -m collectors.gdelt_events`（GDELT → data/snapshots/conflict.json + protests.json）

## テスト
- JS 単体: `node --test tests/*.test.js`（または `npm run test:js`）
- Python: `python3 -m pytest -q`
- e2e（実ブラウザ・CSP 違反 0）: `NOULIMIT=1 node tests/e2e-csp.mjs`
  - **行頭の `NOULIMIT=1` は必須**（Bash hook の `ulimit -v` の下では Chromium が起動できない）
  - ハーネス（`tests/harness/serve.py`）とブラウザの起動・終了はスクリプトが面倒を見る。`E2E_PORT`（既定 8790）でポートを変えられる
- 旧 Playwright スイート `npx playwright test`（`tests/e2e/*.spec.js`・20 spec）は `data/snapshots/` のローカル生成が前提。受入には含めない（Phase B で fixture 化予定）

## 受入（push の条件）
```bash
bash tools/closure.sh
```
`node --test` → `pytest` → `e2e-csp` を順に回し、全部通ると `.closure-ok` に `git rev-parse HEAD` を書いて `== closure OK` を出す。どれかが落ちると `== closure FAILED (<段階>)` を出して `.closure-ok` を消し exit 1。push ゲートはこの `.closure-ok` が HEAD と一致することを見る。`ulimit -v` を掛けた状態では起動しないこと（Chromium が落ちる）。

CSP が本当に enforce されているかの確認（negative control の RED・**落ちるのが正しい**）:
```bash
CSP_OVERRIDE="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; manifest-src 'self'; media-src 'self'; upgrade-insecure-requests" NOULIMIT=1 node tests/e2e-csp.mjs
```
`negative control:` の 4 行が FAIL して exit 1 になるのが正しい（緑になったら enforce が効いていない）。

## デプロイ（Vercel 静的）
1. GitHub に push（リポジトリ sg55555/orbis）
2. Vercel でインポート（Framework: Other / 静的）。`vercel.json` と `.vercelignore` 同梱済み。
3. GitHub Actions の `collect` が10分毎に snapshot を更新・push。

## アーキテクチャ / 設計
`docs/superpowers/specs/2026-06-13-orbis-design.md` と `docs/superpowers/plans/2026-06-13-orbis-phase1.md` 参照。

## ライセンス
- **コード**: MIT License（[LICENSE](LICENSE) ・ Copyright (c) 2026 sg55555）
- **データ**: 各上流の条件に従います（USGS / OpenSky Network / GDELT Project / AISStream / NASA FIRMS / Open-Meteo=CC BY 4.0 / OpenStreetMap・OpenMapTiles・OpenFreeMap=ODbL / Wikipedia 日本語版=CC BY-SA 4.0 / Wikidata=CC0）。層ごとの出典と条件は [attribution.html](attribution.html)（本番: https://orbis-beta.vercel.app/attribution ）に一覧があります。
- **フォント/ライブラリ**: Orbitron・Saira=OFL 1.1 / MapLibre GL JS=BSD 3-Clause / deck.gl=MIT。
- 運営: sg55555（個人・非商用）／連絡先: https://github.com/sg55555/orbis/issues
- 公開ページ: [about](about.html) ・ [terms](terms.html) ・ [privacy](privacy.html) ・ [attribution](attribution.html)
