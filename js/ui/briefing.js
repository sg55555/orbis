// AI ワールド・ブリーフィング描画。lead＋カード（カテゴリ色/severity）。座標ありカードは onSelect。
import { categoryOf } from '../lib/news_categories.js';
import { freshnessChipHtml, aiDisclaimerHtml } from './ai-meta.js';

export function briefCards(brief) {
  return (brief && Array.isArray(brief.cards)) ? brief.cards : [];
}

export function cardColorCss(category) {
  const [r, g, b] = categoryOf(category).color;
  return `rgb(${r},${g},${b})`;
}

// rootEl=#ai-brief（.brief-lead と .brief-cards を内包）。onSelect(card) は座標ありカードのクリック。
// now は鮮度チップの基準時刻（既定は現在時刻）。
export function renderBriefing(rootEl, brief, { onSelect, now = Date.now() } = {}) {
  const b = brief || {};
  const leadEl = rootEl.querySelector('.brief-lead');
  const cardsEl = rootEl.querySelector('.brief-cards');
  const freshEl = rootEl.querySelector('#brief-fresh');
  // 見出し脇に「いつのデータか」。停止中なら .is-stale が付く（css で減光）。
  if (freshEl) freshEl.innerHTML = freshnessChipHtml({ updated: b.updated, now });
  if (leadEl) leadEl.textContent = b.lead || '';
  cardsEl.innerHTML = '';
  for (const c of briefCards(brief)) {
    const el = document.createElement('button');
    el.className = 'brief-card';
    el.dataset.severity = c.severity || 3;
    el.style.setProperty('--cat', cardColorCss(c.category));
    const cat = categoryOf(c.category);
    el.innerHTML = '<span class="brief-dot"></span><div class="brief-body">'
      + '<div class="brief-title"></div><div class="brief-sum"></div>'
      + '<div class="brief-meta"></div></div>';
    el.querySelector('.brief-title').textContent = c.title_ja || '';
    el.querySelector('.brief-sum').textContent = c.summary_ja || '';
    el.querySelector('.brief-meta').textContent = cat.label + (c.place ? `｜${c.place}` : '');
    if (typeof c.lat === 'number' && typeof c.lon === 'number' && onSelect) {
      el.addEventListener('click', () => onSelect(c));
    } else {
      el.classList.add('no-loc');
    }
    cardsEl.appendChild(el);
  }
  // AI 生成物であることの免責はリスト末尾に 1 つだけ（カードごとには出さない）。
  cardsEl.insertAdjacentHTML('beforeend', aiDisclaimerHtml({ model: b.model, generatedAt: b.updated }));
  return { count: briefCards(brief).length };
}
