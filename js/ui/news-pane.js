// ニュースペイン：局タブ＋単一大プレーヤー。可視時のみ再生。
import { buildEmbedUrl, defaultItem, itemById } from './media.js';

// paneEl=#media-news。onSelect(item) は局選択時（flyTo 等）。返り値 {select,current,setPlaying}。
export function renderNewsPane(paneEl, news, { onSelect } = {}) {
  const frame = paneEl.querySelector('#news-frame');
  const tabsEl = paneEl.querySelector('#news-tabs');
  const nowEl = paneEl.querySelector('.news-now');
  let curId = defaultItem(news) ? defaultItem(news).id : null;
  let visible = false;

  function highlight() {
    tabsEl.querySelectorAll('.news-tab').forEach((t) => t.classList.toggle('active', t.dataset.id === curId));
  }
  function setNow(it) { if (nowEl) nowEl.textContent = it ? `${it.name}｜${it.region}` : '—'; }
  function play() { const it = itemById(news, curId); if (visible && it) frame.src = buildEmbedUrl(it); }

  function select(id) {
    const it = itemById(news, id);
    if (!it) return;
    curId = id;
    highlight();
    setNow(it);
    if (visible) frame.src = buildEmbedUrl(it);
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
  };
}
