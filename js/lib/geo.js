// 地図描画用の純粋ヘルパ（ブラウザ・Node 双方で import 可能な ESM）。

export function magnitudeToRadius(mag) {
  const m = Number(mag) || 0;
  return Math.round(Math.max(3, Math.pow(m, 1.8)));
}

export function magnitudeToColor(mag) {
  const m = Number(mag) || 0;
  if (m < 2) return [57, 208, 255];    // cyan
  if (m < 4) return [94, 255, 166];    // green
  if (m < 6) return [255, 176, 40];    // amber
  return [255, 60, 80];                // red
}

export function formatFreshness(updatedIso, now = Date.now()) {
  const diffSec = Math.max(0, Math.floor((now - Date.parse(updatedIso)) / 1000));
  if (diffSec < 60) return 'たった今';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  return `${Math.floor(diffSec / 86400)}日前`;
}
