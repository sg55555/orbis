// YouTube IFrame Player API のロードと、日本語自動翻訳字幕の強制。
// 注: 字幕モジュールへの setOption は YouTube の仕様外（非公式）で、近年の変更で
// 効かない場合がある。効けば日本語自動翻訳、ダメでも埋め込みの cc 字幕（多くは英語）に
// フォールバックする＝退行しないベストエフォート。実表示は headless で検証不可。

let apiPromise = null;

// IFrame Player API を1度だけ読み込み、YT を resolve。window 無し（node）では null。
export function loadYtApi() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve(null);
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') { try { prev(); } catch { /* noop */ } }
      resolve(window.YT);
    };
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
  return apiPromise;
}

// 字幕モジュールに渡す「日本語自動翻訳トラック」ペイロード（純粋・テスト可能）。
export function jaCaptionOption() {
  return { translationLanguage: { languageCode: 'ja', languageName: 'Japanese' } };
}

// player に日本語自動翻訳字幕を要求（防御的・効かなくても例外を出さない）。
// モジュール名は実装差があるため 'captions' と 'cc' の両方に投げる。
export function forceJaCaptions(player) {
  if (!player || typeof player.setOption !== 'function') return;
  const opt = jaCaptionOption();
  for (const mod of ['captions', 'cc']) {
    try { if (typeof player.loadModule === 'function') player.loadModule(mod); } catch { /* noop */ }
    try { player.setOption(mod, 'track', opt); } catch { /* noop */ }
  }
}
