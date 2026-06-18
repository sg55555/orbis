// メディア領域。左=ニュース(news-pane)／右=地域カメラ(cams-pane)。本ファイルは純粋ヘルパ＋renderMediaオーケストレーション。

import { renderNewsPane } from './news-pane.js';
import { renderCamsPane } from './cams-pane.js';

// 地域コード（定義順）。areasPresent はこの順で実在分のみ返す。
export const AREA_ORDER = ['middle_east', 'europe', 'americas', 'asia', 'africa', 'oceania', 'space'];
export const AREA_LABEL = {
  all: 'すべて', middle_east: '中東', europe: 'ヨーロッパ', americas: 'アメリカ',
  asia: 'アジア', africa: 'アフリカ', oceania: 'オセアニア', space: '宇宙',
};

// キー不要のライブ埋め込みURL。video_id 優先（固定ライブ動画）、無ければ channel_id（チャンネルlive）。
// captions=true（既定）で日本語字幕＋日本語UIを要求（cc_load_policy/cc_lang_pref/hl）。
// 注: cc_lang_pref=ja は「日本語字幕トラックがあれば表示」までで、外国語音声の自動翻訳は強制できない（ベストエフォート）。
export function buildEmbedUrl(item, { captions = true, jsapi = false } = {}) {
  const base = item.video_id
    ? `https://www.youtube.com/embed/${item.video_id}`
    : `https://www.youtube.com/embed/live_stream?channel=${item.channel_id}`;
  const sep = base.includes('?') ? '&' : '?';
  const cc = captions ? '&cc_load_policy=1&cc_lang_pref=ja&hl=ja' : '';
  const api = jsapi ? '&enablejsapi=1' : ''; // IFrame Player API で字幕を制御するため
  return `${base}${sep}autoplay=1&mute=1&playsinline=1${cc}${api}`;
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

// 2ペインをマウントし可視制御を伝播。lists={news,cameras}。onSelect(item) は両ペイン共通（flyTo 等）。
// 返り値 {news,cams,setPlaying}。
export function renderMedia(rootEl, { news = [], cameras = [] } = {}, { onSelect } = {}) {
  const newsEl = rootEl.querySelector('#media-news');
  const camsEl = rootEl.querySelector('#media-cams');
  let newsApi = null;
  let camsApi = null;

  if (Array.isArray(news) && news.length && newsEl) newsApi = renderNewsPane(newsEl, news, { onSelect });
  else if (newsEl) newsEl.style.display = 'none';

  if (Array.isArray(cameras) && cameras.length && camsEl) camsApi = renderCamsPane(camsEl, cameras, { onSelect });
  else if (camsEl) camsEl.style.display = 'none';

  // 日本語字幕トグル（既定ON・両ペイン共通）。チェック変更で両ペインの src を作り直す。
  function setCaptions(on) {
    if (newsApi) newsApi.setCaptions(on);
    if (camsApi) camsApi.setCaptions(on);
  }
  const ccToggle = rootEl.querySelector('#media-cc-toggle');
  if (ccToggle) ccToggle.addEventListener('change', () => setCaptions(ccToggle.checked));

  return {
    news: newsApi,
    cams: camsApi,
    setCaptions,
    setPlaying(on) {
      if (newsApi) newsApi.setPlaying(on);
      if (camsApi) camsApi.setPlaying(on);
    },
  };
}
