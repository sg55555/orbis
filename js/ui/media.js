// メディア領域（下部・スクロール大画面）。ニュース/カメラのカテゴリタブ＋大プレーヤー＋セレクタ。
// 純粋ヘルパ（URL生成・選択ロジック）＋描画（renderMedia）。

// キー不要のライブ埋め込みURL。video_id 優先（固定ライブ動画）、無ければ channel_id（チャンネルlive）。
// autoplay はミュート必須・iOS向け playsinline。
export function buildEmbedUrl(item) {
  const base = item.video_id
    ? `https://www.youtube.com/embed/${item.video_id}`
    : `https://www.youtube.com/embed/live_stream?channel=${item.channel_id}`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}autoplay=1&mute=1&playsinline=1`;
}

export function defaultItem(items) {
  return (Array.isArray(items) && items.length) ? items[0] : null;
}

export function itemById(items, id) {
  return (Array.isArray(items) ? items : []).find((c) => c.id === id) || null;
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
