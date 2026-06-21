// 国検索の純粋部。country_centroids.js（生成）を FIPS_JA(places.js) と join し、
// 日本語名/英語名で部分一致検索する。deck/DOM 非依存。
import { COUNTRY_CENTROIDS } from './country_centroids.js';
import { FIPS_JA } from './places.js';

// {code, ja, en, lng, lat}。ja は FIPS_JA 単一ソース（無ければ en フォールバック）。
// COUNTRY_CENTROIDS は code 昇順 → COUNTRIES も code 昇順（ランキングの安定基盤）。
export const COUNTRIES = COUNTRY_CENTROIDS.map((c) => ({
  code: c.code,
  ja: FIPS_JA[c.code] || c.en,
  en: c.en,
  lng: c.lng,
  lat: c.lat,
}));

// query を日本語名・英語名に部分一致。前方一致を上位、次に部分一致。最大 limit 件。
// 空/空白/無マッチ → []。英語は大小無視、日本語は trim のみ（小文字化は ASCII のみ影響）。
export function searchCountries(query, limit = 8) {
  const raw = (query == null ? '' : String(query)).trim();
  if (raw === '') return [];
  const q = raw.toLowerCase();
  const prefix = [];
  const substr = [];
  for (const c of COUNTRIES) {
    const en = c.en.toLowerCase();
    if (c.ja.startsWith(raw) || en.startsWith(q)) prefix.push(c);
    else if (c.ja.includes(raw) || en.includes(q)) substr.push(c);
  }
  return prefix.concat(substr).slice(0, limit);
}
