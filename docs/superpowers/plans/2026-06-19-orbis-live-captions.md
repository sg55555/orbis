# Orbis ライブ字幕オーバーレイ（live-captions B フェーズ）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番 Orbis のニュースプレーヤー下端に、ローカル live-translate サーバ経由の日本語字幕をリアルタイムでオーバーレイする（別窓ページから Orbis 画面上へ移す）。

**Architecture:** Core（音声→VAD→STT→翻訳）は live-translate v1 のサーバをそのまま再利用。Orbis 側は「`getDisplayMedia` でタブ音声を取り 16k PCM を WebSocket 送出／受けた `caption{ja}` を `.media-player` 下端の `pointer-events:none` オーバーレイに描画」する薄い ES module クライアントだけを足す。live-translate には ws→wss 切替の保険として TLS 任意有効化（`ssl_kwargs`）のみ追加。

**Tech Stack:** Vanilla JS(ESM, no build) / AudioWorklet + WebSocket / MapLibre（変更なし）/ node --test（unit）/ Playwright（e2e・mock WS）/ Python FastAPI + uvicorn / pytest。

参照 spec: `docs/superpowers/specs/2026-06-19-orbis-live-captions-design.md`

## Global Constraints

- Vanilla JS ESM・ビルド無し。新規クライアントは既存 `js/ui/*.js` のスタイルに合わせる。
- Orbis SHELL（`index.html` / `js/main.js` / `css/orbis.css`）を変更するため `sw.js` の `CACHE` を **`orbis-v33` → `orbis-v34`** に上げる（上げないと更新が配信されない）。
- 新規 `js/ui/live-captions.js` / `js/ui/lc-worklet.js` は SHELL に追加しない（cache-first で初回フェッチ）。
- WS 接続は既定 **`ws://localhost:8900/ws`**、`?lc=wss` で `wss://localhost:8900/ws` に切替（mixed-content で弾かれた時の保険）。
- e2e は `workers:1`（直列・既存方針）。**`getDisplayMedia` は headless で出せない**ため音声取得経路は e2e 対象外（オーバーレイ描画・mock WS・再接続・cc 連携のみ検証）。実音声→字幕はオーナー実機受入。
- e2e のフック名は Orbis 名前空間で **`window.LC_WS_FACTORY` / `window.LC_RECONNECT_BASE_MS`**（live-translate の `LT_*` とは別。`lc` プレフィックス統一）。
- live-translate: WebSocket は CORS 非対象ゆえ Origin 検査は追加しない。サーバは `127.0.0.1` バインド。TLS は `LT_TLS_CERT`/`LT_TLS_KEY` 両方そろった時だけ有効。
- **live-translate リポジトリは git remote 未作成**。Task 1 の commit はローカルのみ（push 不可）。push 対象は orbis のみ。
- DRY / YAGNI / TDD / こまめな commit。

---

### Task 1: live-translate TLS 任意有効化（`ssl_kwargs` + Config）

**Files:**
- Modify: `~/apps/live-translate/live_translate/config.py`
- Modify: `~/apps/live-translate/live_translate/server.py:140-144`（`main()`）＋ module レベルに `ssl_kwargs` 追加
- Test: `~/apps/live-translate/tests/test_config.py`（追記）
- Test: `~/apps/live-translate/tests/test_server.py`（`ssl_kwargs` テスト追記）

**Interfaces:**
- Produces: `Config(tls_cert: str = "", tls_key: str = "")`、`ssl_kwargs(cfg: Config) -> dict`（両方そろえば `{"ssl_certfile","ssl_keyfile"}`、片方でも欠ければ `{}`）。

> このタスクは live-translate リポジトリ内で完結。コマンドは `cd ~/apps/live-translate` 前提。

- [ ] **Step 1: Config の TLS テストを書く（失敗させる）**

`tests/test_config.py` の末尾に追記:

```python
def test_tls_defaults(monkeypatch):
    for k in ["LT_TLS_CERT", "LT_TLS_KEY"]:
        monkeypatch.delenv(k, raising=False)
    c = Config.from_env()
    assert c.tls_cert == ""
    assert c.tls_key == ""

def test_tls_env_override(monkeypatch):
    monkeypatch.setenv("LT_TLS_CERT", "localhost.pem")
    monkeypatch.setenv("LT_TLS_KEY", "localhost-key.pem")
    c = Config.from_env()
    assert c.tls_cert == "localhost.pem"
    assert c.tls_key == "localhost-key.pem"
```

