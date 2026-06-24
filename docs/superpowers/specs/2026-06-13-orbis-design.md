# ORBIS — 世界リアルタイム監視ダッシュボード 設計書

- **日付**: 2026-06-13
- **作者**: オーナー / Claude
- **ステータス**: 設計合意済み（実装計画はこの後 writing-plans で作成）

## 1. 概要

全世界をリアルタイム（近リアルタイム）にモニタリングする、サイバーパンク調のWebダッシュボード。
動的な地球儀／地図上に、軍事・船舶・航空・貿易・紛争・抗議・自然災害・宇宙などのデータレイヤーを
重畳表示し、画面下部に世界中のライブ映像と日本語翻訳ニュースを混在グリッドで流す。

「司令室（コマンドセンター）」型のレイアウトで、地図を主役に据えつつ、映像も大迫力で見せられる。

## 2. 確定した方針（合意事項）

| 項目 | 決定 | 補足 |
|---|---|---|
| データ方針 | **完全無料OSINTのみ** | 月額0円・公開可・APIキーは収集側に隔離 |
| 公開範囲 | **一般公開（認証なし）** | 機密データは扱わない（security-style準拠） |
| リアルタイム性 | **近リアルタイム・スナップショット方式** | cronで定期取得→静的JSON配信→クライアント補間 |
| レイアウト | **A. コマンドセンター型** | 左=レイヤー操作 / 右=イベントフィード / 下=混在グリッド。左右は折りたたみ可、地図全画面化も可 |
| 地図 | **MapLibre GL globe投影 + deck.gl** | 地球儀↔平面をシームレスにズーム |
| ビジュアル | **Deep Navy + Aurora** | 既存アプリ群（smart-mail/kakeibo/task-dashboard）と統一。濃紺＋ネオン＋ガラスUI |
| 下部セクション | **混在グリッド** | ライブ映像（YouTube Live）＋翻訳ニュースを横スクロール |
| 翻訳 | **Claude Haiku（cronバッチ）** | news-digestの知見を流用。スナップショットに同梱 |
| アプリ名 | **ORBIS** | リポ/ディレクトリ名 |

## 3. アーキテクチャ

既存の nexus / news-digest と同じ「収集はGitHub Actions、配信は静的JSON、描画はクライアント」パターン。
Vercelサーバーレス関数は実質ゼロ（Hobby 12関数上限を消費しない）。

```
GitHub Actions (cron 約5分間隔)
  Python collectors（ソース毎に1ファイル・疎結合）
    flights.py / ships.py / conflict.py / protests.py / military.py
    quakes.py / fires.py / storms.py / space.py / launches.py
    aurora.py / terminator.py / infra.py / news.py → translate.py
  各々が data/snapshots/<layer>.json を書き出す
  容量制御：高密度層は間引き / 上位N / 重要度フィルタ
        │ commit & push（または Vercel Blob）
        ▼
Vercel（静的ホスティング）
  data/snapshots/*.json + manifest.json（各層の最終更新時刻）
        ▼
ブラウザ（Vanilla JS SPA）
  MapLibre GL（globe）＋ deck.gl（データレイヤー）
  ポーリング取得（ETag/差分）→ スナップショット間をアニメ補間
  下部：混在グリッド（YouTube Live ＋ 翻訳ニュース）
```

### 設計原則
- **疎結合**: 1ソース = 1収集スクリプト = 1スナップショットJSON = 1フロントレイヤー。1つ壊れても波及しない。
- **堅牢性**: 各収集は失敗時に前回スナップショットを温存（古いデータでも表示継続）。`manifest.json` の鮮度をUI表示。
- **容量/性能**（nexusスケール設計の指針反映）: 高密度層はビューポート/重要度で間引き、上位N件、ズーム別粒度。地球儀=集約、ズームイン=詳細。
- **mistakes.md の教訓反映**:
  - e2eフィクスチャと本番配信データのパスを衝突させない。本番配信JSONは必ずgit追跡し`.gitignore`に入れない。
  - Vercel静的デプロイは `vercel.json` + `.vercelignore` + framework誤検知対策を最初から用意。コミット作者メールをGitHubと一致させる。
  - as-you-type系UI（検索/フィルタ）は入力要素を作り直さず、変化部分だけ差し替える。

## 4. データレイヤー・カタログ（全14層）

| # | レイヤー | ソース（無料） | 更新 | 表現 |
|---|---|---|---|---|
| 1 | ✈️ 航空交通 | OpenSky Network | 5分 | 点＋進行方位、密度ヒート |
| 2 | 🚢 船舶 | AISStream.io | 5分 | 点＋航跡、種別色分け |
| 3 | 📦 貿易ルート/要衝 | 静的（主要航路） | 固定 | アーク＋チョークポイント強調 |
| 4 | 🔥 紛争 | GDELT / ACLED | 15分 | 強度ヒート＋マーカー |
| 5 | ✊ 抗議活動 | GDELT | 15分 | マーカー＋規模 |
| 6 | 🪖 軍事（近似） | 軍用機OSINT（ADSBexchange等） | 5分 | 点（※「近似」と明記表示） |
| 7 | 🌍 地震 | USGS | 1分 | 規模で円サイズ＋波紋アニメ |
| 8 | 🔥 山火事 | NASA FIRMS | 数時間 | 熱点グロー |
| 9 | 🌀 台風/嵐 | NOAA | 1時間 | 進路＋風速 |
| 10 | 🛰️ ISS/衛星 | open-notify / N2YO | ライブ計算 | 軌道線＋現在地 |
| 11 | 🚀 ロケット打上げ | Launch Library 2 | 1時間 | 射点マーカー＋カウントダウン |
| 12 | 🌌 オーロラ予報 | NOAA SWPC | 30分 | 極域オーバル＋Kp指数 |
| 13 | 🌗 昼夜境界線 | 計算（暦） | ライブ計算 | ターミネータ陰影 |
| 14 | ⚡ インフラ/💹経済 | FAA等 ＋ 主要指数 | 可変 | 空港遅延 ＋ 上部HUDティッカー |

