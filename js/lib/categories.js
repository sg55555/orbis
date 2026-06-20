// レイヤーのカテゴリ分類（純データ＋純関数・deck/DOM 非依存）。
// presets.js と同じ流儀。各 layerId は registry に実在すること（categories.test.js が整合性を検証）。
export const CATEGORIES = [
  { id: 'events',      label: '出来事', layerIds: ['quakes', 'conflict', 'protests', 'news'] },
  { id: 'mobility',    label: '移動',   layerIds: ['flights', 'ships', 'trade'] },
  { id: 'environment', label: '環境',   layerIds: ['sst', 'currents', 'airtemp'] },
];

// layers（registry の layer オブジェクト配列）をカテゴリ順にグループ化して返す（純粋）。
// 群内順は CATEGORIES.layerIds の順。該当0件の群は返さない。
// どのカテゴリにも属さない layer は末尾「その他」群にまとめる（将来レイヤー追加時の取りこぼし防止）。
export function groupLayers(layers, categories = CATEGORIES) {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const used = new Set();
  const out = [];
  for (const c of categories) {
    const ls = c.layerIds.map((id) => byId.get(id)).filter(Boolean);
    ls.forEach((l) => used.add(l.id));
    if (ls.length) out.push({ id: c.id, label: c.label, layers: ls });
  }
  const rest = layers.filter((l) => !used.has(l.id));
  if (rest.length) out.push({ id: 'other', label: 'その他', layers: rest });
  return out;
}
