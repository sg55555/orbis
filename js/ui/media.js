// メディア領域。左=ニュース(news-pane)／右=地域カメラ(cams-pane)。本ファイルは純粋ヘルパ＋renderMediaオーケストレーション。

// 地域コード（定義順）。areasPresent はこの順で実在分のみ返す。
export const AREA_ORDER = ['middle_east', 'europe', 'americas', 'asia', 'africa', 'oceania', 'space'];
export const AREA_LABEL = {
  all: 'すべて', middle_east: '中東', europe: 'ヨーロッパ', americas: 'アメリカ',
  asia: 'アジア', africa: 'アフリカ', oceania: 'オセアニア', space: '宇宙',
};

// キー不要のライブ埋め込みURL。video_id 優先（固定ライブ動画）、無ければ channel_id（チャンネルlive）。
export function buildEmbedUrl(item) {
  const base = item.video_id
    ? `https://www.youtube.com/embed/${item.video_id}`
    : `https://www.youtube.com/embed/live_stream?channel=${item.channel_id}`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}autoplay=1&mute=1&playsinline=1`;
}

// キー不要のサムネ静止画。video_id 無しは空（プレースホルダにフォールバック）。
export function thumbUrl(item) {
  return item.video_id ? `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg` : '';
}

export function defaultItem(items) {
  return (Array.isArray(items) && items.length) ? items[0] : null;
}

export function itemById(items, id) {
  return (Array.isArray(items) ? items : []).find((c) => c.id === id) || null;
}

// cams に実在する area を AREA_ORDER 順で返し、先頭に 'all'。空 area は含めない。
export function areasPresent(cams) {
  const present = new Set((Array.isArray(cams) ? cams : []).map((c) => c.area).filter(Boolean));
  return ['all', ...AREA_ORDER.filter((a) => present.has(a))];
}

// area='all' なら全件、else area 一致でフィルタ。
export function camsByArea(cams, area) {
  const arr = Array.isArray(cams) ? cams : [];
  return area === 'all' ? arr.slice() : arr.filter((c) => c.area === area);
}

// 分割モードの枠数。1/4/6 はそのまま、不正は 4。
export function gridCount(mode) {
  return [1, 4, 6].includes(Number(mode)) ? Number(mode) : 4;
}

// 先頭 count 枚＋不足は null パディングしたグリッド枠配列。
export function gridSlots(cams, count) {
  const arr = (Array.isArray(cams) ? cams : []).slice(0, count);
  while (arr.length < count) arr.push(null);
  return arr;
}

// メディア領域を描画。lists = { news:[], cameras:[] }。onSelect(item) は項目選択時（flyTo 等）。
// 返り値 API: select(id) / selectCategory(cat) / setPlaying(on) / current()。
export function renderMedia(rootEl, lists, { onSelect } = {}) {
  const frame = rootEl.querySelector('#media-frame');
  const selEl = rootEl.querySelector('#media-selector');
  const nowEl = rootEl.querySelector('.media-now');
  const catBtns = Array.from(rootEl.querySelectorAll('.media-cat'));
  let cat = 'news';
  let curId = defaultItem(lists[cat]) ? defaultItem(lists[cat]).id : null;
  let visible = false;

  const items = () => lists[cat] || [];

  function highlight() {
    selEl.querySelectorAll('.media-item').forEach((t) => t.classList.toggle('active', t.dataset.id === curId));
    catBtns.forEach((c) => c.classList.toggle('active', c.dataset.cat === cat));
  }
  function setNow(it) { if (nowEl && it) nowEl.textContent = `${it.name}｜${it.region}`; }
  function play() { const it = itemById(items(), curId); if (visible && it) frame.src = buildEmbedUrl(it); }

  function renderSelector() {
    selEl.innerHTML = '';
    for (const it of items()) {
      const b = document.createElement('button');
      b.className = 'media-item';
      b.dataset.id = it.id;
      b.textContent = it.name;
      b.addEventListener('click', () => select(it.id));
      selEl.appendChild(b);
    }
    highlight();
  }

  function select(id) {
    const it = itemById(items(), id);
    if (!it) return;
    curId = id;
    highlight();
    setNow(it);
    if (visible) frame.src = buildEmbedUrl(it);
    if (onSelect) onSelect(it);
  }

  function selectCategory(c) {
    if (!lists[c]) return; // 未知/欠落カテゴリは無視
    cat = c;
    curId = defaultItem(items()) ? defaultItem(items()).id : null;
    renderSelector();
    setNow(itemById(items(), curId));
    play(); // カテゴリ切替時、可視なら新カテゴリ先頭を再生（flyTo はしない）
  }

  catBtns.forEach((b) => b.addEventListener('click', () => selectCategory(b.dataset.cat)));
  renderSelector();
  setNow(itemById(items(), curId));

  return {
    select,
    selectCategory,
    current: () => ({ cat, id: curId }),
    // 可視/不可視に応じて再生制御（IntersectionObserver から呼ぶ）。
    setPlaying(on) {
      visible = on;
      if (on) play();
      else frame.src = '';
    },
  };
}
