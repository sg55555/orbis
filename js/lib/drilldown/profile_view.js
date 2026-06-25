// 地域プロフィールの純 HTML ビルダ。DOM/fetch/map 非依存・全出力は escapeHtml 経由。
// model: { profile, breadcrumb, shapePath, miniDot, events }
// exports: formatFacts(facts) -> [{label,value,unit}]
//          profileHtml(model) -> string

import { escapeHtml } from '../selection.js';

// セクション用 SVG アイコン（content.js mockup から移植）
const ICONS = {
  '概要': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>',
  '気候': '<path d="M7 17a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5 3.5 3.5 0 0 1-.5 6.5z"/><line x1="9" y1="20" x2="8" y2="22"/><line x1="13" y1="20" x2="12" y2="22"/><line x1="17" y1="20" x2="16" y2="22"/>',
  '特産・名物': '<path d="M20 7h-3.2a2.5 2.5 0 1 0-4.8 0H12a2.5 2.5 0 1 0-4.8 0H4v4h1v8h14v-8h1z"/><line x1="12" y1="7" x2="12" y2="19"/>',
  '主要産業': '<path d="M3 20V9l5 3V9l5 3V6l8 4v10z"/><line x1="7" y1="16" x2="7" y2="17"/><line x1="12" y1="16" x2="12" y2="17"/><line x1="17" y1="16" x2="17" y2="17"/>',
  '交通・地理': '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 11 11 8.5 15.5 13 13"/>',
  '観光名所': '<path d="M4 9l8-5 8 5v11H4z"/><path d="M9 20v-5h6v5"/><circle cx="12" cy="10" r="1.2"/>',
};

// 種別ラベル: [英語コード, 日本語]
const KIND = {
  country: ['COUNTRY', '国'],
  admin1:  ['ADMIN1',  '県'],
  city:    ['CITY',    '都市'],
};

// セクションアイコン HTML を生成
function secIcon(title) {
  const inner = ICONS[title] || '';
  return '<span class="pf-sec-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg></span>';
}

/**
 * facts オブジェクトを整形済み配列に変換。null 値は除外。
 * @param {{ population, area_km2, lat, lon, elevation_m }} facts
 * @returns {{ label: string, value: string, unit: string }[]}
 */
