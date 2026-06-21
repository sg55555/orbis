// 国検索 UI。globe 上部中央のグラス検索ボックス＋オートコンプリート候補。
// 検索ロジックは純粋部 lib/gazetteer.js（searchCountries）。選択で onSelect(country) を呼ぶ。
// main.js が initSearch(onSelect) を配線する（share.js と同型）。
import { searchCountries } from '../lib/gazetteer.js';

export function initSearch(onSelect, {
  input = (typeof document !== 'undefined' ? document.getElementById('search-input') : null),
  results = (typeof document !== 'undefined' ? document.getElementById('search-results') : null),
} = {}) {
  if (!input || !results) return;
  let matches = [];
  let active = -1;

  const close = () => {
    results.innerHTML = '';
    results.hidden = true;
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const render = () => {
    if (matches.length === 0) {
      results.innerHTML = '<li class="search-empty" role="option" aria-disabled="true">該当なし</li>';
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      return;
    }
    results.innerHTML = matches.map((c, i) =>
      `<li class="search-opt${i === active ? ' active' : ''}" role="option" id="search-opt-${i}"`
      + ` data-i="${i}" aria-selected="${i === active}">`
      + `<span class="search-ja">${c.ja}</span><span class="search-en">${c.en}</span></li>`).join('');
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (active >= 0) input.setAttribute('aria-activedescendant', `search-opt-${active}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const choose = (i) => {
    const c = matches[i];
    if (!c) return;
    input.value = c.ja;
    close();
    if (typeof onSelect === 'function') onSelect(c);
  };

  input.addEventListener('input', () => {
    if (input.value.trim() === '') { matches = []; close(); return; }
    matches = searchCountries(input.value);
    active = -1;
    render();
  });

  input.addEventListener('keydown', (e) => {
    if (results.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, matches.length - 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active >= 0 ? active : 0); }
    else if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  });

  // mousedown（blur より先）で確定。タッチ/クリック両対応。
  results.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.search-opt');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  });

  input.addEventListener('blur', () => { setTimeout(close, 120); });

  // '/' で検索にフォーカス（他の入力にフォーカスが無い時）。
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(tag)) { e.preventDefault(); input.focus(); }
  });
}