- [ ] **Step 2: 失敗を確認**

Run: `uv run pytest tests/test_config.py -q`
Expected: FAIL（`Config` に `tls_cert`/`tls_key` 属性が無い → AttributeError か TypeError）

- [ ] **Step 3: config.py に TLS フィールドを追加**

`live_translate/config.py` の `Config` に 2 フィールド追加し、`from_env` に 2 行追加:

```python
@dataclass
class Config:
    port: int = 8900
    stt_model: str = "auto"
    device: str = "auto"
    translator: str = "auto"
    anthropic_key: str | None = None
    tls_cert: str = ""
    tls_key: str = ""

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            port=int(os.environ.get("LT_PORT", "8900")),
            stt_model=os.environ.get("LT_STT_MODEL", "auto"),
            device=os.environ.get("LT_DEVICE", "auto"),
            translator=os.environ.get("LT_TRANSLATOR", "auto"),
            anthropic_key=os.environ.get("ANTHROPIC_API_KEY") or None,
            tls_cert=os.environ.get("LT_TLS_CERT", ""),
            tls_key=os.environ.get("LT_TLS_KEY", ""),
        )
```

- [ ] **Step 4: config テストが通ることを確認**

Run: `uv run pytest tests/test_config.py -q`
Expected: PASS（既存 + 新規 2 件）

- [ ] **Step 5: ssl_kwargs のテストを書く（失敗させる）**

`tests/test_server.py` の末尾に追記（先頭の import 群に無ければ `from live_translate.config import Config` と `from live_translate.server import ssl_kwargs` を足す）:

```python
def test_ssl_kwargs_both_present():
    from live_translate.config import Config
    from live_translate.server import ssl_kwargs
    cfg = Config(tls_cert="localhost.pem", tls_key="localhost-key.pem")
    assert ssl_kwargs(cfg) == {
        "ssl_certfile": "localhost.pem",
        "ssl_keyfile": "localhost-key.pem",
    }

def test_ssl_kwargs_missing_returns_empty():
    from live_translate.config import Config
    from live_translate.server import ssl_kwargs
    assert ssl_kwargs(Config(tls_cert="localhost.pem")) == {}
    assert ssl_kwargs(Config(tls_key="localhost-key.pem")) == {}
    assert ssl_kwargs(Config()) == {}
```

- [ ] **Step 6: 失敗を確認**

Run: `uv run pytest tests/test_server.py -q`
Expected: FAIL（`ssl_kwargs` が server.py に未定義 → ImportError）

- [ ] **Step 7: server.py に ssl_kwargs を追加し main() で渡す**

`live_translate/server.py` の module レベル（`def create_app` の前あたり、import 群の後）に追加:

```python
def ssl_kwargs(cfg: Config) -> dict:
    """cfg に TLS cert/key 両方が設定されていれば uvicorn 用 ssl 引数を返す。
    片方でも欠ければ {}（=平文 ws）。"""
    if cfg.tls_cert and cfg.tls_key:
        return {"ssl_certfile": cfg.tls_cert, "ssl_keyfile": cfg.tls_key}
    return {}
```

`main()` を変更（`server.py:140-144`）:

```python
def main() -> None:
    import uvicorn  # noqa: PLC0415

    cfg = Config.from_env()
    uvicorn.run(create_app(), host="127.0.0.1", port=cfg.port, **ssl_kwargs(cfg))
```

- [ ] **Step 8: 全 pytest が通ることを確認**

Run: `uv run pytest -q`
Expected: PASS（既存 21 件 + 新規 4 件 = 25 件）

- [ ] **Step 9: Commit（live-translate リポジトリ・ローカルのみ）**

