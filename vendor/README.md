# vendor/ — 外部ライブラリの自前配信（手で触らない）

ここのファイルは **`scripts/fetch_vendor.py` が上流から取得したバイトそのもの**です。
手で編集しないでください（`tests/test_vendor_integrity.py` が `tests/vendor.sha256` と突合して落ちます）。
厳格 CSP（`script-src 'self'; style-src 'self'; font-src 'self'`）を満たすため、
外部 CDN への `<script>` / `<link>` は **1 本も置きません**。

取得日: 2026-09-04

## 中身と上流

| ファイル | 上流 | ライセンス |
|---|---|---|
| `maplibre-gl-5.24.0.js` | `https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js` | BSD-3-Clause（`LICENSE-maplibre-gl.txt`） |
| `maplibre-gl-5.24.0.css` | `https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css` | 同上 |
| `deck.gl-core-9.3.4.min.js` | `https://unpkg.com/@deck.gl/core@9.3.4/dist.min.js` | MIT（`LICENSE-deck.gl.txt`） |
| `deck.gl-layers-9.3.4.min.js` | `https://unpkg.com/@deck.gl/layers@9.3.4/dist.min.js` | 同上 |
| `deck.gl-mapbox-9.3.4.min.js` | `https://unpkg.com/@deck.gl/mapbox@9.3.4/dist.min.js` | 同上 |
| `deck.gl-mesh-layers-9.3.4.min.js` | `https://unpkg.com/@deck.gl/mesh-layers@9.3.4/dist.min.js` | 同上 |
| `deck.gl-geo-layers-9.3.4.min.js` | `https://unpkg.com/@deck.gl/geo-layers@9.3.4/dist.min.js` | 同上 |
| `fonts/orbitron-latin.woff2` | `https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Saira:wght@400;500;600;700&display=swap` の `/* latin */` ブロック | SIL OFL 1.1（`fonts/OFL-Orbitron.txt`） |
| `fonts/saira-latin.woff2` | 同上 | SIL OFL 1.1（`fonts/OFL-Saira.txt`） |
| `fonts/fonts.css` | 上記 css2 応答から `scripts/fetch_vendor.py` が生成（`src` をローカル相対に書き換え） | — |

Google css2 は **Chrome の UA で取得すると可変フォントの woff2** を返す（latin は 1 家族 1 ファイル）。
`unicode-range` は css2 の latin ブロックの値をそのまま写している。

## 読み込み順（重要・壊れ方が分かりにくい）

deck.gl 9.x の分割 UMD は 5 本とも `window.deck` に**マージ**される。依存があるので順序を守る:

1. `deck.gl-core` → 2. `deck.gl-layers` → 3. `deck.gl-mapbox`（ここまで `index.html` の `<script defer>`）
4. `deck.gl-mesh-layers` → 5. `deck.gl-geo-layers`（`js/lib/vendor-loader.js` が『交通』で遅延ロード）

`geo-layers` を `mesh-layers` より先に読むと `Class extends value undefined` で死ぬ（2026-09-03 Chromium 実測）。
起動時は 1〜3 の 238KB gzip だけ（全部入りは 460KB・geo 系は +237KB）。

## 再取得・版上げ

実行1（1 回だけ・リポジトリ直下で・上流から取り直して sha256 を作り直す）
```
python3 scripts/fetch_vendor.py
```

実行2（1 回だけ・取得せず固定値と突合するだけ）
```
python3 scripts/fetch_vendor.py --check
```

版を上げるときは `scripts/fetch_vendor.py` の `MAPLIBRE_VERSION` / `DECK_VERSION` と、
`index.html`・`js/lib/vendor-loader.js`・`tests/test_vendor_integrity.py` の **ファイル名**、
`vendor/README.md` のこの表をまとめて直す。`vercel.json` の `/vendor/(.*)` は
`max-age=31536000, immutable` なので **ファイル名に版を含めること**が必須。