export function formatFacts(facts) {
  const result = [];
  if (facts == null) return result;

  // 人口
  if (facts.population != null) {
    const v = facts.population;
    if (v >= 1e6) {
      result.push({
        label: '人口',
        value: (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + '',
        unit:  'M',
      });
    } else {
      result.push({
        label: '人口',
        value: v.toLocaleString(),
        unit:  '人',
      });
    }
  }

  // 面積
  if (facts.area_km2 != null) {
    result.push({
      label: '面積',
      value: facts.area_km2.toLocaleString(),
      unit:  'km²',
    });
  }

  // 位置（lat AND lon が必要）
  if (facts.lat != null && facts.lon != null) {
    result.push({
      label: '位置',
      value: facts.lat + '°N',
      unit:  facts.lon + '°E',
    });
  }

  // 標高
  if (facts.elevation_m != null) {
    result.push({
      label: '標高',
      value: String(facts.elevation_m),
      unit:  'm',
    });
  }

  return result;
}

/**
 * ミニグローブ SVG を生成。miniDot があれば座標を使用、なければ既定位置。
 * @param {{ lon: number, lat: number }|null} miniDot
 * @returns {string}
 */
function miniGlobe(miniDot) {
  // 球面上のドット位置を概算（viewBox 0 0 64 64、中心 32 32、半径 26）
  let cx = 43;
  let cy = 23;
  if (miniDot) {
    // lon -180..180 → 6..58 (左端6, 右端58)、lat 90..-90 → 6..58
    cx = Math.round(6 + ((miniDot.lon + 180) / 360) * 52);
    cy = Math.round(6 + ((90 - miniDot.lat) / 180) * 52);
    // 球内に収める（クリップは親要素 overflow:hidden が担当）
    cx = Math.max(8, Math.min(56, cx));
    cy = Math.max(8, Math.min(56, cy));
  }
  return '<svg viewBox="0 0 64 64" aria-hidden="true">'
    + '<circle class="pf-mini-rim" cx="32" cy="32" r="26"/>'
    + '<ellipse class="pf-mini-grat" cx="32" cy="32" rx="26" ry="9"/>'
    + '<ellipse class="pf-mini-grat" cx="32" cy="32" rx="14" ry="26"/>'
    + '<ellipse class="pf-mini-grat" cx="32" cy="32" rx="26" ry="20"/>'
    + '<line class="pf-mini-grat" x1="6" y1="32" x2="58" y2="32"/>'
    + '<circle class="pf-mini-glow" cx="' + cx + '" cy="' + cy + '" r="5.5"/>'
    + '<circle class="pf-mini-dot" cx="' + cx + '" cy="' + cy + '" r="2.4"/>'
    + '</svg>';
}

/**
 * 地域の形状シルエット SVG を生成。shapePath が null の場合は空文字。
 * @param {{ d: string, viewBox: string }|null} shapePath
 * @returns {string}
 */
function regionShape(shapePath) {
  if (!shapePath) return '';
  const vb = escapeHtml(shapePath.viewBox);
  const d  = escapeHtml(shapePath.d);
  return '<div class="pf-shape">'
    + '<svg viewBox="' + vb + '" aria-hidden="true"><path d="' + d + '"/></svg>'
    + '</div>';
}

/**
 * facts HUD の HTML を生成（dl.pf-facts）。
 * @param {{ label, value, unit }[]} items
 * @returns {string}
 */
function factsHud(items) {
  if (!items.length) return '';
  const cells = items.map(({ label, value, unit }) =>
    '<div class="pf-fact">'
    + '<dt>' + escapeHtml(label) + '</dt>'
    + '<dd>' + escapeHtml(value) + '<small>' + escapeHtml(unit) + '</small></dd>'
    + '</div>'
  ).join('');
  return '<dl class="pf-facts">' + cells + '</dl>';
}

/**
 * モデルからプロフィールパネルの HTML を生成（純関数）。
 * @param {{ profile, breadcrumb, shapePath, miniDot, events }} model
 * @returns {string}
 */
export function profileHtml(model) {
  const { profile, breadcrumb, shapePath, miniDot, events } = model;
  const { id, level, name_ja, facts, sections, source, degraded } = profile;

  const kindPair = KIND[level] || ['?', '?'];
  const kindEn   = escapeHtml(kindPair[0]);
  const kindJa   = escapeHtml(kindPair[1]);

  // ── パンくず ──
  const crumbItems = (breadcrumb || []).map((crumb, i) => {
    const isLast = i === breadcrumb.length - 1;
    const sep    = i > 0 ? '<span class="pf-sep">›</span>' : '';
    const btn    = isLast
      ? `<button class="pf-crumb-cur" data-level="${escapeHtml(crumb.level)}" data-id="${escapeHtml(crumb.id)}" aria-current="page">${escapeHtml(crumb.name_ja)}</button>`
      : `<button data-level="${escapeHtml(crumb.level)}" data-id="${escapeHtml(crumb.id)}">${escapeHtml(crumb.name_ja)}</button>`;
    return sep + btn;
  });
  const crumbHtml = '<nav class="pf-crumbs" aria-label="現在地">' + crumbItems.join('') + '</nav>';

  // ── ヒーロー ──
  const mediaHtml = '<div class="pf-media">'
    + '<div class="pf-media-label">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="5" width="18" height="14" rx="2"/>'
    + '<circle cx="9" cy="11" r="2"/>'
    + '<path d="M3 17l5-4 4 3 4-4 5 4"/>'
    + '</svg>'
    + '<span>画像スロット<br>（将来：Wikipediaサムネ）</span>'
    + '</div>'
    + '<div class="pf-mini" title="位置（ミニグローブ）">' + miniGlobe(miniDot) + '</div>'
    + '</div>';

  const shapeHtml = regionShape(shapePath);
  const factsItems = formatFacts(facts);

  const idHtml = '<div class="pf-id">'
    + '<span class="pf-kind">' + kindEn + '<span class="pf-kind-ja">' + kindJa + '</span></span>'
    + '<div class="pf-name-row">'
    + '<h1 class="pf-name">' + escapeHtml(name_ja) + '</h1>'
    + shapeHtml
    + '</div>'
    + factsHud(factsItems)
    + '</div>';

  const heroHtml = '<header class="pf-hero">' + mediaHtml + idHtml + '</header>';

  // ── degraded バナー ──
  const degradedHtml = degraded
    ? '<div class="pf-degraded">データが限定的です。情報が不完全な可能性があります。</div>'
    : '';

  // ── セクション（degraded 時は省略） ──
  let sectionsHtml = '';
  if (!degraded && sections && sections.length > 0) {
    const secItems = sections.map(({ title, body }) =>
      '<section class="pf-sec">'
      + '<h2 class="pf-sec-h">' + secIcon(title) + escapeHtml(title) + '</h2>'
      + '<p>' + escapeHtml(body) + '</p>'
      + '</section>'
    ).join('');
    sectionsHtml = '<div class="pf-sections">' + secItems + '</div>';
  }

  // ── イベント（events.length > 0 の時のみ） ──
  let eventsHtml = '';
  if (events && events.length > 0) {
    const evItems = events.map(({ emoji, where, title }) =>
      '<div class="pf-ev">'
      + '<span class="pf-ev-emoji">' + escapeHtml(emoji) + '</span>'
      + '<span>' + (where ? '<span class="pf-ev-where">' + escapeHtml(where) + ' — </span>' : '') + escapeHtml(title) + '</span>'
      + '</div>'
    ).join('');
    eventsHtml = '<details class="pf-events">'
      + '<summary>近隣の最近の動向<span class="pf-ev-count">' + events.length + '</span></summary>'
      + '<div class="pf-ev-list">' + evItems + '</div>'
      + '</details>';
  }

  // ── 出典フッタ ──
  const sourceHtml = source
    ? '<footer class="pf-source">'
      + '<a href="' + escapeHtml(source.wikipedia_url || '#') + '" target="_blank" rel="noopener">Wikipedia (ja) ↗</a>'
      + (source.qid ? '<span class="pf-qid">QID ' + escapeHtml(source.qid) + '</span>' : '')
      + '</footer>'
    : '';

  return '<article class="profile" data-level="' + escapeHtml(level) + '">'
    + crumbHtml
    + heroHtml
    + degradedHtml
    + sectionsHtml
    + eventsHtml
    + sourceHtml
    + '</article>';
}
