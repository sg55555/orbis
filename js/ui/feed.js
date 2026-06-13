// 右イベントフィード描画。クリックで地図 flyTo。集約は js/lib/feed.js。
import { formatFreshness } from '../lib/geo.js';

const COLOR = { quakes: 'rgb(255,176,40)', conflict: 'rgb(255,60,80)', protests: 'rgb(94,255,166)' };

// root に items を描画。onPick(item) はクリック時コールバック。
export function renderFeed(root, items, onPick) {
  root.innerHTML = items.map((it, i) => {
    const c = COLOR[it.layerId] || 'var(--cyan)';
    return `<div class="feed-row" data-i="${i}">
      <span class="feed-dot" style="color:${c};background:${c}"></span>
      <span class="feed-title">${escapeHtml(it.title)}</span>
      <span class="feed-time">${it.time ? formatFreshness(new Date(it.time).toISOString()) : ''}</span>
    </div>`;
  }).join('') || '<div class="feed-empty">イベントなし</div>';

  // イベント委譲（再生成に強い）。直近 items をクロージャで参照。
  if (!root.__wired) {
    root.addEventListener('click', (e) => {
      const row = e.target.closest('.feed-row');
      if (!row) return;
      const it = root.__items[+row.dataset.i];
      if (it) onPick(it);
    });
    root.__wired = true;
  }
  root.__items = items;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function wireCollapse(panelEl, btnEl) {
  btnEl.addEventListener('click', () => {
    panelEl.classList.toggle('collapsed');
    btnEl.textContent = panelEl.classList.contains('collapsed') ? '‹' : '›';
  });
}
