// 星空。生成（純粋）と描画（canvas）を分離。星は一度だけ生成し再乱数しない。
// リッチ化: 微細な明滅（twinkle）と稀な流れ星を rAF で描く。reduced-motion では静止描画。

import { immerseSpace } from './immerse.js';

// 星数の上限は level で段階引き上げ（4K で効く・FHD/HD は cap 未満で不変）。
// off=現状の600。density は従来値を維持（面積比例の係数）。
const STAR_CAP = { off: 600, 1: 760, 2: 900, 3: 1100 };
export function starCount(w, h, level = 'off', density = 0.00018) {
  const cap = STAR_CAP[level] || STAR_CAP.off;
  return Math.min(cap, Math.round(w * h * density));
}

// 微粒子ダスト（globe 周辺を漂う極小の塵）。level で個数を連動。
const DUST_COUNT = { off: 0, 1: 18, 2: 32, 3: 48 };
export function dustCount(level = 'off') {
  return Object.prototype.hasOwnProperty.call(DUST_COUNT, level) ? DUST_COUNT[level] : 0;
}

export function generateDust(count, w, h, rng = Math.random) {
  const dust = [];
  for (let i = 0; i < count; i++) {
    dust.push({
      x: rng() * w,
      y: rng() * h,
      r: 0.3 + rng() * 0.5,
      vx: (rng() - 0.5) * 0.018, // ±0.009 px/ms 程度の極低速
      vy: (rng() - 0.5) * 0.018,
      alpha: 0.05 + rng() * 0.13,
    });
  }
  return dust;
}

// dt(ms) ぶんドリフトさせ、画面外に出たら反対側へラップ（in-place・テスト可能）。
export function stepDust(dust, dt, w, h) {
  for (const d of dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.x = ((d.x % w) + w) % w; // 負も正も [0,w) にラップ
    d.y = ((d.y % h) + h) % h;
  }
  return dust;
}

// rng: () => [0,1) の関数（テストでは seeded を注入）。
// tw/sp は明滅の位相と速度（描画時にのみ使用。基準 alpha は変えない）。
// brightRatio>0 で一部を「明るい星」に（奥行き）。brightRatio=0 は既存挙動（rng 消費順・レンジ不変）。
export function generateStars(count, w, h, rng = Math.random, brightRatio = 0) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    const bright = brightRatio > 0 && rng() < brightRatio; // 0 なら短絡＝rng 消費なし
    stars.push({
      x: rng() * w,
      y: rng() * h,
      r: bright ? 1.3 + rng() * 0.9 : 0.4 + rng() * 1.1,
      alpha: bright ? 0.75 + rng() * 0.25 : 0.25 + rng() * 0.6,
      tw: rng() * Math.PI * 2,   // 明滅の初期位相
      sp: 0.4 + rng() * 1.2,     // 明滅の速度
      bright,
    });
  }
  return stars;
}

// canvas に星を静止描画（reduced-motion・非対応時のフォールバック）。bright はグロー付き。
export function drawStars(canvas, stars) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of stars) {
    drawStar(ctx, s, s.alpha);
  }
  ctx.globalAlpha = 1;
}

// 1つの星を描く。bright は外周に淡いグロー（二重 arc・shadowBlur を使わず安価）。
function drawStar(ctx, s, alpha) {
  if (s.bright) {
    ctx.globalAlpha = Math.max(0, alpha * 0.35);
    ctx.fillStyle = '#bcd8ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = s.bright ? '#eaf3ff' : '#cfe0f5';
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fill();
}

// ダストを描く（極淡）。
function drawDust(ctx, dust) {
  if (!ctx) return;
  ctx.fillStyle = '#9fb6d8';
  for (const d of dust) {
    ctx.globalAlpha = d.alpha;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// 流れ星を1つ生成（画面上部から斜め下へ）。
function spawnShoot(w, h) {
  const ang = Math.PI * (0.13 + Math.random() * 0.14); // 緩い下向き
  const spd = 0.28 + Math.random() * 0.22;             // px/ms
  return {
    x: Math.random() * w * 0.85,
    y: Math.random() * h * 0.45,
    vx: Math.cos(ang) * spd,
    vy: Math.sin(ang) * spd,
    life: 520 + Math.random() * 320,
    max: 0,
  };
}

// canvas を要素サイズに合わせ、星＋ダストを生成してアニメーション描画する。
// level は immerseSpace を自己読み（main.js 非編集）。opts.level でテスト時に上書き可能。
// opts.reduced=true で静止描画。canvas ごとに一度だけ呼ぶこと。
export function mountStarfield(canvas, opts = {}) {
  const {
    density = 0.00018,
    reduced = false,
    level = immerseSpace(typeof location !== 'undefined' ? location.search : ''),
  } = opts;
  const ctx = canvas.getContext('2d');
  const brightRatio = level === 'off' ? 0 : 0.08;
  let stars = [];
  let dust = [];
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = w; canvas.height = h;
    stars = generateStars(starCount(w, h, level, density), w, h, Math.random, brightRatio);
    dust = generateDust(dustCount(level), w, h);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  if (reduced || !ctx) {
    drawStars(canvas, stars); // 星（bright 含む）静止
    drawDust(ctx, dust);      // ダスト静止（ctx 無しは drawDust 内で no-op）
    return stars;
  }

  let shooting = [];
  let last = performance.now();
  let nextShoot = 2500 + Math.random() * 4000;

  function frame(now) {
    const dt = Math.min(50, now - last); last = now;
    const t = now / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ダスト（背面・極淡・ドリフト）
    stepDust(dust, dt, canvas.width, canvas.height);
    drawDust(ctx, dust);

    // 星の明滅（bright はグロー）
    for (const s of stars) {
      let a = s.alpha * (0.55 + 0.45 * Math.sin(t * s.sp + s.tw));
      if (a < 0) a = 0;
      drawStar(ctx, s, a);
    }

    // 流れ星（同時に最大2本・低頻度）
    nextShoot -= dt;
    if (nextShoot <= 0 && shooting.length < 2) {
      const m = spawnShoot(canvas.width, canvas.height);
      m.max = m.life;
      shooting.push(m);
      nextShoot = 6000 + Math.random() * 10000;
    }
    for (const m of shooting) {
      m.life -= dt; m.x += m.vx * dt; m.y += m.vy * dt;
      const len = 64;
      const tx = m.x - m.vx * len, ty = m.y - m.vy * len;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, 'rgba(190,224,255,0.95)');
      g.addColorStop(1, 'rgba(190,224,255,0)');
      ctx.globalAlpha = Math.max(0, Math.min(1, m.life / (m.max || 1)));
      ctx.strokeStyle = g; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
    }
    shooting = shooting.filter((m) => m.life > 0);

    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return stars;
}
