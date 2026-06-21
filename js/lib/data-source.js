// data/snapshots の配信元を解決する純ヘルパ。本番=raw GitHub / ローカル=相対。
// ⚠ raw GitHub 直配信はリポジトリが Public のときのみ機能する。orbis は現在 PRIVATE のため
//   raw は匿名で 404 になる → REMOTE_ENABLED=false で無効化し相対(=Vercel 配信)にフォールバック。
//   将来 Public 化 or 公開データ repo 導入時に REMOTE_ENABLED=true（必要なら RAW_BASE 更新）で有効化。
// data/static・config は対象外（常に相対）。
export const RAW_BASE = 'https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots';
// private repo のため raw 無効化中。本番も相対(Vercel 配信)を使う。
export const REMOTE_ENABLED = false;
const LOCAL_BASE = 'data/snapshots';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

function _loc(loc) {
  return loc || (typeof location !== 'undefined' ? location : { hostname: '', search: '' });
}

// ホスト/override だけで「raw を使いたい環境か」を判定（フラグ非依存・純粋）。
// 将来 REMOTE_ENABLED を true にした時の判定ロジックはここに保持し、テストもここを対象にする。
export function hostPrefersRemote(loc) {
  const l = _loc(loc);
  const search = l.search || '';
  if (/[?&]data=local(\b|$)/.test(search)) return false;
  if (/[?&]data=github(\b|$)/.test(search)) return true;
  return !LOCAL_HOSTS.has(l.hostname || '');
}

export function isRemoteData(loc) {
  // raw 無効化中(REMOTE_ENABLED=false)は環境に関わらず常に相対(Vercel 配信)。
  return REMOTE_ENABLED && hostPrefersRemote(loc);
}

export function snapshotBaseUrl(loc) {
  return isRemoteData(loc) ? RAW_BASE : LOCAL_BASE;
}

export function snapshotUrl(name, loc) {
  return `${snapshotBaseUrl(loc)}/${name}.json`;
}
