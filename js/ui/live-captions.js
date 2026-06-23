// Orbis ライブ字幕オーバーレイ（live-translate B フェーズ）。
// getDisplayMedia のタブ音声 → 16k PCM → WS(ローカル live-translate) → caption{ja} を
// ニュースプレーヤー下端の pointer-events:none オーバーレイに描画する。
// Core(VAD/STT/翻訳)は live-translate サーバ側。e2e は window.LC_WS_FACTORY /
// window.LC_RECONNECT_BASE_MS で mock 注入・バックオフ短縮できる。

const MAX_ROWS = 2;
const FINALIZED_CAP = 16;   // 確定 seg watermark の保持上限（古いものから evict）
const STALE_MS = 4000;      // 確定が来ない interim 行を掃除するまでの猶予

// 表示文字列ルール（server/client 共有契約）:
//   final  → ev.ja || ev.src （Haiku 日本語訳）
//   interim→ ev.src || ev.ja （原文 ASR 即時）
function captionText(ev) {
  return ev.final ? (ev.ja || ev.src || '') : (ev.src || ev.ja || '');
}

// ---------------------------------------------------------------------------
// renderer 状態機械（DOM 非依存 seam）。
// initLiveCaptions の実 DOM でも node:test の極小 DOM シムでも同じコードが動くよう、
// doc.createElement / element の className,textContent,style,classList,appendChild,
// removeChild,firstChild,children だけに依存する。時間依存（rAF coalesce / stale
// sweep）は raf・now を注入して決定的にテストできる。
//
// 状態:
//   segMap   = Map<seg_id, rowEl>  … 現在 DOM 上にある interim/final 行（seg_id 付きのみ）
//   finalized= Set<seg_id>          … 確定済み watermark（I2: late-interim を無視）
//   interimTs= Map<rowEl, ms>       … interim 行の最終更新時刻（stale sweep 用）
//   pendingRaf = Map<seg_id, ev>    … rAF coalesce 待ちの interim 書込み（最後の値で1回）
// ---------------------------------------------------------------------------
export function createCaptionRenderer(opts = {}) {
  const rowsEl = opts.rowsEl;
  const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
  const maxRows = opts.maxRows || MAX_ROWS;
  const staleMs = opts.staleMs || STALE_MS;
  const now = opts.now || (() => Date.now());
  const raf = opts.raf
    || (typeof requestAnimationFrame !== 'undefined'
      ? (cb) => requestAnimationFrame(cb)
      : (cb) => { cb(); return 0; });
  const reducedMotion = !!opts.reducedMotion;

  const segMap = new Map();      // seg_id -> rowEl
  const finalized = new Set();   // seg_id watermark
  const interimTs = new Map();   // rowEl -> last update ms
  let pendingRaf = null;         // Map<seg_id, ev> or null
  let autoSeq = -1;              // seg_id 欠落 caption 用の衝突しない仮 id（負方向）

  function newRow() {
    const row = doc.createElement('div');
    row.className = 'lc-row';
    return row;
  }

  // 行追加後に MAX_ROWS を超えたら最古を削除。削除ノードに紐づく segMap/interimTs も掃除し
  // orphan ノードへの書込みを防ぐ（trim 後 final で ghost 行が残らない）。
  function trim() {
    while (rowsEl.children.length > maxRows) {
      const dead = rowsEl.firstChild;
      rowsEl.removeChild(dead);
      interimTs.delete(dead);
      for (const [sid, el] of segMap) if (el === dead) { segMap.delete(sid); break; }
    }
  }

  // interim 行の実書込み（rAF でコアレスされる）。
  function writeInterim(seg, ev) {
    if (finalized.has(seg)) return;        // I2: 確定後の late-interim は無視
    let row = segMap.get(seg);
    if (!row) {
      row = newRow();
      rowsEl.appendChild(row);
      segMap.set(seg, row);
    }
    row.textContent = captionText(ev);     // 同一 seg は上書き（append 禁止）
    row.classList.add('lc-row--interim');
    interimTs.set(row, now());
    trim();
  }

  function flushRaf() {
    const batch = pendingRaf; pendingRaf = null;
    if (!batch) return;
    for (const [seg, ev] of batch) writeInterim(seg, ev);
  }

  function scheduleInterim(seg, ev) {
    // raf が同期実装（テスト）でも壊れないよう、map に積んでから raf を呼ぶ。
    const fresh = !pendingRaf;
    if (fresh) pendingRaf = new Map();
    pendingRaf.set(seg, ev);               // 同一 seg は最後の interim だけ反映
    if (fresh) raf(flushRaf);
  }

  // final（確定）: bypass=即時。同一 seg 行を ja へ置換し interim 状態を解除。
  function writeFinal(seg, ev) {
    rememberFinalized(seg);
    if (pendingRaf) pendingRaf.delete(seg); // 保留中 interim を破棄（final が終端）
    let row = segMap.get(seg);
    if (!row) {                             // trim 済み or 未生成 → 新規行
      row = newRow();
      rowsEl.appendChild(row);
      segMap.set(seg, row);
    }
    row.textContent = captionText(ev);
    row.classList.remove('lc-row--interim');
    interimTs.delete(row);                  // final 行は stale sweep 対象外
    // settle: reduced-motion なら transition なし、通常は 120ms opacity フェード
    row.style.transition = reducedMotion ? 'none' : 'opacity 120ms ease';
    trim();
  }

  function rememberFinalized(seg) {
    finalized.add(seg);
    if (finalized.size > FINALIZED_CAP) {
      const oldest = finalized.values().next().value; // Set は挿入順 → 最古
      finalized.delete(oldest);
    }
  }

  // caption イベント取り込み（interim/final 共通入口）。
  function upsert(ev) {
    if (!ev) return;
    // seg_id 欠落（旧 {type:caption, ja} 形式 / 契約外）は interim/final の lifecycle を
    // 持たないため、衝突しない仮 id で「即時・新規行」に確定描画する（rAF を介さず append 相当）。
    if (ev.seg_id == null) { writeFinal(autoSeq--, ev); return; }
    if (ev.final) writeFinal(ev.seg_id, ev);
    else scheduleInterim(ev.seg_id, ev);
  }

  // drop_seg control: orphan interim 行を掃除。
  function dropSeg(seg) {
    if (pendingRaf) pendingRaf.delete(seg);
    // drop は「この seg は終端（final を出せない orphan）」の意。finalized に登録し、
    // drop 後に同 seg の late-interim が来てもゾンビ行が復活しないようにする
    // （server 契約「drop 後に同 seg interim を送らない」に依存せず client 単独で保証）。
    rememberFinalized(seg);
    const row = segMap.get(seg);
    if (row) {
      if (row.parentNode === rowsEl) rowsEl.removeChild(row);
      interimTs.delete(row);
      segMap.delete(seg);
    }
  }

  // stale sweep: 確定が来ないまま staleMs 超過の interim 行を掃除。
  function sweepStale() {
    const t = now();
    for (const [sid, row] of [...segMap]) {
      if (finalized.has(sid)) continue;     // 確定済みは対象外
      const ts = interimTs.get(row);
      if (ts == null) continue;             // interim でない（final 行）
      if (t - ts >= staleMs) {
        if (row.parentNode === rowsEl) rowsEl.removeChild(row);
        interimTs.delete(row);
        segMap.delete(sid);
      }
    }
  }

  // 全リセット（stop 時 + ws 'open' 時）。再接続で seg0 が前接続行に衝突しないように。
  function clear() {
    while (rowsEl.firstChild) rowsEl.removeChild(rowsEl.firstChild);
    segMap.clear();
    finalized.clear();
    interimTs.clear();
    pendingRaf = null;
  }

  return { upsert, dropSeg, sweepStale, clear, flushRaf };
}

