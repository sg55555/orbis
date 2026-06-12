// data/snapshots/*.json と manifest.json を取得・ポーリングする薄いI/O層。
const BASE = 'data/snapshots';

export async function fetchSnapshot(layerId) {
  const res = await fetch(`${BASE}/${layerId}.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`snapshot ${layerId} ${res.status}`);
  return res.json();
}

export async function fetchManifest() {
  const res = await fetch(`${BASE}/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return { layers: {} };
  return res.json();
}

// 指定レイヤー群を取得して { id: snapshot } を返す。失敗レイヤーはスキップ（堅牢性）。
export async function fetchSnapshots(layerIds) {
  const out = {};
  await Promise.all(layerIds.map(async (id) => {
    try { out[id] = await fetchSnapshot(id); }
    catch (e) { console.warn('snapshot failed', id, e); }
  }));
  return out;
}

// intervalMs ごとに cb(snapshots) を呼ぶ。戻り値は停止関数。
export function startPolling(layerIds, intervalMs, cb) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    cb(await fetchSnapshots(layerIds));
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}
