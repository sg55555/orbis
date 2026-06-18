// ニュースペイン：局タブ＋単一大プレーヤー。可視時のみ再生。
// 字幕は IFrame Player API で日本語自動翻訳を要求（ベストエフォート・効かなければ英語ccにフォールバック）。
import { buildEmbedUrl, defaultItem, itemById } from './media.js';
import { loadYtApi, forceJaCaptions } from './yt-captions.js';

// paneEl=#media-news。onSelect(item) は局選択時（flyTo 等）。返り値 {select,current,setPlaying,setCaptions}。
export function renderNewsPane(paneEl, news, { onSelect } = {}) {
  const frame = paneEl.querySelector('#news-frame');
  const tabsEl = paneEl.querySelector('#news-tabs');
  const nowEl = paneEl.querySelector('.news-now');
  let curId = defaultItem(news) ? defaultItem(news).id : null;
  let visible = false;
  let captions = true; // 日本語字幕（既定ON・トグルで切替）
  let player = null;

  function highlight() {
    tabsEl.querySelectorAll('.news-tab').forEach((t) => t.classList.toggle('active', t.dataset.id === curId));
  }
  function setNow(it) { if (nowEl) nowEl.textContent = it ? `${it.name}｜${it.region}` : '—'; }

  // jsapi＋origin 付きの再生URL（API で字幕制御するため）。
  function srcFor(it) {
    let u = buildEmbedUrl(it, { captions, jsapi: true });
    if (typeof location !== 'undefined' && location.origin) u += `&origin=${encodeURIComponent(location.origin)}`;
    return u;
  }
  // 字幕ONなら日本語自動翻訳を要求（効かなくても無害）。
  function applyCaptions() { if (captions) forceJaCaptions(player); }
  // IFrame Player API を1度だけバインド。ready/再生時に日本語字幕を強制。失敗は cc にフォールバック。
  function ensurePlayer() {
    if (player) return;
    loadYtApi().then((YT) => {
      if (!YT || player || !frame) return;
      try {
        player = new YT.Player(frame, {
          events: {
            onReady: applyCaptions,
            onStateChange: (e) => { if (e && e.data === 1) applyCaptions(); }, // 1=PLAYING
          },
        });
      } catch { player = null; /* iframe 直 src の cc 字幕にフォールバック */ }
    });
  }
  function play() { const it = itemById(news, curId); if (visible && it) { frame.src = srcFor(it); ensurePlayer(); applyCaptions(); } }

  function select(id) {
    const it = itemById(news, id);
    if (!it) return;
    curId = id;
    highlight();
    setNow(it);
    if (visible) { frame.src = srcFor(it); ensurePlayer(); applyCaptions(); }
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
