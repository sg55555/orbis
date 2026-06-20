// 左トグルパネル。各レイヤー = チェック + 凡例スウォッチ + ライブ件数 + 説明文。
// 純粋な状態操作は js/lib/state.js（loadEnabled/toggleEnabled）に委譲。
import { toggleEnabled, writeStored } from '../lib/state.js';
import { PRESETS, applyPreset, activePresetId } from '../lib/presets.js';
import { groupLayers } from '../lib/categories.js';

// layers: レイヤー配列, getEnabled: ()=>Set, getCounts: ()=>{id:number}, onChange(nextSet): トグル時コールバック。
// descFor: (id)=>string — 非専門家向け一行説明（省略可）。
// 要素は一度だけ生成し、件数更新は updateCounts で textContent だけ差し替える（入力要素を作り直さない）。
export function renderPanel(root, layers, getEnabled, getCounts, onChange, descFor) {
  const groups = groupLayers(layers);
  root.innerHTML = groups.map((g) => `<div class="layer-cat" data-cat="${g.id}">
      <div class="layer-cat-head">${g.label}</div>
      ${g.layers.map((l) => rowHtml(l, descFor)).join('')}
    </div>`).join('');

  syncChecks(root, getEnabled());

  root.addEventListener('change', (e) => {
    const cb = e.target.closest('.layer-toggle');
    if (!cb) return;
    const id = cb.closest('.layer-row').dataset.id;
    const next = toggleEnabled(getEnabled(), id);
    writeStored(next);
    onChange(next);
  });

  // ⓘ：説明の開閉（タッチで確実）。<label> 内なので既定動作とバブリングを止めてチェック誤作動を防ぐ。
  root.addEventListener('click', (e) => {
    const info = e.target.closest('.layer-info');
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    const item = info.closest('.layer-item');
    const open = item.classList.toggle('desc-open');
    info.setAttribute('aria-expanded', open ? 'true' : 'false');
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

// 1レイヤー行の HTML（説明あり層は ⓘ で開閉）。
function rowHtml(l, descFor) {
  const sw = l.swatchColor || ((l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)');
  const marker = l.marker || 'dot'; // dot | ring | triangle
  const desc = descFor ? descFor(l.id) : '';
  return `<div class="layer-item">
      <label class="layer-row" data-id="${l.id}">
        <input type="checkbox" class="layer-toggle" />
        <span class="swatch swatch-${marker}" style="color:${sw}"></span>
        <span class="layer-label">${l.label}</span>
        <span class="layer-count" data-count="${l.id}">–</span>
        ${desc ? `<button type="button" class="layer-info" aria-label="説明" aria-expanded="false">ⓘ</button>` : ''}
      </label>
      ${desc ? `<div class="layer-desc">${desc}</div>` : ''}
    </div>`;
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

// プリセット chip 行。クリックでそのプリセットの層だけ ON（排他）。アクティブ強調＋カスタム表示。
// root: #panel-presets, getEnabled: ()=>Set, onApply(nextSet): 適用コールバック。
export function renderPresets(root, getEnabled, onApply) {
  if (!root) return { refresh() {} };
  root.innerHTML = PRESETS.map((p) =>
    `<button type="button" class="preset-chip" data-preset="${p.id}">${p.label}</button>`
  ).join('') + '<span class="preset-custom" hidden>カスタム</span>';

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-chip');
    if (!btn) return;
    onApply(applyPreset(btn.dataset.preset));
  });

  const api = {
    refresh() {
      const active = activePresetId(getEnabled());
      root.querySelectorAll('.preset-chip').forEach((b) =>
        b.classList.toggle('active', b.dataset.preset === active));
      const custom = root.querySelector('.preset-custom');
      if (custom) custom.hidden = active != null;
    },
  };
  api.refresh();
  return api;
}