```bash
cd ~/apps/live-translate
git add live_translate/config.py live_translate/server.py tests/test_config.py tests/test_server.py
git commit -m "feat(server): TLS任意有効化(ssl_kwargs + LT_TLS_CERT/KEY) — Orbis字幕オーバーレイのwss保険

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Orbis クライアント — worklet + live-captions モジュール（unit: lcWsUrl）

**Files:**
- Create: `~/apps/orbis/js/ui/lc-worklet.js`
- Create: `~/apps/orbis/js/ui/live-captions.js`
- Test: `~/apps/orbis/tests/live-captions.test.js`

**Interfaces:**
- Produces:
  - `lcWsUrl(search: string) -> string`（pure。`?lc=wss` で `wss://localhost:8900/ws`、それ以外 `ws://localhost:8900/ws`）。
  - `initLiveCaptions(playerEl, toggleEl, { onActivate }) -> { setEnabled(on), isEnabled(), connect(url), renderCaption(ev), setStatus(state,msg) }`。`playerEl` 内に `.lc-overlay`（`.lc-rows` + `.lc-status`）を生成し、`toggleEl` の `change` で start/stop。`connect`/`renderCaption`/`setStatus` は e2e フック兼用で返す。
  - AudioWorklet プロセッサ名 `'lc-pcm-worklet'`（`lc-worklet.js`）。
- Consumes: なし（live-translate サーバの WS プロトコル `{type:'caption',ja}` / `{type:'status',state,msg}` のみ）。

> `live-captions.js` の **module トップレベルは関数/定数定義のみ**にし、import 時に DOM/WebSocket に触れない（node unit から import 可能にするため）。

- [ ] **Step 1: lcWsUrl の失敗テストを書く**

`tests/live-captions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lcWsUrl } from '../js/ui/live-captions.js';

test('lcWsUrl: 既定は ws://localhost:8900/ws', () => {
  assert.equal(lcWsUrl(''), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('?foo=bar'), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl(undefined), 'ws://localhost:8900/ws');
});

test('lcWsUrl: ?lc=wss で wss://localhost:8900/ws', () => {
  assert.equal(lcWsUrl('?lc=wss'), 'wss://localhost:8900/ws');
  assert.equal(lcWsUrl('?x=1&lc=wss'), 'wss://localhost:8900/ws');
});

test('lcWsUrl: lc=ws など wss 以外は ws', () => {
  assert.equal(lcWsUrl('?lc=ws'), 'ws://localhost:8900/ws');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/live-captions.test.js`
Expected: FAIL（`live-captions.js` が無く import 解決不能）

- [ ] **Step 3: lc-worklet.js を作成（live-translate worklet.js の移植・プロセッサ名のみ変更）**

`js/ui/lc-worklet.js`:

```js
// Orbis ライブ字幕用 AudioWorklet。
// Silero VAD は 16kHz で 512 サンプル窓を要求する。render quantum は 128 サンプルなので
// 128 を 512 に貯めてから送る（128 のまま送ると VAD が常に無音判定する）。
class LcPcmWorklet extends AudioWorkletProcessor {
  constructor() { super(); this._buf = new Float32Array(512); this._n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      for (let i = 0; i < ch.length; i++) {
        this._buf[this._n++] = ch[i];
        if (this._n === 512) { this.port.postMessage(this._buf.slice(0)); this._n = 0; }
      }
    }
    return true;
  }
}
registerProcessor('lc-pcm-worklet', LcPcmWorklet);
```

- [ ] **Step 4: live-captions.js を作成（app.js + captions.js + オーバーレイ構築を ESM 統合）**

`js/ui/live-captions.js`:

```js
// Orbis ライブ字幕オーバーレイ（live-translate B フェーズ）。
// getDisplayMedia のタブ音声 → 16k PCM → WS(ローカル live-translate) → caption{ja} を
// ニュースプレーヤー下端の pointer-events:none オーバーレイに描画する。
// Core(VAD/STT/翻訳)は live-translate サーバ側。e2e は window.LC_WS_FACTORY /
// window.LC_RECONNECT_BASE_MS で mock 注入・バックオフ短縮できる。

const MAX_ROWS = 2;

// WS URL（既定 ws、?lc=wss で wss）。pure・単体テスト対象。
export function lcWsUrl(search) {
  const scheme = new URLSearchParams(search || '').get('lc') === 'wss' ? 'wss' : 'ws';
  return `${scheme}://localhost:8900/ws`;
}

