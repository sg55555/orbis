// 軽量星空。生成（純粋）と描画（canvas）を分離。星は一度だけ生成し再乱数しない。

// rng: () => [0,1) の関数（テストでは seeded を注入）。
export function generateStars(count, w, h, rng = Math.random) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rng() * w,
      y: rng() * h,
      r: 0.4 + rng() * 1.1,
      alpha: 0.25 + rng() * 0.6,
    });
  }
  return stars;
}

// canvas に星を描画（ブラウザのみ）。呼び出し側でリサイズ時に再 draw する。
export function drawStars(canvas, stars) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of stars) {
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = '#cfe0f5';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// canvas を要素サイズに合わせ、星を生成して描く。返り値は初期状態の星配列スナップショット
// （リサイズは内部で自動再描画される）。呼び出し側は canvas ごとに一度だけ呼ぶこと
// （複数回呼ぶと resize リスナーが重複する）。
export function mountStarfield(canvas, density = 0.00018) {
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = w; canvas.height = h;
    const count = Math.min(600, Math.round(w * h * density));
    const stars = generateStars(count, w, h); // 一度生成
    drawStars(canvas, stars);
    return stars;
  };
  let stars = resize();
  window.addEventListener('resize', () => { stars = resize(); }, { passive: true });
  return stars;
}
