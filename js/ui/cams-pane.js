// カメラペイン：地域タブ × 分割モード(1/4/6) × サムネグリッド ＋ 選択1枚だけ再生。
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
  const nowEl = paneEl.querySelector('.cams-now');
  let area = 'all';
  let mode = 4;
  let curId = null;
  let visible = false;

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
  // 選択セルだけ iframe 再生・他はサムネ。可視時のみ再生。
  function playCells() {
    const it = itemById(cams, curId);
    gridEl.querySelectorAll('.cam-cell').forEach((c) => {
      const f = c.querySelector('iframe');
      const img = c.querySelector('img');
      const isCur = c.dataset.id === curId;
      if (isCur && visible && it) {
        if (img) img.style.display = 'none';
        if (f) f.src = buildEmbedUrl(it);
      } else {
        if (f) f.src = '';
        if (img) img.style.display = '';
      }
    });
  }
  function renderGrid() {
    const cols = mode === 6 ? 3 : mode === 4 ? 2 : 1;
    gridEl.className = `cams-grid cols-${cols}`;
    gridEl.innerHTML = '';
    for (const it of gridSlots(list(), gridCount(mode))) {
      const cell = document.createElement('div');
      cell.className = 'cam-cell';
      if (!it) {
        cell.classList.add('empty');
        cell.innerHTML = '<span class="cam-label">—</span>';
        gridEl.appendChild(cell);
        continue;
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
      cell.addEventListener('click', () => selectCam(it.id));
      gridEl.appendChild(cell);
    }
    highlightCells();
    playCells();
  }

  function selectCam(id) {
    const it = itemById(cams, id);
    if (!it) return;
    curId = id;
    setNow(it);
    highlightCells();
    playCells();
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
    // 選択カメラが新枠内に残らなければ先頭に。
    const slots = gridSlots(list(), gridCount(mode));
    if (!slots.some((s) => s && s.id === curId)) {
      const first = list()[0];
      curId = first ? first.id : null;
    }
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
  };
}