// playerEl=.media-player（#media-news 内）, toggleEl=AI字幕チェックボックス。
// onActivate()=AI字幕ON時に同期で呼ぶ（YouTube cc を OFF にする連携用）。
export function initLiveCaptions(playerEl, toggleEl, { onActivate } = {}) {
  // --- オーバーレイ DOM ---
  const overlay = document.createElement('div');
  overlay.className = 'lc-overlay';
  const rowsEl = document.createElement('div'); rowsEl.className = 'lc-rows';
  const statusEl = document.createElement('div'); statusEl.className = 'lc-status';
  overlay.appendChild(rowsEl); overlay.appendChild(statusEl);
  playerEl.appendChild(overlay);

  const STATUS_TEXT = { listening: '認識中', processing: '処理中…', backlog: '遅延（間引き中）', error: 'エラー' };
  function setStatus(state, msg) { statusEl.textContent = msg || STATUS_TEXT[state] || state || ''; }
  function renderCaption(ev) {
    const row = document.createElement('div'); row.className = 'lc-row';
    row.textContent = ev.ja || '';
    rowsEl.appendChild(row);
    while (rowsEl.children.length > MAX_ROWS) rowsEl.removeChild(rowsEl.firstChild);
  }
  function clearRows() { rowsEl.innerHTML = ''; }

  // --- WS 接続（指数バックオフ自動再接続。captions.js から移植） ---
  function connect(wsUrl) {
    const BASE_MS = (typeof window !== 'undefined' && window.LC_RECONNECT_BASE_MS) || 500;
    const MAX_MS = 10000;
    let delay = BASE_MS;
    let intentional = false;
    let _ws = null;
    function open() {
      const ws = (typeof window !== 'undefined' && window.LC_WS_FACTORY)
        ? window.LC_WS_FACTORY(wsUrl) : new WebSocket(wsUrl);
      _ws = ws;
      ws.addEventListener('open', () => { delay = BASE_MS; setStatus('listening'); });
      ws.addEventListener('message', (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'caption') renderCaption(m);
        else if (m.type === 'status') setStatus(m.state, m.msg);
      });
      ws.addEventListener('close', () => {
        if (intentional) return;
        setStatus('error', 'ローカル翻訳サーバに再接続中…');
        const wait = delay; delay = Math.min(delay * 2, MAX_MS); setTimeout(open, wait);
      });
      return ws;
    }
    open();
    return {
      get ws() { return _ws; },
      disconnect() { intentional = true; if (_ws) _ws.close(); },
      send(data) { _ws && _ws.send(data); },
      get readyState() { return _ws ? _ws.readyState : WebSocket.CLOSED; },
    };
  }

  // --- 音声取得 + 送出 ---
  let actx = null, ctrl = null, node = null, stream = null, enabled = false;

  async function start() {
    enabled = true;
    if (onActivate) onActivate();          // YouTube cc を OFF（await 前に同期実行）
    clearRows(); setStatus('', 'タブの音声を共有してください…');
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      stream.getVideoTracks().forEach((t) => t.stop());
      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((t) => t.stop()); stream = null;
        setStatus('error', 'タブの音声が共有されていません（「タブの音声を共有」にチェック）'); return;
      }
      ctrl = connect(lcWsUrl(location.search));
      actx = new AudioContext({ sampleRate: 16000 });
      await actx.audioWorklet.addModule('js/ui/lc-worklet.js');
      const srcNode = actx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      node = new AudioWorkletNode(actx, 'lc-pcm-worklet');
      node.port.onmessage = (e) => { if (ctrl && ctrl.readyState === 1) ctrl.send(e.data.buffer); };
      srcNode.connect(node);
      // worklet を gain0 経由で destination に接続し graph を pull させ process() を発火
      const silent = actx.createGain(); silent.gain.value = 0;
      node.connect(silent).connect(actx.destination);
    } catch (err) {
      if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
      setStatus('error', 'ローカル翻訳サーバに接続できません（起動確認、または mkcert で wss 化し ?lc=wss）');
    }
  }

  function stop() {
    enabled = false;
    try { ctrl && ctrl.send(JSON.stringify({ type: 'stop' })); } catch { /* ignore */ }
    if (ctrl) { ctrl.disconnect(); ctrl = null; }
    if (node) node.disconnect();
    if (actx) actx.close();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    actx = null; node = null; stream = null;
    clearRows(); setStatus('', '');
  }

  function setEnabled(on) {
    if (toggleEl) toggleEl.checked = !!on;
    if (on) start(); else stop();
  }

  if (toggleEl) toggleEl.addEventListener('change', () => (toggleEl.checked ? start() : stop()));

  return { setEnabled, isEnabled: () => enabled, connect, renderCaption, setStatus };
}
```

- [ ] **Step 5: lcWsUrl テストが通ることを確認**

Run: `node --test tests/live-captions.test.js`
Expected: PASS（3 件）

- [ ] **Step 6: 既存 js unit が全緑であることを確認（import 副作用回帰なし）**

Run: `npm run test:js`
Expected: PASS（既存 + 新規）

- [ ] **Step 7: Commit**

```bash
cd ~/apps/orbis
git add js/ui/lc-worklet.js js/ui/live-captions.js tests/live-captions.test.js
git commit -m "feat(live-captions): Orbis字幕オーバーレイのクライアントモジュール+worklet(lcWsUrl unit)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Orbis 統合 — トグル + CSS + main.js 配線 + sw v34