// WS URL。明示 ?lc=ws|wss が最優先。無ければページが https なら wss・http なら ws
// （本番https=自動wss／localhost=自動ws でmixed-content回避）。pure・単体テスト用に protocol を渡せる。
export function lcWsUrl(search, protocol) {
  const lc = new URLSearchParams(search || '').get('lc');
  const proto = protocol || (typeof location !== 'undefined' ? location.protocol : 'http:');
  const scheme = (lc === 'ws' || lc === 'wss') ? lc : (proto === 'https:' ? 'wss' : 'ws');
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

  // renderer 状態機械（seg_id upsert / final 置換 / watermark / trim / stale sweep）。
  // window.LC_RAF があれば interim coalesce をそれで駆動（e2e で手動フラッシュ可能）。
  const reducedMotion = typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = createCaptionRenderer({
    rowsEl, doc: document, maxRows: MAX_ROWS, staleMs: STALE_MS, reducedMotion,
    raf: (cb) => ((typeof window !== 'undefined' && window.LC_RAF)
      ? window.LC_RAF(cb)
      : (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(cb) : (cb(), 0))),
  });
  // 旧 API 互換: e2e（{type:caption, ja} を直接 fire）と main.js 連携のため renderCaption を残す。
  function renderCaption(ev) { renderer.upsert(ev); }
  function clearRows() { renderer.clear(); }

  // 確定が来ない interim 行を周期的に掃除（~4s）。stop で停止。
  let sweepTimer = null;
  function startSweep() {
    if (sweepTimer || typeof setInterval === 'undefined') return;
    sweepTimer = setInterval(() => renderer.sweepStale(), 2000);
  }
  function stopSweep() {
    if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  }

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
      ws.addEventListener('open', () => {
        // 再接続で seg0 が前接続の行に衝突しないよう state をリセット。
        delay = BASE_MS; renderer.clear(); setStatus('listening');
      });
      ws.addEventListener('message', (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.type === 'caption') renderer.upsert(m);
        else if (m.type === 'drop_seg') renderer.dropSeg(m.seg_id);
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
    clearRows(); startSweep(); setStatus('', 'このタブの音声を共有してください…');
    try {
      // preferCurrentTab=true: 既定では Chrome は呼び出し元タブ(=Orbis)を共有候補から除外する
      // (selfBrowserSurface 既定 'exclude')。Orbis のニュースは同タブ内の iframe で鳴るので
      // 現在のタブ自身を共有する必要があり、これで「このタブを共有」が直接提示される。
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true, preferCurrentTab: true });
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
    stopSweep(); clearRows(); setStatus('', '');
  }

  function setEnabled(on) {
    if (toggleEl) toggleEl.checked = !!on;
    if (on) start(); else stop();
  }

  if (toggleEl) toggleEl.addEventListener('change', () => (toggleEl.checked ? start() : stop()));

  return { setEnabled, isEnabled: () => enabled, connect, renderCaption, setStatus };
}
