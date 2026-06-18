// ニュースペイン：局タブ＋単一大プレーヤー。可視時のみ再生。
import { buildEmbedUrl, defaultItem, itemById } from './media.js';

// paneEl=#media-news。onSelect(item) は局選択時（flyTo 等）。返り値 {select,current,setPlaying}。
export function renderNewsPane(paneEl, news, { onSelect } = {}) {
  const frame = paneEl.querySelector('#news-frame');
  const tabsEl = paneEl.querySelector('#news-tabs');
  const nowEl = paneEl.querySelector('.news-now');
  let curId = defaultItem(news) ? defaultItem(news).id : null;
  let visible = false;
  let captions = true; // 日本語字幕（既定ON・トグルで切替）

  function highlight() {
    tabsEl.querySelectorAll('.news-tab').forEach((t) => t.classList.toggle('active', t.dataset.id === curId));
  }
  function setNow(it) { if (nowEl) nowEl.textContent = it ? `${it.name}｜${it.region}` : '—'; }
  function play() { const it = itemById(news, curId); if (visible && it) frame.src = buildEmbedUrl(it, { captions }); }

  function select(id) {
    const it = itemById(news, id);
    if (!it) return;
    curId = id;
    highlight();
    setNow(it);
    if (visible) frame.src = buildEmbedUrl(it, { captions });
    if (onSelect) onSelect(it);
  }

  tabsEl.innerHTML = '';
  for (const it of news) {
    const b = document.createElement('button');
    b.className = 'news-tab';
    b.dataset.id = it.id;
    b.textContent = it.name;
    b.addEventListener('click', () => select(it.id));
    tabsEl.appendChild(b);
  }
  highlight();
  setNow(itemById(news, curId));

  return {
    select,
    current: () => curId,
    setPlaying(on) { visible = on; if (on) play(); else frame.src = ''; },
    // 字幕ON/OFF切替。可視中なら src を作り直して即反映（iframe は再読込が必要）。
    setCaptions(on) { captions = !!on; if (visible) play(); },
  };
}