**Files:**
- Modify: `~/apps/orbis/index.html:48-51`（`#media-bar` に `#lc-toggle` 追加）
- Modify: `~/apps/orbis/css/orbis.css:144-146`（`.media-player` 周辺にオーバーレイ CSS 追加）
- Modify: `~/apps/orbis/js/main.js:12`（import）/ `:337-351`（mediaApi 配線の直後）
- Modify: `~/apps/orbis/sw.js:2`（CACHE v33→v34）

**Interfaces:**
- Consumes: `initLiveCaptions`（Task 2）、`renderMedia` 返り値 `{ news, cams, setCaptions, setPlaying }`（既存 `js/ui/media.js`）、既存 DOM `#media-news .media-player` / `#media-cc-toggle`。
- Produces: グローバル `window.__orbis.liveCaptions`（e2e/デバッグ用、`initLiveCaptions` の返り値）。

- [ ] **Step 1: index.html に AI字幕トグルを追加**

`index.html` の `#media-bar`（48-51 行）の `.cc-note` span（50 行）の直後に 1 行追加:

```html
        <div id="media-bar" class="media-bar">
          <label class="cc-toggle"><input type="checkbox" id="media-cc-toggle" checked> 字幕</label>
          <span class="cc-note">※ 配信に字幕がある場合のみ表示（多くは英語・YouTube）</span>
          <label class="cc-toggle"><input type="checkbox" id="lc-toggle"> AI字幕(日本語)</label>
        </div>
```

- [ ] **Step 2: css/orbis.css にオーバーレイのスタイルを追加**

`.media-player iframe { ... }`（146 行）の直後に追加:

```css
.lc-overlay { position: absolute; left: 0; right: 0; bottom: 0; padding: 10px 14px 12px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  pointer-events: none; z-index: 3; }
.lc-rows { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; }
.lc-row { max-width: 92%; background: rgba(5, 8, 15, .62); color: #eaf6ff;
  font-size: 15px; line-height: 1.5; padding: 4px 12px; border-radius: 8px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .9); text-align: center; }
.lc-status { font-size: 11px; color: rgba(180, 200, 220, .8);
  text-shadow: 0 1px 2px rgba(0, 0, 0, .8); min-height: 13px; }
```

> 実装中の目視で位置/サイズ/不透明度を調整してよい（`?cap=` ノブは設けず実物比較で詰める方針）。`--muted` 等のテーマトークンが存在すれば status 色をそれに差し替え可。

- [ ] **Step 3: main.js に import を追加**

`js/main.js:12` の `import { renderMedia } from './ui/media.js';` の直後に:

```js
import { initLiveCaptions } from './ui/live-captions.js';
```

- [ ] **Step 4: main.js で initLiveCaptions を配線**

`js/main.js` の `const mediaApi = renderMedia(...)` 〜 `window.__orbis.media = mediaApi;`（337-351 行付近）のうち、`if (window.__orbis) window.__orbis.media = mediaApi;` の直後に追加:

