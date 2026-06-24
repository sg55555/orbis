// 国ドリルダウンの遅延データ取得層（DI seam）。
// manifest 事前判定 → 相対 fetch（data/static は data-source.js 非対象＝常に相対 Vercel 配信）
// → AbortController + timeout → 失敗/欠落は degraded:true で空配列。
// 同一 FIPS の in-flight Promise 共有 ＋ 成功 Map キャッシュ。
// patch #3: admin1 は .geojson.gz を fetch し DecompressionStream('gzip') でクライアント gunzip → JSON.parse。
// （build_admin1.py が .gz 出力するため）。fetchFn を DI 可能にし、fake は展開済テキストを返す。
const ADMIN1_URL = (fips) => `data/static/admin1/${fips}.geojson.gz`;
const CITIES_URL = (fips) => `data/static/cities/${fips}.json`;

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });
const _inflight = new Map(); // fips -> Promise
const _cache = new Map();    // fips -> {admin1, cities, degraded}

function _hasAdmin1(manifest, fips) {
  if (!manifest) return false;
  const m = manifest[fips];
  return !!(m && m.admin1Bytes != null);
}

// gzip レスポンスを JSON に展開する。
// DecompressionStream が利用可能な場合はそれを使い、なければ res.json() に fallback
// （テスト fake が展開済テキストを返す場合は res.json() で直接 parse できる）。
async function _gunzipJson(res) {
  // fake fetchFn は res.json() が使える形を返すことがある（body が無い）。
  // DecompressionStream が無い環境 or body が無い場合は res.json() に fallback。
  if (typeof DecompressionStream === 'undefined' || !res.body) {
    return res.json();
  }
  // ブラウザ / Node 18+: ReadableStream + DecompressionStream で gunzip。
  const ds = new DecompressionStream('gzip');
  const piped = res.body.pipeThrough(ds);
  const chunks = [];
  const reader = piped.getReader();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  const text = new TextDecoder().decode(buf);
  return JSON.parse(text);
}

export function loadCountryGeo(fips, { signal, timeoutMs = 8000, manifest, fetchFn } = {}) {
  if (_cache.has(fips)) return Promise.resolve(_cache.get(fips));
  if (_inflight.has(fips)) return _inflight.get(fips);

  // manifest 事前判定: admin1 エントリが無い(EXTRA68/未生成) → fetch せず degraded 空。
  if (!_hasAdmin1(manifest, fips)) {
    const degraded = { admin1: EMPTY_FC(), cities: [], degraded: true };
    return Promise.resolve(degraded);
  }

  const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  const p = (async () => {
    try {
      const result = await _fetchGeo(fips, f, signal, timeoutMs);
      _cache.set(fips, result);
      return result;
    } finally {
      _inflight.delete(fips);
    }
  })();
  _inflight.set(fips, p);
  return p;
}

async function _fetchGeo(fips, f, signal, timeoutMs) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const [admin1Res, citiesRes] = await Promise.all([
      f(ADMIN1_URL(fips), { signal: ctl.signal }),
      f(CITIES_URL(fips), { signal: ctl.signal }),
    ]);
    if (!admin1Res || !admin1Res.ok) throw new Error('admin1 fetch failed');
    const admin1 = await _gunzipJson(admin1Res);
    let cities = [];
    if (citiesRes && citiesRes.ok) {
      const c = await citiesRes.json();
      if (Array.isArray(c)) cities = c;
    }
    return { admin1, cities, degraded: false };
  } catch {
    return { admin1: EMPTY_FC(), cities: [], degraded: true };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// テスト用: in-flight/成功キャッシュを破棄（本番コードからは呼ばない）。
export function __resetCountryDataCache() {
  _inflight.clear();
  _cache.clear();
}
