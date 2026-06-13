// 左トグルパネル。各レイヤー = チェック + 凡例スウォッチ + ライブ件数 + 説明文。
// 純粋な状態操作は js/lib/state.js（loadEnabled/toggleEnabled）に委譲。
import { toggleEnabled, writeStored } from '../lib/state.js';

// layers: レイヤー配列, getEnabled: ()=>Set, getCounts: ()=>{id:number}, onChange(nextSet): トグル時コールバック。
// descFor: (id)=>string — 非専門家向け一行説明（省略可）。
// 要素は一度だけ生成し、件数更新は updateCounts で textContent だけ差し替える（入力要素を作り直さない）。
export function renderPanel(root, layers, getEnabled, getCounts, onChange, descFor) {
  root.innerHTML = layers.map((l) => {
    const sw = (l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)';
    const desc = descFor ? descFor(l.id) : '';
    return `<div class="layer-item">
      <label class="layer-row" data-id="${l.id}">
        <input type="checkbox" class="layer-toggle" />
        <span class="swatch" style="color:${sw};background:${sw}"></span>
        <span class="layer-label">${l.label}</span>
        <span class="layer-count" data-count="${l.id}">–</span>
      </label>
      ${desc ? `<div class="layer-desc">${desc}</div>` : ''}
    </div>`;
  }).join('');

  syncChecks(root, getEnabled());

  root.addEventListener('change', (e) => {
    const cb = e.target.closest('.layer-toggle');
    if (!cb) return;
    const id = cb.closest('.layer-row').dataset.id;
    const next = toggleEnabled(getEnabled(), id);
    writeStored(next);
    onChange(next);
  });

  return {
    updateCounts() {
      const counts = getCounts();
      root.querySelectorAll('.layer-count').forEach((el) => {
        const n = counts[el.dataset.count];
        el.textContent = (n == null) ? '–' : String(n);
      });
    },
    syncChecks() { syncChecks(root, getEnabled()); },
  };
}

function syncChecks(root, enabled) {
  root.querySelectorAll('.layer-row').forEach((row) => {
    const cb = row.querySelector('.layer-toggle');
    if (cb) cb.checked = enabled.has(row.dataset.id);
  });
}

// 折りたたみボタン結線（パネルに collapsed クラスをトグル）。
export function wireCollapse(panelEl, btnEl) {
  btnEl.addEventListener('click', () => {
    panelEl.classList.toggle('collapsed');
    btnEl.textContent = panelEl.classList.contains('collapsed') ? '›' : '‹';
  });
}
