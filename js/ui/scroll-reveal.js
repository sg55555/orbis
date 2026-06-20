// 下部セクションのスクロール演出（初回 intersect で fade+rise・1回限り）。
// 設計上の安全策:
//  - JS は `body.reveal-ready` を付け、対象に `.reveal`/`.revealed` を付与するだけ。
//  - 初期非表示(opacity:0)は CSS 側で `body.sec-on.reveal-ready .reveal` のときだけ適用。
//    → JS が走らない/失敗すると reveal-ready が付かず、セクションは常時表示（content 消失しない）。
//    → ?sec=off のときは CSS が反応しないので .reveal は無害（演出なし）。
//  - reduced-motion は CSS 側で transform を無効化（このモジュールは class 付与のみ）。
// main.js の body クラス付与タイミングに依存しない（CSS が sec 状態を判定）ため、ここでは sec を見ない。

(function () {
  const body = document.body;
  if (!body) return;
  const targets = ['#media', '#ai-brief', '#instability']
    .map((s) => document.querySelector(s))
    .filter(Boolean);
  if (!targets.length) return;

  body.classList.add('reveal-ready');
  targets.forEach((el) => el.classList.add('reveal'));

  const reveal = (el) => el.classList.add('revealed');

  if (typeof IntersectionObserver !== 'function') {
    targets.forEach(reveal); // 監視不可環境は即表示
    return;
  }
  const io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (e.isIntersecting) { reveal(e.target); obs.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
  targets.forEach((el) => io.observe(el));
})();
