// カメラペイン：地域タブ × 分割モード(1/4/6) × グリッド全枠を同時再生（選択は強調＋flyTo）。
// 1画面(mode1)は選択カメラを1枚表示＋カメラ名ピル行で切替。4/6分割の各セルに⛶で1画面化。
import {
  buildEmbedUrl, thumbUrl, itemById,
  areasPresent, camsByArea, gridCount, gridSlots, AREA_LABEL,
} from './media.js';

// paneEl=#media-cams。onSelect(item) はカメラ選択時（flyTo 等。space は呼び出し側で除外）。
// 返り値 {selectArea,setMode,selectCam,current,setPlaying}。
export function renderCamsPane(paneEl, cams, { onSelect } = {}) {
  const tabsEl = paneEl.querySelector('#area-tabs');
  const modeEl = paneEl.querySelector('#mode-btns');
  const gridEl = paneEl.querySelector('#cams-grid');
  const oneEl = paneEl.querySelector('#cams-one-tabs');
  const nowEl = paneEl.querySelector('.cams-now');
  let area = 'all';
  let mode = 4;
  let curId = null;
  let visible = false;
  let captions = true; // 日本語字幕（既定ON・トグルで切替）

  const list = () => camsByArea(cams, area);

  function setNow(it) { if (nowEl) nowEl.textContent = it ? `${it.name}｜${it.region}` : '—'; }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const a of areasPresent(cams)) {
      const b = document.createElement('button');
      b.className = 'area-tab';
      b.dataset.area = a;
      b.textContent = AREA_LABEL[a] || a;
      b.classList.toggle('active', a === area);
      b.addEventListener('click', () => selectArea(a));
      tabsEl.appendChild(b);
    }
  }
  function highlightMode() {
    modeEl.querySelectorAll('.mode-btn').forEach((m) => m.classList.toggle('active', Number(m.dataset.mode) === mode));
  }
  function highlightCells() {
    gridEl.querySelectorAll('.cam-cell').forEach((c) => c.classList.toggle('active', c.dataset.id === curId));
  }
  // グリッドの全枠を同時再生（可視時のみ）。選択(curId)は強調のみで、再生対象は全セル。
  function playCells() {
    gridEl.querySelectorAll('.cam-cell').forEach((c) => {
      if (c.classList.contains('empty')) return;
      const f = c.querySelector('iframe');
      const img = c.querySelector('img');
      const it = itemById(cams, c.dataset.id);
      if (visible && it) {
        if (img) img.style.display = 'none';
        // 既に同URLなら再設定しない（再読込回避）。判定は IDL f.src でなく getAttribute を使う：
        // f.src='' は空文字をページURLに解決して truthy を返すため、!f.src だと再生開始を取りこぼす。
        const url = buildEmbedUrl(it, { captions });
        if (f && f.getAttribute('src') !== url) f.src = url;
      } else {
        if (f && f.getAttribute('src')) f.src = '';
        if (img) img.style.display = '';
      }
    });
  }
  // 1セルを生成。it=null は空枠。分割表示(mode!=1)のときだけ右上に⛶（1画面化）を付ける。
  function buildCell(it) {
    const cell = document.createElement('div');
    cell.className = 'cam-cell';
    if (!it) {
      cell.classList.add('empty');
      cell.innerHTML = '<span class="cam-label">—</span>';
      return cell;
    }
    cell.dataset.id = it.id;
    const t = thumbUrl(it);
    const img = document.createElement('img');
    if (t) { img.src = t; img.alt = ''; cell.appendChild(img); }
    const f = document.createElement('iframe');
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
    f.setAttribute('allowfullscreen', '');
    cell.appendChild(f);
    const label = document.createElement('span');
    label.className = 'cam-label';
    label.textContent = it.name;
    cell.appendChild(label);
    // 透明クリック層（iframe の上）。全枠再生中も iframe がクリックを奪わず選択＋flyTo を発火させる。
    const hit = document.createElement('div');
    hit.className = 'cam-hit';
    hit.addEventListener('click', () => selectCam(it.id));
    cell.appendChild(hit);
    // 分割表示のときだけ⛶（このカメラをセクション内1画面に）。
    if (mode !== 1) {
      const exp = document.createElement('button');
      exp.className = 'cam-expand';
      exp.title = '1画面表示';
      exp.textContent = '⛶';
      exp.addEventListener('click', (e) => { e.stopPropagation(); selectCam(it.id); setMode(1); });
      cell.appendChild(exp);
    }
    return cell;
  }
  // 1画面モードのカメラ名ピル行（表示カメラ切替）。mode!=1 では非表示。
  function renderOneTabs() {
    if (!oneEl) return;
    if (mode !== 1) { oneEl.style.display = 'none'; oneEl.innerHTML = ''; return; }
    oneEl.style.display = '';
    oneEl.innerHTML = '';
    for (const it of list()) {
      const p = document.createElement('button');
      p.className = 'cam-one-tab';
      p.dataset.id = it.id;
      p.textContent = it.name;
      p.classList.toggle('active', it.id === curId);
      p.addEventListener('click', () => selectCam(it.id));
      oneEl.appendChild(p);
    }
  }
  function renderGrid() {
    if (mode === 1) {
      // 1画面：選択カメラ(curId)を1枚。無ければ先頭。
      const cur = itemById(cams, curId) || list()[0] || null;
      curId = cur ? cur.id : null;
      gridEl.className = 'cams-grid cols-1';
      gridEl.innerHTML = '';
      if (cur) gridEl.appendChild(buildCell(cur));
    } else {
      const cols = mode === 6 ? 3 : 2;
      gridEl.className = `cams-grid cols-${cols}`;
      gridEl.innerHTML = '';
      for (const it of gridSlots(list(), gridCount(mode))) gridEl.appendChild(buildCell(it));
    }
    renderOneTabs();
    highlightCells();
    playCells();
  }

  function selectCam(id) {
    const it = itemById(cams, id);
    if (!it) return;
    curId = id;
    setNow(it);
    if (mode === 1) renderGrid(); // 1画面は表示カメラを差し替え（ピルの active も更新）
    else { highlightCells(); playCells(); }
    if (onSelect) onSelect(it);
  }
  function selectArea(a) {
    area = a;
    renderTabs();
    const first = list()[0];
    curId = first ? first.id : null;
    renderGrid();
    setNow(itemById(cams, curId));
    if (curId && onSelect) onSelect(itemById(cams, curId));
  }
  function setMode(n) {
    mode = gridCount(n);
    highlightMode();
    // 選択カメラは保持（現リストに無ければ先頭）。1画面化時は curId をそのまま大写し。
    if (!itemById(list(), curId)) { const first = list()[0]; curId = first ? first.id : null; }
    renderGrid();
    setNow(itemById(cams, curId));
  }

  modeEl.querySelectorAll('.mode-btn').forEach((m) => m.addEventListener('click', () => setMode(Number(m.dataset.mode))));

  // 初期化（onSelect は呼ばない＝ロード時 flyTo を避ける）。
  curId = list()[0] ? list()[0].id : null;
  renderTabs();
  highlightMode();
  renderGrid();
  setNow(itemById(cams, curId));

  return {
    selectArea,
    setMode,
    selectCam,
    current: () => ({ area, mode, id: curId }),
    setPlaying(on) { visible = on; playCells(); },
    // 字幕ON/OFF切替。全 iframe を一度クリアして字幕パラメータ込みで再生し直す。
    setCaptions(on) {
      captions = !!on;
      gridEl.querySelectorAll('iframe').forEach((f) => { f.src = ''; });
      playCells();
    },
  };
}
