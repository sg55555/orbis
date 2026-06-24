// 国ドリルダウンの純 HTML ビルダ。DOM/fetch/map 非依存・全出力は escapeHtml 経由。
// ヘッダは instability の純ヘルパ（levelOf/scoreColor/trendArrow/rowHtml）を流用する。
import { escapeHtml } from '../selection.js';
import { levelOf, scoreColor, trendArrow, rowHtml } from '../../ui/instability.js';

// レイヤー絵文字（instability rowHtml の ⚔📢📰🌐 並びに厳密一致）。
const LAYER_EMOJI = { conflict: '⚔', protests: '📢', news: '📰', quakes: '🌐' };

// degraded バナーの説明文。kind=理由種別。未知 kind は汎用文にフォールバック。
const DEGRADED_TEXT = {
  extra: '小国・領土のため県別集計はありません。',
  ocean: '海洋上のため国を特定できませんでした。',
  missing: 'この国の県・都市データは未整備です。',
  fetcherror: 'データの取得に失敗しました。再試行してください。',
};
export function degradedNoticeHtml(kind) {
  const text = DEGRADED_TEXT[kind] || 'この国の詳細は表示できません。';
  return `<div class="dd-degraded">${escapeHtml(text)}</div>`;
}

// 個別イベント行。ev={regionName, cityName, layerId, title}。
// 都市名あり→「県名 — 都市名でタイトル」、なし→「県名 — タイトル」。
export function eventLineHtml(ev) {
  const o = ev || {};
  const emoji = LAYER_EMOJI[o.layerId] || '・';
  const region = escapeHtml(o.regionName || '');
  const title = escapeHtml(o.title || '');
  const where = o.cityName
    ? `${escapeHtml(o.cityName)}で${title}`
    : title;
  return `<div class="dd-event"><span class="dd-ev-emoji">${emoji}</span>`
    + `<span class="dd-ev-text">${region} — ${where}</span></div>`;
}

// byLayer 内訳を「⚔n 📢n 📰n 🌐n」の固定並びで描く（欠落は 0）。
function _byLayerHtml(byLayer) {
  const b = byLayer || {};
  return `<span class="dd-rg-counts">`
    + `⚔${escapeHtml(b.conflict || 0)} 📢${escapeHtml(b.protests || 0)} `
    + `📰${escapeHtml(b.news || 0)} 🌐${escapeHtml(b.quakes || 0)}</span>`;
}

// 県/州ランキングの1行。region={name_ja, count, byLayer, topEvents, ...}。
// 代表イベントは topEvents[0] を「都市でタイトル」形式（都市なしはタイトルのみ）で1件添える。
export function regionRowHtml(region) {
  const r = region || {};
  const name = escapeHtml(r.name_ja || (r.a1code || ''));
  const count = escapeHtml(r.count || 0);
  const top = (Array.isArray(r.topEvents) && r.topEvents[0]) ? r.topEvents[0] : null;
  let rep = '';
  if (top) {
    const t = escapeHtml(top.title || '');
    rep = top.cityName
      ? `<span class="dd-rg-rep">${escapeHtml(top.cityName)}で${t}</span>`
      : `<span class="dd-rg-rep">${t}</span>`;
  }
  return `<div class="dd-region">`
    + `<span class="dd-rg-name">${name}</span>`
    + `<span class="dd-rg-total">${count}件</span>`
    + _byLayerHtml(r.byLayer)
    + rep
    + `</div>`;
}

// forecast 注視度セクション（forecastCards 由来）。watch=注視度ラベル, label=補足文。
function _forecastHtml(forecast) {
  if (!forecast || !forecast.watch) return '';
  const watch = escapeHtml(forecast.watch);
  const label = forecast.label ? `<span class="dd-fc-label">${escapeHtml(forecast.label)}</span>` : '';
  return `<div class="dd-forecast"><span class="dd-fc-tag">注視度 ${watch}</span>${label}</div>`;
}

// ドリルダウン・ヘッダ。header=instability の国オブジェクト流用＋forecast 注視度。
// 本体は instability rowHtml を流用（スコアバー/level 色/trend/内訳/narrative を再現）。
export function drilldownHeaderHtml(header) {
  const h = header || {};
  // score 由来の level 色を data 属性に添える（render 側の枠色付けフック・import 整合）。
  const lvl = levelOf(h.score || 0);
  const col = scoreColor(h.score || 0);
  const arrow = h.trend ? trendArrow((h.trend.normal && h.trend.normal.dir) || (h.trend.dod && h.trend.dod.dir)) : '';
  const body = rowHtml(h);
  return `<div class="dd-header" data-lvl="${escapeHtml(lvl)}" data-arrow="${escapeHtml(arrow)}" style="--dd-lvl:${col}">`
    + body
    + _forecastHtml(h.forecast)
    + `</div>`;
}
