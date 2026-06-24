# Orbis ライブ字幕オーバーレイ（live-captions B フェーズ）設計

> 親プロジェクト: `live-translate`（動画リアルタイム翻訳エンジン）の **B フェーズ**＝
> 字幕を「別窓の live-translate ページ」ではなく **Orbis 画面上にオーバーレイ**する。
> Core（Python: VAD→Whisper→翻訳）は live-translate v1 のものを**そのまま再利用**し、
> 配信先だけを Orbis ニュースプレーヤーに差し替える。

- date: 2026-06-19
- status: 設計確定（実装計画 待ち）
- related: live-translate v1（`~/apps/live-translate`）, Obsidian `Projects/live-translate.md`, `Projects/orbis.md`

---

## 1. 目的とスコープ

### 目的
オーナーが本番 Orbis（`https://orbis-beta.vercel.app/`）で外国語ニュースを視聴する際、
**ニュースプレーヤーの下端に日本語字幕をリアルタイムでオーバーレイ**する。
現状（live-translate v1）は字幕が「別窓の live-translate ページ＋端末ログ」止まり。これを Orbis 画面上へ移す。

### やること（スコープ）
- 本番 https Orbis の**ニュースプレーヤー（`#media-news` の `.media-player`）下端**に字幕オーバーレイ。
- 音声取得は `getDisplayMedia`（Orbis タブの音声共有）。これは v1 で実機動作確認済みの load-bearing 経路。
- ローカル live-translate サーバへ 16k PCM を WebSocket 送出し、`caption{ja}` を受けて描画。
- 接続は `wss://localhost:8900`（まず素の `ws://` を実測、弾かれたら `wss://` ＋ mkcert）。
- メディアバーに新トグル **「AI字幕(日本語)」**（既存の YouTube cc「字幕」とは別物）。

### やらないこと（非スコープ）
- カメラ音声の字幕（環境音中心・発話少。混信源にもなる）。
- ブラウザ拡張（真の他アプリ横断）＝将来フェーズ。
- 翻訳サーバのクラウド/公開ホスティング。
- 原文（英語など）併記＝将来オプション（live-translate 側に `bilingual` 機構はあるが本 v1 では出さない）。
- 複数ソース同時再生時の混信対策（ニュース1本だけ unmute する運用前提で回避）。

---

## 2. 制約と既知の事実（実コード・実機由来）

1. **cross-origin iframe の音声はページから直接取れない** → `getDisplayMedia` のタブ音声共有で回避（v1 で確認済み）。
2. **`getDisplayMedia` も `http://localhost` も secure context** 扱い。https でも localhost でもキャプチャ自体は動く。
   唯一の障壁は「https ページから `ws://localhost` への接続が **mixed-content** で弾かれるか」だけ。
3. **WebSocket は CORS の対象外**。Starlette/FastAPI は既定で全 Origin の WS を accept する
   → 本番 Orbis(https) から `wss://localhost` への**クロスオリジン WS にサーバ側コードの変更は不要**。
4. live-translate サーバは `127.0.0.1` バインド（ローカル限定露出）。`/ws` は v1 のまま再利用。
5. Orbis ニュースの埋め込みは既定 `mute=1`（autoplay 制約）。**字幕を得るにはユーザーがプレーヤーを unmute** する必要がある
   （タブ音声共有は実際に鳴っている音を拾うため）。これは運用上の前提として明記する。
6. Orbis の SW（`sw.js`）は data/cartocdn 以外を cache-first でキャッシュ。
   `index.html` / `js/main.js` / `css/orbis.css`（SHELL）は **CACHE 版を上げないと更新が配信されない**（現 `orbis-v30`）。

---

## 3. アーキテクチャ

```
            ┌────────────────────── Orbis タブ（https） ──────────────────────┐
            │  [YouTube iframe: ニュース映像＋音声(unmute)]                     │
            │            │ getDisplayMedia({audio:true})                        │
            │            ▼                                                      │
            │  js/ui/live-captions.js                                           │
            │   AudioContext(16k) → AudioWorklet(lc-worklet.js: 128→512蓄積)    │
            │            │ Float32 PCM(512)                                     │
            │            ▼ WebSocket 送出                                        │
            │  字幕オーバーレイ div  ◄── caption{ja} ──┐                        │
            │  (.media-player 下端・pointer-events:none)│                       │
            └───────────────────────────────────────────┼──────────────────────┘
                                                         │ wss://localhost:8900/ws
                            ┌────────────────────────────┴──────────────────────┐
                            │ live-translate サーバ（ローカル・変更=TLS任意のみ） │
                            │  QueueAudioSource→Segmenter(Silero VAD)→            │
                            │  Stt(faster-whisper CPU)→Translator(auto)→WSCaptionSink│
                            └─────────────────────────────────────────────────────┘
```

