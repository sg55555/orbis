// 共有パーマリンク UI。共有ボタン押下で「ビュー＋レイヤー」を URL 化しクリップボードへコピー、
// トーストで通知する。URL 組み立ては純粋部 lib/permalink.js（buildPermalink）。
// getState(): { center:[lng,lat], zoom:number, layers:string[] } を返すコールバックを受け取る。
import { buildPermalink } from '../lib/permalink.js';

export function initShare(getState, {
  btn = (typeof document !== 'undefined' ? document.getElementById('share-btn') : null),
  toast = (typeof document !== 'undefined' ? document.getElementById('share-toast') : null),
} = {}) {
  if (!btn) return;
  let hideTimer = 0;
  const showToast = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  };
  btn.addEventListener('click', async () => {
    let url;
    try {
      url = buildPermalink(location.origin + location.pathname, getState() || {});
    } catch {
      showToast('URL を作成できませんでした');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        showToast('リンクをコピーしました');
      } else {
        showToast(url); // クリップボード不可（非セキュア/古い環境）：URL 表示でフォールバック
      }
    } catch {
      showToast(url); // コピー失敗時も URL を見せる
    }
  });
}
