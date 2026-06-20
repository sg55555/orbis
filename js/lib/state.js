// ENABLED（有効レイヤー集合）の純粋操作と localStorage 薄ラッパ。
const KEY = 'orbis.enabled.v1';

// stored: 有効idの配列（保存形式）。null/不正なら:
//   defaultOn 指定時は defaultOn の集合、未指定時は defaultOff を除く全 ON。
export function loadEnabled(allIds, stored, defaultOff = [], defaultOn = null) {
  if (!Array.isArray(stored)) {
    if (Array.isArray(defaultOn)) return new Set(allIds.filter((id) => defaultOn.includes(id)));
    return new Set(allIds.filter((id) => !defaultOff.includes(id)));
  }
  return new Set(allIds.filter((id) => stored.includes(id)));
}

// id をトグルした新しい Set を返す（不変）。
export function toggleEnabled(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// I/O（テストでは未使用。ブラウザのみ）。
export function readStored(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return null;
  try { return JSON.parse(storage.getItem(KEY)); } catch { return null; }
}
export function writeStored(set, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try { storage.setItem(KEY, JSON.stringify([...set])); } catch { /* noop */ }
}