**責務分離の原則**: Core（音声→VAD→STT→翻訳→字幕イベント）は live-translate に閉じる。
Orbis 側は「音声を集めて送る／字幕を描く」薄いクライアントだけを持つ。

---

## 4. live-translate 側の変更（最小・TLS 任意有効化のみ）

リポジトリ: `~/apps/live-translate`

### 4.1 Config に TLS フィールド追加
`live_translate/config.py` の `Config` に以下を追加（env から読む）。

- `tls_cert: str = ""`（`LT_TLS_CERT`）
- `tls_key: str = ""`（`LT_TLS_KEY`）

`from_env()` に対応行を追加。

### 4.2 純粋ヘルパ `ssl_kwargs(cfg)` を追加（テスト可能化）
`live_translate/server.py` に追加:

```python
def ssl_kwargs(cfg: Config) -> dict:
    """cfg に TLS cert/key 両方が設定されていれば uvicorn 用 ssl 引数を返す。
    片方でも欠ければ {}（=平文 ws）。"""
    if cfg.tls_cert and cfg.tls_key:
        return {"ssl_certfile": cfg.tls_cert, "ssl_keyfile": cfg.tls_key}
    return {}
```

`main()` を変更:

```python
def main() -> None:
    import uvicorn  # noqa: PLC0415
    cfg = Config.from_env()
    uvicorn.run(create_app(), host="127.0.0.1", port=cfg.port, **ssl_kwargs(cfg))
```

### 4.3 テスト
`tests/` に純粋関数テストを追加:
- `ssl_kwargs` は cert/key 両方ありで 2 キーの dict、どちらか欠ければ空 dict。
- WS 契約（accept→PCM 受信→sink 送出）は v1 のテストで担保済み（本変更で不変）。WS は CORS 非対象ゆえ Origin 検査は追加しない。

### 4.4 mkcert 手順（README に追記・一度きり）
```bash
mkcert -install                       # ローカルCAをOS/ブラウザに導入（初回のみ）
mkcert localhost 127.0.0.1 ::1        # localhost.pem / localhost-key.pem を生成
LT_TLS_CERT=localhost.pem LT_TLS_KEY=localhost-key.pem uv run python -m live_translate.server
```
**注**: ws を先に試す運用なので、mkcert は「ws が mixed-content で弾かれた場合のみ」必要。

---

## 5. Orbis 側の実装

リポジトリ: `~/apps/orbis`

### 5.1 新規ファイル: `js/ui/lc-worklet.js`（AudioWorklet）
live-translate の `worklet.js` と同一ロジック（render quantum 128 を 512 サンプルに貯めて post）。
**Silero VAD が 16kHz で 512 サンプルの実音声窓を要求**するため必須（128 のままだとゼロ埋めで常時無音判定）。

```js
class PcmWorklet extends AudioWorkletProcessor {
  constructor(){ super(); this._buf = new Float32Array(512); this._n = 0; }
  process(inputs){
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length){
      for (let i=0;i<ch.length;i++){
        this._buf[this._n++] = ch[i];
        if (this._n === 512){ this.port.postMessage(this._buf.slice(0)); this._n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('lc-pcm-worklet', PcmWorklet);
```

### 5.2 新規ファイル: `js/ui/live-captions.js`（クライアント本体）
live-translate の `app.js` ＋ `captions.js` を Orbis 向けに統合移植。
**ES module**（Orbis の他 ui モジュールに合わせる）。`#news-frame` を含む `.media-player` を受け取り、その中に字幕オーバーレイ div を作る。

