// Orbis ライブ字幕オーバーレイ（live-translate B フェーズ）。
// getDisplayMedia のタブ音声 → 16k PCM → WS(ローカル live-translate) → caption{ja} を
// ニュースプレーヤー下端の pointer-events:none オーバーレイに描画する。
// Core(VAD/STT/翻訳)は live-translate サーバ側。e2e は window.LC_WS_FACTORY /
// window.LC_RECONNECT_BASE_MS で mock 注入・バックオフ短縮できる。

const MAX_ROWS = 2;

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
    clearRows(); setStatus('', 'このタブの音声を共有してください…');
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
    clearRows(); setStatus('', '');
  }

  function setEnabled(on) {
    if (toggleEl) toggleEl.checked = !!on;
    if (on) start(); else stop();
  }

  if (toggleEl) toggleEl.addEventListener('change', () => (toggleEl.checked ? start() : stop()));

  return { setEnabled, isEnabled: () => enabled, connect, renderCaption, setStatus };
}
