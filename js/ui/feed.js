// 右イベントフィード描画。クリックで地図 flyTo。集約は js/lib/feed.js。
import { formatFreshness } from '../lib/geo.js';
import { countBarPct } from '../lib/feed.js';

const COLOR = { quakes: 'rgb(255,176,40)', conflict: 'rgb(255,60,80)', protests: 'rgb(94,255,166)', news: 'var(--cyan)' };
const LABEL = { quakes: '地震', conflict: '紛争', protests: '抗議', news: 'ニュース' };

export function renderFeed(root, items, onPick, maxCount = 0) {
  root.innerHTML = items.map((it, i) => {
    const c = COLOR[it.layerId] || 'var(--cyan)';
    const title = it.kind === 'group'
      ? `${LABEL[it.layerId] || ''} ${escapeHtml(it.country_ja || '')}`
      : escapeHtml(it.title);
    const badge = it.kind === 'group'
      ? `<span class="feed-count" style="--barw:${countBarPct(it.count, maxCount)}%">${Number(it.count) || 0}件</span>`
      : '';
    return `<div class="feed-row" data-i="${i}" style="--rowcat:${c}">
      <span class="feed-dot" style="color:${c};background:${c}"></span>
      <span class="feed-title">${title}</span>${badge}
      <span class="feed-time">${it.time ? formatFreshness(new Date(it.time).toISOString()) : ''}</span>
    </div>`;
  }).join('') || '<div class="feed-empty">イベントなし</div>';

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

// チップ行（全＋各レイヤー）。onToggle(id)/onAll() を委譲で呼ぶ。
export function renderChips(root, chipIds, hidden, onToggle, onAll) {
  const allOn = chipIds.every((id) => !hidden.has(id));
  const html = [`<button class="feed-chip chip-all${allOn ? ' active' : ''}" data-all="1">全</button>`]
    .concat(chipIds.map((id) => {
      const on = !hidden.has(id);
      const c = COLOR[id] || 'var(--cyan)';
      return `<button class="feed-chip${on ? ' active' : ''}" data-chip="${id}" style="--chip:${c}">${LABEL[id] || id}</button>`;
    })).join('');
  root.innerHTML = html;
  if (!root.__wired) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('.feed-chip');
      if (!b) return;
      if (b.dataset.all) onAll(); else onToggle(b.dataset.chip);
    });
    root.__wired = true;
  }
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
