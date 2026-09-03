// 異常スパイク・アラート帯（globe 直下の全幅バンド）。新規収集はせず、既存の
// instability（平常比 normal.deltaPct）と forecast（attention_score＋trend）から
// 「平常比で今日突出した国/ドメイン」を抽出して横並びチップで表示。クリック→flyTo。
import { DOMAIN_LABEL } from './forecast.js';
import { relTime } from './sources.js';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// instability/forecast から異常アラートを抽出する純関数。
// instability: 平常比(normal.deltaPct)が insMinDeltaPct 以上で上昇中・かつ score>=insMinScore の国
//   （同一 code は最大値のみ。score ゲートは「小母数で平常比が極端に振れるだけ」のノイズを抑制）。
// forecast: attention_score が fcMinScore 以上・trend 'up'・status!='watch' のカード。
// 重大度は異種を比較できるよう正規化：instability=min(100, deltaPct/3) / forecast=attention_score。
// 正規化重大度の降順で統合し limit 件（両種が混在する）。
export function selectAlerts(instability, forecast, opts = {}) {
  const { limit = 6, insMinDeltaPct = 15, insMinScore = 12, fcMinScore = 60 } = opts;
  // アラートは「いつのスナップショットの話か」を持って回る（AI 3 層は停止中で最大 11 日古い）。
  const insUpdated = (instability && instability.updated) || '';
  const fcUpdated = (forecast && forecast.generated_at) || '';
  const out = [];

  const insAlerts = [];
  for (const c of (instability && instability.countries) || []) {
    const t = c.trend;
    if (!t || t.isNew || !t.normal || t.normal.dir !== 'up') continue;
    const d = Number(t.normal.deltaPct);
    if (!(d >= insMinDeltaPct)) continue;
    if (!(Number(c.score) >= insMinScore)) continue;
    insAlerts.push({
      kind: 'instability', label: c.name_ja || c.code || '', detail: `平常比 +${d}%`,
      severity: Math.min(100, d / 3), lon: c.lon, lat: c.lat, code: c.code, when: insUpdated,
    });
  }
  insAlerts.sort((a, b) => b.severity - a.severity);
  const seen = new Set();
  for (const a of insAlerts) {
    const key = `i:${a.code != null ? a.code : a.label}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(a);
  }

  const fcAlerts = [];
  for (const c of (forecast && forecast.cards) || []) {
    if (c.status === 'watch' || c.trend !== 'up') continue;
    const s = Number(c.attention_score);
    if (!(s >= fcMinScore)) continue;
    fcAlerts.push({
      kind: 'forecast',
      label: `${DOMAIN_LABEL[c.domain] || c.domain || ''} ${c.place_ja || ''}`.trim(),
      detail: `注視度 ${s}`, severity: s, lon: c.lon, lat: c.lat, domain: c.domain, when: fcUpdated,
    });
  }
  fcAlerts.sort((a, b) => b.severity - a.severity);
  const fcSeen = new Set();
  for (const a of fcAlerts) {
    const key = `f:${a.domain}:${a.label}`;
    if (fcSeen.has(key)) continue;
    fcSeen.add(key); out.push(a);
  }

  out.sort((a, b) => b.severity - a.severity);
  return out.slice(0, limit);
}

// アラートチップ1個の内側 HTML（escape 済み）。opts.now は when の相対時刻の基準。
// when が無い（＝時刻キーの無い snapshot）ときは何も出さない＝「今の話」に見せない。
export function alertChipHtml(a, opts = {}) {
  const o = a || {};
  const { now = Date.now() } = opts;
  const when = o.when ? `<span class="alert-when">${esc(relTime(o.when, now))}</span>` : '';
  return `<span class="alert-chip alert-${esc(o.kind)}">`
    + '<span class="alert-ic">⚠</span>'
    + `<span class="alert-label">${esc(o.label)}</span>`
    + `<em class="alert-detail">${esc(o.detail)}</em>${when}</span>`;
}

// rootEl=#alerts。alerts=selectAlerts の戻り。onSelect(alert) は座標ありでクリック時。
// 0件ならバンドごと非表示。now は各チップの相対時刻の基準（既定は現在時刻）。
export function renderAlerts(rootEl, alerts, { onSelect, now = Date.now() } = {}) {
  if (!rootEl) return;
  const items = alerts || [];
  rootEl.style.display = items.length ? '' : 'none';
  const list = rootEl.querySelector('.alert-list') || rootEl;
  list.innerHTML = '';
  for (const a of items) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'alert-btn';
    el.innerHTML = alertChipHtml(a, { now });
    if (typeof a.lat === 'number' && typeof a.lon === 'number' && (a.lat || a.lon) && onSelect) {
      el.addEventListener('click', () => onSelect(a));
    } else {
      el.disabled = true;
    }
    list.appendChild(el);
  }
}
