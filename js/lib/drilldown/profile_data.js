// プロフィール遅延取得（DI seam）。manifest 事前判定→相対 fetch→gz は DecompressionStream gunzip。
// country は素 JSON、admin1/city は .json.gz。失敗/欠落は null。成功は Map キャッシュ。
const URL_OF = {
  country: (id) => `data/static/profiles/country/${id}.json`,
  admin1: (id) => `data/static/profiles/admin1/${id}.json.gz`,
  city: (id) => `data/static/profiles/city/${id}.json.gz`,
};
const _cache = new Map();      // `${level}/${id}` -> profile
const _inflight = new Map();

function _has(manifest, level, id) {
  const m = manifest && manifest[level];
  return !!(m && Object.prototype.hasOwnProperty.call(m, id));
}

async function _gunzipJson(res) {
  if (typeof DecompressionStream === 'undefined' || !res.body) return res.json();
  const ds = new DecompressionStream('gzip');
  const reader = res.body.pipeThrough(ds).getReader();
  const chunks = [];
  // eslint-disable-next-line no-constant-condition
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(total); let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return JSON.parse(new TextDecoder().decode(buf));
}

export function loadProfile(level, id, { manifest, fetchFn, timeoutMs = 8000 } = {}) {
  const key = `${level}/${id}`;
  if (_cache.has(key)) return Promise.resolve(_cache.get(key));
  if (_inflight.has(key)) return _inflight.get(key);
  if (!_has(manifest, level, id) || !URL_OF[level]) return Promise.resolve(null);
  const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return Promise.resolve(null);
  const p = (async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await f(URL_OF[level](id), ctl ? { signal: ctl.signal } : {});
      if (!res || !res.ok) return null;
      const prof = level === 'country' ? await res.json() : await _gunzipJson(res);
      if (prof != null) _cache.set(key, prof);
      return prof;
    } catch { return null; }
    finally { if (timer) clearTimeout(timer); _inflight.delete(key); }
  })();
  _inflight.set(key, p);
  return p;
}

export function __resetProfileCache() { _cache.clear(); _inflight.clear(); }