```js
        // AI字幕（ローカル live-translate 経由・既定OFF）。ニュースプレーヤー下端にオーバーレイ。
        const lcPlayer = mediaRoot.querySelector('#media-news .media-player');
        const lcToggle = document.getElementById('lc-toggle');
        if (lcPlayer && lcToggle) {
          const lc = initLiveCaptions(lcPlayer, lcToggle, {
            onActivate() {
              // AI字幕ON時は YouTube cc を OFF にして二重字幕を避ける（プログラム変更は change を発火しないので setCaptions も明示呼び）。
              const cc = document.getElementById('media-cc-toggle');
              if (cc && cc.checked) { cc.checked = false; mediaApi.setCaptions(false); }
            },
          });
          if (window.__orbis) window.__orbis.liveCaptions = lc;
        }
```

- [ ] **Step 5: sw.js の CACHE 版を上げる**

`sw.js:2` を変更:

```js
const CACHE = 'orbis-v34';
```

- [ ] **Step 6: 構文・unit 回帰確認**

Run: `cd ~/apps/orbis && npm run test:js && node --check js/main.js`
Expected: PASS（unit 全緑）。`node --check` はエラー無し（ESM import のみのファイルは構文チェックのみ）。

> 補足: `node --check` は ESM の import 解決まではしない。構文エラー検出が目的。実体配線は Task 4 の e2e で検証する。

- [ ] **Step 7: Commit**

```bash
cd ~/apps/orbis
git add index.html css/orbis.css js/main.js sw.js
git commit -m "feat(live-captions): AI字幕トグル+オーバーレイCSS+main.js配線(cc連携)・sw v34

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Orbis e2e（オーバーレイ構造 / mock WS 字幕 / 再接続 / cc 連携）

**Files:**
- Test: `~/apps/orbis/tests/e2e/live-captions.spec.js`

**Interfaces:**
- Consumes: `window.__orbis.liveCaptions`（Task 3）の `connect` / `renderCaption`、DOM `#lc-toggle` / `#media-cc-toggle` / `#media-news .media-player .lc-overlay`。

- [ ] **Step 1: e2e spec を書く**

`tests/e2e/live-captions.spec.js`:

```js
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
```

- [ ] **Step 2: e2e を実行して通すことを確認**

Run: `cd ~/apps/orbis && npx playwright test live-captions`
Expected: PASS（1 spec）。失敗時は `window.__orbis.liveCaptions` 未定義（news データ未配信）を疑い、`config/live_channels.json` の存在を確認。

- [ ] **Step 3: e2e 全体が緑であることを確認（回帰なし）**

Run: `npm run test:e2e`
Expected: PASS（既存 smoke/media/mobile-nav/flight-projection/ship-projection + 新規 live-captions）。

- [ ] **Step 4: Commit**

```bash
cd ~/apps/orbis
git add tests/e2e/live-captions.spec.js
git commit -m "test(e2e): live-captions オーバーレイ/字幕/再接続/cc連携の構造検証

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: ドキュメント（mkcert）＋ 最終検証 ＋ push

**Files:**
- Modify: `~/apps/live-translate/README.md`（mkcert 手順を追記）

**Interfaces:** なし（運用ドキュメント＋デプロイ）。

- [ ] **Step 1: live-translate README に mkcert/wss 手順を追記**

`README.md` の起動手順の近くに、以下のセクションを追記:

```markdown
## Orbis 字幕オーバーレイで使う（ws → 必要なら wss）

1. 通常起動（平文 ws）: `uv run python -m live_translate.server`
2. 本番 Orbis(https) で「AI字幕(日本語)」を ON。下端に字幕が出れば設定ゼロで完了。
3. mixed-content で弾かれた場合のみ wss 化（一度きり）:

   ```bash
   mkcert -install                # ローカルCAをOS/ブラウザに導入（初回のみ）
   mkcert localhost 127.0.0.1 ::1 # localhost.pem / localhost-key.pem を生成
   LT_TLS_CERT=localhost.pem LT_TLS_KEY=localhost-key.pem uv run python -m live_translate.server
   ```

   その後 Orbis を `?lc=wss` 付きで開く（`wss://localhost:8900/ws` に接続）。
```

- [ ] **Step 2: README を commit（live-translate・ローカルのみ）**

```bash
cd ~/apps/live-translate
git add README.md
git commit -m "docs: Orbis字幕オーバーレイ用の起動/mkcert(wss)手順

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 3: 全テストスイートを最終実行**