公開 API:
```js
// playerEl=.media-player（#media-news 内）, toggleEl=AI字幕チェックボックス。
// onActivate()=AI字幕ON時に呼ぶ（YouTube cc を自動OFFにする等の連携用）。
// 返り値 { setEnabled(on), isEnabled() }。
export function initLiveCaptions(playerEl, toggleEl, { onActivate } = {}) { ... }
```

責務:
- `playerEl` 内に `<div class="lc-overlay"><div class="lc-rows"></div><div class="lc-status"></div></div>` を生成。
  `pointer-events:none`、絶対配置で映像下端、最大 2 行（`MAX_ROWS=2`）。
- トグル ON（`change` イベント＝user gesture）で `start()`:
  1. `onActivate()` を呼ぶ（呼び出し側で YouTube cc を OFF）。
  2. `navigator.mediaDevices.getDisplayMedia({ video:true, audio:true })` → video トラックは即 stop。
     audio トラック 0 本なら status「タブの音声が共有されていません」を表示して中断。
  3. `AudioContext({sampleRate:16000})` → `addModule('js/ui/lc-worklet.js')` → `AudioWorkletNode(actx,'lc-pcm-worklet')`。
  4. worklet を **gain 0 経由で destination に接続**（graph を pull させ process() を発火）。
  5. `worklet.port.onmessage` で受けた 512 PCM を WS が open 中のみ送出。
- WS 接続は `connectWs(url)`（`captions.js` の指数バックオフ移植: BASE 500ms→×2→上限 10s、open でリセット、
  intentional フラグ付き disconnect で再接続停止）。`message` で `{type:'caption',ja}` を描画、`{type:'status'}` を status 表示。
- トグル OFF で `stop()`: `{type:'stop'}` 送出 → disconnect → worklet/AudioContext/stream を解放 → オーバーレイ行をクリア。
- **接続不可時**（サーバ未起動 or mixed-content 拒否）: status 行に
  「ローカル翻訳サーバに接続できません（起動確認、または mkcert で wss 化し `?lc=wss`）」を表示しつつ自動再接続。

WS URL 決定（**「まず ws を実測」運用を反映**）:
```js
// 既定 scheme=ws（設定ゼロでの接続を先に試す）。?lc=wss でmkcert後のwssに切替。
const scheme = new URLSearchParams(location.search).get('lc') === 'wss' ? 'wss' : 'ws';
const LC_WS_URL = `${scheme}://localhost:8900/ws`;
```

### 5.3 `index.html`: メディアバーに新トグル追加
`#media-bar`（49行目付近）の既存 cc トグルの隣に併設:
```html
<label class="cc-toggle"><input type="checkbox" id="lc-toggle"> AI字幕(日本語)</label>
```
既存の `#media-cc-toggle`（YouTube cc「字幕」）はそのまま残す。

### 5.4 `js/main.js`: 配線
- `media.js` の `renderMedia` 返り値（`{ news, cams, setCaptions, setPlaying }`）を使い、
  `initLiveCaptions(playerEl=#media-news .media-player, toggleEl=#lc-toggle, { onActivate })` を初期化。
- `onActivate` の中で `#media-cc-toggle` を `checked=false` にし `mediaApi.setCaptions(false)` を呼ぶ
  （AI字幕 ON 時に YouTube cc を OFF＝二重字幕回避）。

### 5.5 `css/orbis.css`: オーバーレイ＋トグルのスタイル
- `.media-player` を `position: relative`（オーバーレイの絶対配置基準）。
- `.lc-overlay`: 絶対配置・`bottom:0`・横幅 100%・`pointer-events:none`・中央寄せ。
- `.lc-rows .lc-row`: 半透明黒背景（`background: rgba(5,8,15,.62)`）・白文字・`text-shadow`・角丸・`font-size` 適度・最大 2 行。
- `.lc-status`: 小さめ・控えめ色（`var(--muted)` 等）。
- Orbis のダーク紺＋シアン系トーンに馴染ませる。
- **`?cap=` 系のノブは設けず**、実機で見ながら CSS を直接詰める（オーナーの実物比較スタイル）。最終位置/サイズ/不透明度は実装中の目視で確定。

### 5.6 `sw.js`: CACHE 版を上げる
`const CACHE = 'orbis-v30'` → `'orbis-v31'`（index.html/main.js/orbis.css を変更するため必須）。
新規 `js/ui/live-captions.js` / `js/ui/lc-worklet.js` は SHELL 非追加で可（cache-first で初回フェッチされる）。

