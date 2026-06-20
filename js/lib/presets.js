// レイヤープリセット（純データ＋純関数・deck/DOM 非依存）。
// 概観=世界の出来事の俯瞰を既定にし「初期から情報過多」を断つ。各層IDは registry に実在すること。
export const PRESETS = [
  { id: 'overview', label: '概観', layers: ['quakes', 'news', 'conflict', 'protests', 'currents'] },
  { id: 'conflict', label: '紛争', layers: ['conflict', 'protests', 'news'] },
  { id: 'weather', label: '気象', layers: ['sst', 'currents', 'airtemp'] },
  { id: 'traffic', label: '交通', layers: ['flights', 'ships', 'trade'] },
];
export const DEFAULT_PRESET = 'overview';

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// プリセット適用後の ENABLED 集合（純粋・排他＝その層だけ）。未知idは空集合。
export function applyPreset(id) {
  const p = presetById(id);
  return new Set(p ? p.layers : []);
}

// 現在の ENABLED 集合がどのプリセットと完全一致するか。一致なし=null（カスタム）。
export function activePresetId(enabledSet) {
  for (const p of PRESETS) {
    if (p.layers.length === enabledSet.size && p.layers.every((id) => enabledSet.has(id))) return p.id;
  }
  return null;
}