```bash
cd ~/apps/live-translate && uv run pytest -q
cd ~/apps/orbis && npm run test:js && npm run test:e2e
```
Expected: 全 PASS。

- [ ] **Step 4: ローカル実物サニティ（任意・視覚）**

`cd ~/apps/orbis && python3 -m http.server 8000` で開き、`#media` までスクロール → 「AI字幕(日本語)」をチェックすると `#media-cc-toggle` が外れること、status 行に案内が出ることを目視（サーバ未起動なら「接続できません」案内が出るのが正常）。

- [ ] **Step 5: orbis を push（live-translate は remote 未作成のためローカルのまま）**

```bash
cd ~/apps/orbis
git push origin main
```
> push 先は保護ブランチ直 push ではなく、GitHub 連携の通常運用（main → Vercel 自動デプロイ）。live-translate は remote が無いため push しない（個人ローカル運用で足りる）。

- [ ] **Step 6: 本番デプロイ確認（curl）**

```bash
sleep 30
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://orbis-beta.vercel.app/js/ui/live-captions.js
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" https://orbis-beta.vercel.app/js/ui/lc-worklet.js
curl -s https://orbis-beta.vercel.app/sw.js | grep -m1 CACHE         # orbis-v34
curl -s https://orbis-beta.vercel.app/ | grep -c 'id="lc-toggle"'    # 1
```
Expected: live-captions.js/lc-worklet.js が 200（JS の content-type）、sw が `orbis-v34`、`lc-toggle` が 1。

- [ ] **Step 7: 残作業の明示（オーナー実機受入）**

実機受入手順を報告:
1. `cd ~/apps/live-translate && uv pip install -r requirements-ml.txt`（初回のみ）→ `uv run python -m live_translate.server`。
2. 本番 Orbis でニュースを選局・**プレーヤーを unmute**・「AI字幕(日本語)」ON・「タブの音声を共有」。
3. プレーヤー下端に日本語字幕が出る／OFF で消える。出ない＋コンソールに mixed-content エラーなら README の wss 手順（`?lc=wss`）。

---

## Self-Review

**1. Spec coverage（spec 各節 → タスク対応）:**
- §4 live-translate TLS（config/ssl_kwargs/test/README mkcert）→ Task 1 + Task 5 Step1。✓
- §5.1 lc-worklet.js → Task 2 Step3。✓
- §5.2 live-captions.js（オーバーレイ/connect/start/stop/WS URL）→ Task 2 Step4。✓
- §5.3 index.html トグル → Task 3 Step1。✓
- §5.4 main.js 配線（onActivate で cc OFF）→ Task 3 Step4。✓
- §5.5 CSS → Task 3 Step2。✓
- §5.6 sw v→ → Task 3 Step5（v33→v34。spec の v30→v31 は spec 執筆後に没入感作業が v33 まで上げたため現状に合わせた）。✓
- §8 テスト（pytest ssl_kwargs / Playwright caption・reconnect・cc連携・overlay構造）→ Task 1, Task 4。✓
- §10 DoD（ssl_kwargs+test / トグル・オーバーレイ・再接続・cc連携 e2e / sw / 本番 / 手動受入）→ Task 1/3/4/5。✓

**2. Placeholder scan:** TBD/TODO/「適切に処理」等なし。全ステップに実コード・実コマンド・期待値あり。✓

**3. Type consistency:** `connect/renderCaption/setStatus/setEnabled/isEnabled` は Task 2 の返り値定義と Task 4 の e2e 利用が一致。AudioWorklet 名 `'lc-pcm-worklet'` は lc-worklet.js の `registerProcessor` と live-captions.js の `new AudioWorkletNode(actx,'lc-pcm-worklet')` が一致。`window.LC_WS_FACTORY`/`window.LC_RECONNECT_BASE_MS` は live-captions.js（Task 2）と e2e（Task 4）で一致。`window.__orbis.liveCaptions` は Task 3 でセット・Task 4 で参照、一致。✓

**逸脱メモ:** e2e フック名を spec の `LT_WS_FACTORY` ではなく Orbis 名前空間の `LC_WS_FACTORY` にした（lc プレフィックス統一・live-translate のグローバルと混同回避）。挙動は同一。
