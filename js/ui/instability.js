// 国家不安定性インデックス UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM セクション＋flyTo。
const LEVEL_RGB = { 1: [90, 200, 160], 2: [150, 210, 90], 3: [240, 200, 70], 4: [245, 150, 60], 5: [240, 80, 70] };

export function levelOf(score) {
  return score > 0 ? Math.min(5, 1 + Math.floor(score / 20)) : 1;
}
export function scoreColor(score) {
  const [r, g, b] = LEVEL_RGB[levelOf(score)];
  return `rgb(${r},${g},${b})`;
}
export function trendArrow(dir) {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '─';
}
export function fmtSignedPct(n) {
  return (n > 0 ? '+' : '') + n + '%';
}
export function rankTop(countries, n) {
  return (countries || []).slice(0, n);
}
function _moverScore(c) {
  if (!c.trend || c.trend.isNew) return -1e9;
  const norm = c.trend.normal ? c.trend.normal.deltaPct : null;
  const dod = c.trend.dod ? c.trend.dod.delta : null;
  return norm != null ? norm : (dod != null ? dod : -1e9);
}
function _isUptrend(c) {
  // 上昇判定：normal.dir='up' または dod.dir='up' のいずれかが 'up' なら true
  if (!c.trend) return false;
  const normUp = c.trend.normal && c.trend.normal.dir === 'up';
  const dodUp = c.trend.dod && c.trend.dod.dir === 'up';
  return normUp || dodUp;
}
export function topMovers(countries, n) {
  return (countries || [])
    .filter((c) => c.trend && !c.trend.isNew && _isUptrend(c) && _moverScore(c) > 0)
    .sort((a, b) => _moverScore(b) - _moverScore(a))
    .slice(0, n);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function _trendBadges(tr) {
  if (!tr || tr.isNew) return '<span class="ins-new">新規</span>';
  const parts = [];
  if (tr.dod) parts.push(`<span class="ins-tr ins-${esc(tr.dod.dir)}">${trendArrow(tr.dod.dir)}昨日比${tr.dod.delta > 0 ? '+' : ''}${tr.dod.delta}</span>`);
  if (tr.normal) parts.push(`<span class="ins-tr ins-${esc(tr.normal.dir)}">${trendArrow(tr.normal.dir)}平常比${fmtSignedPct(tr.normal.deltaPct)}</span>`);
  return parts.join(' ');
}
export function rowHtml(country) {
  const c = country || {};
  const ct = c.counts || { conflict: 0, protests: 0, news: 0, quakes: 0 };
  const col = scoreColor(c.score || 0);
  const narr = c.narrative_ja ? `<p class="ins-narr">${esc(c.narrative_ja)}</p>` : '';
  return (
    `<div class="ins-row" style="--lvl:${col}">`
    + `<span class="ins-rank">${esc(c.rank || '')}</span>`
    + `<span class="ins-name">${esc(c.name_ja || c.code || '')}</span>`
    + `<span class="ins-bar"><span class="ins-fill" style="width:${Math.max(0, Math.min(100, c.score || 0))}%"></span></span>`
    + `<span class="ins-score">${esc(c.score || 0)}</span>`
    + `<span class="ins-trend">${_trendBadges(c.trend)}</span>`
    + `<span class="ins-counts">⚔${esc(ct.conflict)} 📢${esc(ct.protests)} 📰${esc(ct.news)} 🌐${esc(ct.quakes)}</span>`
    + narr
    + '</div>'
  );
}