---

## 6. データフロー（混信回避の運用前提）

getDisplayMedia はタブ音声を**合成して**拾う。ニュースとカメラを同時に鳴らすと STT が混信する。
→ **AI字幕を使うときはニュース1本だけ unmute、カメラはミュート**、という運用前提を status ヒントにも明記。
（カメラ字幕は非スコープ。将来、ソース選択 UI を入れるなら別フェーズ。）

---

## 7. 接続の段取り（最脆弱前提の検証と fallback）

**最脆弱前提**: 「本番 https Orbis から `ws://localhost` への WS 接続が通る」。
Chrome は loopback（localhost/127.0.0.1/::1）を potentially-trustworthy 扱いするため通る可能性があるが、確証はない。

検証手順（実装後の受入で実施）:
1. live-translate サーバを平文起動（`uv run python -m live_translate.server`）。
2. 本番 Orbis を開き、AI字幕トグル ON（既定 `ws://`）。下端に字幕が出れば **設定ゼロで完了**。
3. 出ず status が「接続できません」かつ DevTools コンソールに mixed-content エラー → fallback へ:
   - mkcert で localhost 証明書を作成、`LT_TLS_CERT/LT_TLS_KEY` でサーバを wss 起動。
   - Orbis を `?lc=wss` 付きで開く → `wss://localhost:8900/ws` に接続。

**設計はどちらに転んでも survive**（ws ノブと wss ノブの両方を持つ）。

---

## 8. テスト戦略

### live-translate（pytest）
- `ssl_kwargs(cfg)`: cert/key 両方→2キー dict、片方欠け/両欠け→`{}`。
- 既存 21 件は不変で緑のまま。

### Orbis（Playwright・mock WS／既存パターン流用）
live-translate v1 の e2e（`window.LT_WS_FACTORY` で mock WebSocket 注入）と同型を Orbis に持ち込む:
- **字幕描画**: mock WS から `{type:'caption',ja:'…'}` を流し `.lc-rows` に行が出る／2 行上限。
- **再接続**: mock close → status「再接続中…」→ 再 open でリセット（`window.LC_RECONNECT_BASE_MS` で短縮）。
- **トグル連携**: `#lc-toggle` を ON にすると `#media-cc-toggle` が OFF になる（getDisplayMedia は mock/skip）。
- **オーバーレイ構造**: `.media-player` 内に `.lc-overlay` が `pointer-events:none` で存在。
- getDisplayMedia 自体は headless で出せないため、AudioContext/worklet 配線は e2e 対象外（手動受入で担保）。
- 既存 e2e は `workers:1` 直列（flake 対策・既存方針）を踏襲。

### 手動受入（オーナー実機）
1. live-translate サーバ起動（ML 入り）。
2. 本番 Orbis でニュース選局・unmute・AI字幕 ON・「タブの音声を共有」。
3. プレーヤー下端に日本語字幕が出る／OFF で消える／再接続が効く。

---

## 9. リスクと最脆弱前提（再掲）

| リスク | 対応 |
|---|---|
| https→ws://localhost が mixed-content で弾かれる（最脆弱） | wss+mkcert を設計内蔵（`?lc=wss`＋TLS env）。ws を先に無料で試す。 |
| 複数ソース同時再生で混信 | ニュース1本 unmute 運用前提＋status ヒント。カメラ字幕は非スコープ。 |
| 埋め込み既定 mute で音が拾えない | ユーザーが unmute する前提を明記（タブ音声は実音を拾う）。 |
| SHELL 更新が配信されない | CACHE 版を v31 に上げる。 |
| AudioWorklet 未 destination 接続で無音 | gain 0 経由で destination 接続（v1 の既知ハマり点を踏襲）。 |

---

## 10. 受入条件（Definition of Done）

- live-translate: `ssl_kwargs` 実装＋テスト緑、`LT_TLS_CERT/KEY` で wss 起動できる、README に mkcert 手順。
- Orbis: AI字幕トグル／オーバーレイ／再接続／cc 連携が e2e 緑、SW v31、本番デプロイ。
- 手動受入: 本番 Orbis のニュース下端に日本語字幕が出る（ws もしくは wss いずれかの経路で）。
