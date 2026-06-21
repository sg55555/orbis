// data/snapshots の配信元を解決する純ヘルパ。本番=raw GitHub / ローカル=相対。
// 本番のデータは Vercel build から切り離し GitHub から直接配信する（cron commit が
// Vercel デプロイ枠を食わないようにするため）。data/static・config は対象外（相対のまま）。
export const RAW_BASE = 'https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots';
const LOCAL_BASE = 'data/snapshots';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '']);

function _loc(loc) {
  return loc || (typeof location !== 'undefined' ? location : { hostname: '', search: '' });
}

export function isRemoteData(loc) {
  const l = _loc(loc);
  const search = l.search || '';
  if (/[?&]data=local(\b|$)/.test(search)) return false;
  if (/[?&]data=github(\b|$)/.test(search)) return true;
  return !LOCAL_HOSTS.has(l.hostname || '');
}

export function snapshotBaseUrl(loc) {
  return isRemoteData(loc) ? RAW_BASE : LOCAL_BASE;
}

export function snapshotUrl(name, loc) {
  return `${snapshotBaseUrl(loc)}/${name}.json`;
}
