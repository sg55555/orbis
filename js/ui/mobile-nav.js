// モバイル用ボトムシート・ナビ。globe を全画面の主役にし、LAYERS/FEED をシートで出す。
// main.js から import されない独立モジュール（index.html が末尾で読み込む）。
// DOM のクラス/属性操作だけで完結し、アプリ状態（snapshots/ENABLED/overlay）に依存しない。

// 現在開いているシート(current)とタップされたタブ(clicked)から次状態を返す。
// 同じ → 閉じる(null)。違う → 切替(相互排他)。
export function nextSheet(current, clicked) {
  return current === clicked ? null : clicked;
}

// #media が表示対象(display:none でない)かつ未だ画面内に入っていないなら導線を出す。
export function shouldShowMediaHint(mediaExists, mediaInView) {
  return mediaExists && !mediaInView;
}

// シート名 → 対応パネル要素 id（DOM 非依存・純粋）。
export function sheetPanelId(sheet) {
  return { layers: 'panel', feed: 'feed', legend: 'legend' }[sheet] || null;
}

// DOM 結線。クラス/属性操作だけで開閉する（アプリ状態に非依存）。
export function initMobileNav(doc = document) {
  const body = doc.body;
  const tabs = doc.getElementById('mobile-tabs');
  if (!tabs) return; // タブが無ければ何もしない（防御的）
  const scrim = doc.getElementById('sheet-scrim');
  const hint = doc.getElementById('media-hint');
  const media = doc.getElementById('media');
  const tabBtns = Array.from(tabs.querySelectorAll('.mobile-tab'));

  const current = () => {
    const v = body.getAttribute('data-sheet');
    return (v === 'layers' || v === 'feed' || v === 'legend') ? v : null;
  };

  function setSheet(next) {
    body.setAttribute('data-sheet', next || 'none');
    tabBtns.forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.sheet === next)));
    if (next) {
      const panelEl = doc.getElementById(sheetPanelId(next));
      const focusable = panelEl && (panelEl.querySelector('input, button, [tabindex]') || panelEl);
      if (focusable && focusable.focus) focusable.focus({ preventScroll: true });
    }
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => setSheet(nextSheet(current(), btn.dataset.sheet)));
  });
  if (scrim) scrim.addEventListener('click', () => setSheet(null));
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current()) setSheet(null); });

  // 下スワイプで閉じる（開いている間のみ）
  let touchY = null;
  body.addEventListener('touchstart', (e) => { if (current()) touchY = e.touches[0].clientY; }, { passive: true });
  body.addEventListener('touchend', (e) => {
    if (touchY == null) return;
    if (e.changedTouches[0].clientY - touchY > 60) setSheet(null);
    touchY = null;
  }, { passive: true });

  // ▼ メディア導線：media が存在する時のみ。画面内に入ったら隠す。
  const mediaExists = !!media && (typeof getComputedStyle === 'undefined' || getComputedStyle(media).display !== 'none');
  if (hint && media && mediaExists) {
    hint.addEventListener('click', () => media.scrollIntoView({ behavior: 'smooth' }));
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((ents) => {
        hint.classList.toggle('hidden', !shouldShowMediaHint(true, ents[0].isIntersecting));
      }, { threshold: 0.1 });
      io.observe(media);
    }
  } else if (hint) {
    hint.classList.add('hidden');
  }

  // ブレークポイント跨ぎ：デスクトップ幅へ戻ったらシート状態をリセット（開きっぱなし防止）
  if (typeof matchMedia !== 'undefined') {
    const mq = matchMedia('(max-width: 768px)');
    const onChange = () => { if (!mq.matches) setSheet(null); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  setSheet(null); // 既定は閉（globe 全画面）
}

// 自動初期化（ブラウザのみ）。module script は defer 相当で DOM 準備後に実行される。
// node:test では document が無いので実行されない（純粋関数の import は安全）。
if (typeof document !== 'undefined' && document.getElementById('mobile-tabs')) {
  initMobileNav(document);
}
