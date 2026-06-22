// データソース & 鮮度パネル（ページ最下部の全幅フッターセクション）。
// 各 snapshot の updated（鮮度）＋ counts（件数）＋ 層→出典の静的マップを一覧化。
// 既存の #freshness ピル（at-a-glance）は残し、本パネルは層別の詳細版。

// 層ID → 出典（表示名＋上流URL）。AI合成系は派生なので url 無し。
export const SOURCE_MAP = {
  quakes: { source: 'USGS', url: 'https://earthquake.usgs.gov' },
  flights: { source: 'OpenSky Network', url: 'https://opensky-network.org' },
  conflict: { source: 'GDELT Project', url: 'https://www.gdeltproject.org' },
  protests: { source: 'GDELT Project', url: 'https://www.gdeltproject.org' },
  ships: { source: 'AISStream', url: 'https://aisstream.io' },
  news: { source: '厳選RSS → AI日本語訳', url: '' },
  sst: { source: 'Open-Meteo Marine', url: 'https://open-meteo.com' },
  airtemp: { source: 'Open-Meteo', url: 'https://open-meteo.com' },
  currents: { source: '静的データ（編集）', url: '' },
  trade: { source: '静的データ（編集）', url: '' },
  // 下フォールドの AI セクション（registry 外・main.js が合成エントリで渡す）。
  briefing: { source: 'AI合成（Claude）', url: '' },
  instability: { source: 'AI合成（Claude）＋決定論スコア', url: '' },
  forecast: { source: 'AI合成（Claude）＋決定論スコア', url: '' },
};

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// updated(ISO) → now(ms) からの相対時刻。無効/欠落は '—'。
export function relTime(updated, now) {
  const t = Date.parse(updated);
  if (!Number.isFinite(t)) return '—';
  const diff = now - t;
  if (diff < 0) return '今';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '今';
  if (m < 60) return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}時間前`;
  return `${Math.floor(h / 24)}日前`;
}

// 層配列 → 出典/鮮度行。layers=[{id,label}], snapshots[id].updated, counts[id], sourceMap[id].
// now=基準時刻(ms), opts.staleMs=これ以上古いと stale（既定6時間）。
export function buildSourceRows(layers, snapshots, counts, sourceMap, now, opts = {}) {
  const { staleMs = 6 * 3600 * 1000 } = opts;
  const snaps = snapshots || {};
  const cnts = counts || {};
  const sm = sourceMap || {};
  return (layers || []).map((l) => {
    const snap = snaps[l.id] || {};
    // 大半の snapshot は `updated`、forecast 等は `generated_at` を使うためフォールバック。
    const updated = snap.updated || snap.generated_at || '';
    const t = Date.parse(updated);
    const stale = Number.isFinite(t) ? (now - t) > staleMs : false;
    const src = sm[l.id] || {};
    return {
      id: l.id,
      label: l.label || l.id,
      updated,
      rel: relTime(updated, now),
      count: Number(cnts[l.id]) || 0,
      source: src.source || '',
      url: src.url || '',
      stale,
    };
  });
}

// 1行の HTML（escape 済み・URL は http/https のみリンク化）。
export function sourceRowHtml(row) {
  const r = row || {};
  const safe = /^https?:\/\//i.test(r.url || '');
  const srcHtml = safe
    ? `<a class="src-link" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.source)} ↗</a>`
    : `<span class="src-src">${esc(r.source)}</span>`;
  return `<div class="src-row${r.stale ? ' src-stale' : ''}">`
    + `<span class="src-name">${esc(r.label)}</span>`
    + `<span class="src-rel">${esc(r.rel)}</span>`
    + `<span class="src-count">${esc(r.count)}</span>`
    + srcHtml
    + '</div>';
}

// rootEl=#sources の中身を描画。rows=buildSourceRows の戻り。
export function renderSources(rootEl, rows) {
  if (!rootEl) return;
  const list = rootEl.querySelector('.src-list') || rootEl;
  list.innerHTML = (rows || []).map(sourceRowHtml).join('');
}