### 正直な制約（合意済み）
- **軍事活動**: 公式リアルタイムAPIは存在しない。軍用機OSINTでの近似表示とし、UIに「近似」を明示する。
- **フライト遅延**: 位置データ（OpenSky）は取れるが「遅延」の正確な突合は限定的。v1は「航空交通密度＋主要空港の遅延ステータス」として表現。

## 5. フロント描画

- **MapLibre GL JS**（globe投影・OSSベースマップ）を基図に、**deck.gl**（`MapboxOverlay`連携）で全レイヤーを重畳。
- **レイヤー統一インターフェース**: 各レイヤーは `{ id, fetch(), toDeckLayer(data, zoom), legend, freshness }` を実装する小モジュール。新レイヤー追加＝ファイル1枚。
- **ズーム連動LOD**: 遠景（地球儀）=集約・ヒート、ズームイン=個別マーカー＋ラベル。
- **アニメ補間**: スナップショット間を `requestAnimationFrame` で補間し、船・航空機が滑らかに移動。地震は出現時に波紋アニメ。
- **左パネル**: 14層のON/OFFトグル＋凡例（折りたたみ可）。
- **右パネル**: リアルタイムイベントフィード（新着を時系列ストリーム、折りたたみ可）。
- **配色**: Deep Navy + Aurora。濃紺の地球にネオン（シアン=交通、マゼンタ=紛争、グリーン=抗議 など）、上空にオーロラの揺らぎ、ガラスUIパネル。

## 6. 下部 ニュース/映像セクション（混在グリッド）

- **横スクロールの混在グリッド**。2種のカードが流れる:
  - **ライブ映像カード**: YouTube Live公式ストリーム（Al Jazeera / NASA / 各地ライブカメラ等のキュレーション済みID）を遅延ロード埋め込み。
  - **翻訳ニュースカード**: RSS → Claude Haiku で日本語要約＋翻訳済みの見出し・サムネ・出典・地域タグ。
- **地図連動**: イベント/ニュースをクリック→地図が該当座標へ `flyTo`。地図マーカー→関連ニュースをハイライト。
- スクロール閲覧前提（全体俯瞰は不要）。地図・映像どちらも大迫力に拡張可能。

## 7. 横断仕様（new-app チェックリスト準拠）

- **PWA**: manifest / sw.js / アイコン（Pillow生成）。SW更新時はCACHEバージョンを必ず上げる。
- **モバイル対応**: 768/480/375px。パネルはボトムシート化、地図優先。
- **ローディング画面** / **空状態・エラー・データ鮮度表示**。
- **localStorage**: レイヤーON/OFF・最後の地図視点を永続化。
- **認証なし・公開**。APIキー（AISStream等）はGitHub Secretsに隔離しクライアント非公開。
- **Vercel構成**: 静的SPA（builds+routes）。framework誤検知対策・`.vercelignore`・作者メール一致を最初から。

## 8. 段階実装（フェーズ）

各フェーズが単独で動く/デプロイできるよう分割。実装計画はまず Phase 1 を詳細化する。

| Phase | 内容 | 価値 |
|---|---|---|
| **P1 基盤** | リポ/Vercel/PWA骨組み ＋ MapLibre globe ＋ deck.gl土台 ＋ レイヤー統一I/F ＋ 地震(USGS)1層で疎通 | 動く地球儀が立つ |
| **P2 コア** | 航空・船舶・紛争・抗議・貿易ルート ＋ 左右パネル ＋ イベントフィード | 監視ダッシュの核 |
| **P3 ニュース** | 下部混在グリッド ＋ RSS収集 ＋ Claude翻訳 ＋ 地図連動flyTo | 映像＋翻訳が乗る |
| **P4 拡張層** | 宇宙・台風・山火事・軍事近似・オーロラ・昼夜境界・HUD経済 | 全14層完成 |
| **P5 仕上げ** | アニメ補間・LOD最適化・モバイル・鮮度UI・Aurora演出磨き | リッチ化 |

## 9. リポジトリ構成（予定）

```
orbis/
├── index.html              # SPA本体
├── css/                    # Aurora テーマ
├── js/
│   ├── map.js              # MapLibre + deck.gl 初期化
│   ├── layers/             # レイヤー毎モジュール（統一I/F）
│   ├── feed.js             # 右パネル・イベントフィード
│   ├── news-grid.js        # 下部混在グリッド
│   └── state.js            # localStorage・ポーリング
├── collectors/             # Python 収集スクリプト（ソース毎）
│   └── translate.py        # Claude Haiku 翻訳
├── data/snapshots/         # 配信JSON（git追跡・gitignore禁止）
│   └── manifest.json
├── .github/workflows/      # cron 収集ワークフロー
├── icons/                  # PWA アイコン
├── manifest.json / sw.js
├── vercel.json / .vercelignore
└── docs/superpowers/specs/
```

## 10. 環境変数（GitHub Secrets）

- `AISSTREAM_API_KEY`（無料登録）
- `ANTHROPIC_API_KEY`（翻訳・Haiku）
- 必要に応じ NASA FIRMS / N2YO のキー（いずれも無料）

## 11. 非目標（YAGNI）

- 真のライブWebSocketストリーミング（near-realtimeスナップショットで代替）
- 認証・ユーザー管理・機密データ保管
- 有料APIによる高精度化（将来検討、v1は対象外）
- 軍事活動の「正確な」リアルタイム追跡（OSINT近似のみ）
