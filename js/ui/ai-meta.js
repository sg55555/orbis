// AI 生成物（ブリーフィング／不安定性／予測）と news の「正直な鮮度表示」を担う純関数群。
// DOM 非依存＝文字列を返すだけで、差し込みは各 ui モジュール側が行う（テストしやすさ優先）。
// 文言は骨格 Global Constraints の verbatim（最終更新／更新停止中／更新時刻 不明／免責）。
import { relTime } from './sources.js';
import { escapeHtml } from '../lib/selection.js';

// AI 3 層と news は同じ hourly-ai schedule で動くので stale 判定は 24 時間。
// 通常レイヤーの 6 時間（js/lib/geo.js freshnessSummary の既定 staleSec=21600）とは別基準。
export const FRESH_AI_MS = 24 * 3600 * 1000;

// ISO 文字列 → 'YYYY-MM-DD HH:mm UTC'。不正/欠落は '時刻不明'（toLocaleString は環境差が出るので使わない）。
function fmtUtc(v) {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return '時刻不明';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} `
    + `${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

// updated(ISO) → 鮮度チップの素。staleMs を「超えた」ら更新停止中（境界ちょうどは fresh）。
// updated が欠落/不正なら stale 扱い＝データが無いことを新鮮さとして表示しない。
export function freshnessChip({ updated, now = Date.now(), staleMs = FRESH_AI_MS } = {}) {
  const t = Date.parse(updated);
  if (!Number.isFinite(t)) return { text: '更新時刻 不明', stale: true, rel: '—' };
  const rel = relTime(updated, now);
  const stale = (now - t) > staleMs;
  return { text: stale ? `更新停止中 · 最終 ${rel}` : `最終更新 ${rel}`, stale, rel };
}

// 鮮度チップの HTML。title は正規化した ISO（不正なら空文字＝生値を DOM に入れない）。
export function freshnessChipHtml(opts) {
  const o = opts || {};
  const { text, stale } = freshnessChip(o);
  const t = Date.parse(o.updated);
  const iso = Number.isFinite(t) ? new Date(t).toISOString() : '';
  return `<span class="fresh-chip${stale ? ' is-stale' : ''}" title="${escapeHtml(iso)}">`
    + `${escapeHtml(text)}</span>`;
}

// AI 生成物の免責（各リストの末尾に 1 つだけ）。model 不明なら括弧内は時刻だけ。
export function aiDisclaimerHtml({ model, generatedAt } = {}) {
  const when = fmtUtc(generatedAt);
  const inner = model ? `${escapeHtml(model)}・${escapeHtml(when)}` : escapeHtml(when);
  return `<p class="ai-disclaimer">AI 生成（${inner}）・要約/推定であり誤りを含むことがあります</p>`;
}

// 「分析できるデータが無い」ことしか述べていない定型 narrative か（空/欠落も含む）。
// 本番 instability.json（2026-09-03）は 25 件中、定型 5・narrative_ja 欠落 17。
const PLACEHOLDER_RE = /記載されていない|データ(が|は|には)?不足|具体的な事象/;
export function isPlaceholderNarrative(s) {
  const v = String(s == null ? '' : s).trim();
  if (!v) return true;
  return PLACEHOLDER_RE.test(v);
}
