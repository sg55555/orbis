// ウォッチリストの純操作（FIPS 配列）＋localStorage 薄ラッパ（state.js 同型）。
// permalink/share には載せない（共有 URL に混入させない）。
import { FIPS_JA } from '../places.js';

const MAX = 30;

// code を末尾追加した新配列。重複は無視・上限 30 超過時は先頭を落とす（FIFO）。
export function addCode(list, code) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const c = typeof code === 'string' ? code.trim() : '';
  if (!c) return arr;
  if (arr.includes(c)) return arr;
  arr.push(c);
  while (arr.length > MAX) arr.shift();
  return arr;
}

// code を除いた新配列（順序保持）。
export function removeCode(list, code) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((x) => x !== code);
}

// code を含むか。
export function hasCode(list, code) {
  return Array.isArray(list) && list.includes(code);
}

// list（FIPS 配列）を instability countries の score 降順に並べ替える。
// 圏外（countries に無い）は score 0 扱いで末尾・同 score は元の list 順を保つ。
export function orderByInstability(list, countries) {
  if (!Array.isArray(list)) return [];
  const scoreOf = new Map();
  (Array.isArray(countries) ? countries : []).forEach((c) => {
    if (c && typeof c.code === 'string') scoreOf.set(c.code, c.score || 0);
  });
  return list
    .map((code, i) => ({ code, i, s: scoreOf.get(code) || 0 }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.code);
}

// コード配列（string[]）を国オブジェクト配列（renderWatchlist 向け）に join する純ヘルパ。
// patch #7: ウォッチリスト描画時に main.js から呼ばれる（DI seam）。
// - codes: string[]（ウォッチリストの FIPS コード配列）
// - instabilityCountries: instability.countries（{code, score, level?} 等）または null/undefined
// - fipsCenterFn: code → [lng, lat] or null（country_index.fipsCenter を渡す）
// 戻り値: [{code, name_ja, score, level?, lon, lat}]・orderByInstability 準拠の順序。
// 圏外国（instabilityCountries に無い）は score=0 で必ず含める（消えない）。
// fipsCenterFn が null を返す国は lon=0/lat=0 フォールバック（disabled で表示は残す）。
export function joinWatchCountries(codes, instabilityCountries, fipsCenterFn) {
  if (!Array.isArray(codes)) return [];
  const iArr = Array.isArray(instabilityCountries) ? instabilityCountries : [];
  const insMap = new Map(iArr.map((c) => [c.code, c]));

  // orderByInstability 準拠の順序（score 降順・同 score は元順）
  const sorted = orderByInstability(codes, iArr);

  return sorted.map((code) => {
    const ins = insMap.get(code);
    const ctr = fipsCenterFn ? fipsCenterFn(code) : null;
    // Minor（spec §7）: 圏外国（instability に name_ja が無い）は FIPS_JA から日本語名を引く。
    // instability.name_ja → FIPS_JA[code] → 生 FIPS コード（最終フォールバック）の優先順。
    const name_ja = (ins && ins.name_ja) || FIPS_JA[code] || code;
    const obj = {
      code,
      name_ja,
      score: ins ? (ins.score || 0) : 0,
      lon: ctr ? ctr[0] : 0,
      lat: ctr ? ctr[1] : 0,
    };
    if (ins && ins.level != null) obj.level = ins.level;
    return obj;
  });
}

// localStorage 薄ラッパ（state.js readStored/writeStored 同型）。storage を DI。
// load: 破損 JSON / 非配列 / storage 欠落 → []。save: 失敗は握りつぶす。
export function makeWatchlistStore({ storage, key = 'orbis.watchlist' } = {}) {
  return {
    load() {
      if (!storage) return [];
      try {
        const v = JSON.parse(storage.getItem(key));
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    },
    save(codes) {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify(Array.isArray(codes) ? codes : []));
      } catch {
        /* noop */
      }
    },
  };
}
