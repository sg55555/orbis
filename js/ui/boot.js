// js/ui/boot.js — 起動画面（#loading 内）の canvas FX ＋ テレメトリ点呼 ＋ handoff 制御。
// 採用＝③ 1+2 融合（globe 主導）。?boot=1|2|3|12 / ?bootmin=ms / ?bv=a|b で実機調整可。
// canvas=星屑/粒子収束/経緯線globe/大気ハロ/データ点/レーダー、DOM=ワードマーク/テレメトリ/リング/バー。
import {
  clamp, ease, project, bootFeeds, currentBootVariant, bootMinMs, remainingHold, progressFor, bootVersion,
} from '../lib/boot-fx.js';

const VARIANTS = {
  '1':  { globe: 'hero',       telem: null,   bar: 'shimmer', sub: '地球を生成しています…',       radar: false },
  '2':  { globe: 'silhouette', telem: 'full', bar: 'fill',    sub: '観測網を起動しています…',       radar: true  },
  '12': { globe: 'hero',       telem: 'slim', bar: 'fill',    sub: '世界リアルタイム監視 — 起動中', radar: false },
  '3':  { globe: null,         telem: null,   bar: 'shimmer', sub: '世界リアルタイム監視 — 起動中', radar: false },
};

// チューニング A/B。a=原案（現状）/ b=新案（globe大きめ・ゆっくり・色味リッチ・大気強め）。
const TUNE = {
  a: { rHero: 0.17, rSil: 0.19, cyHero: 0.43, cySil: 0.40, speed: 1.0, minMs: 2400, rot: 0.18,
       atmo: 0.28, atmoR: 1.22, bodyTopA: 0.42, bodyBotA: 0.34, wire: '90,200,255',
       dotA: '#eafaff', dotB: '#5effc8', purple: 0 },
  b: { rHero: 0.24, rSil: 0.21, cyHero: 0.46, cySil: 0.42, speed: 1.45, minMs: 3200, rot: 0.11,
       atmo: 0.36, atmoR: 1.30, bodyTopA: 0.50, bodyBotA: 0.42, wire: '120,212,255',
       dotA: '#eafaff', dotB: '#ffd98a', purple: 0.12 },
};

export function initBoot(opts) {
  const reduced = !!(opts && opts.reduced);
  const variant = currentBootVariant();
  const cfg = VARIANTS[variant] || VARIANTS['12'];
  const ver = bootVersion();
  const tune = TUNE[ver] || TUNE.b;
  const sc = tune.speed;
  const hasBootmin = /[?&]bootmin=\d/.test(typeof location !== 'undefined' ? location.search : '');
  const minMs = reduced ? 0 : (hasBootmin ? bootMinMs() : tune.minMs);

  const loading = document.getElementById('loading');
  const fx = document.getElementById('boot-fx');
  const telemEl = document.getElementById('boot-telemetry');
  const barEl = document.getElementById('boot-bar');
  const subEl = document.getElementById('boot-sub');
  const ctx = fx ? fx.getContext('2d') : null;
  if (!loading || !fx || !ctx) return { requestHandoff() {}, destroy() {} };

  loading.setAttribute('data-variant', variant);
  loading.setAttribute('data-bv', ver);
  if (subEl) subEl.textContent = cfg.sub || '';
  if (barEl) barEl.className = 'boot-bar ' + (cfg.bar || 'shimmer');

  const sil = cfg.globe === 'silhouette';
  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0, stars = [], parts = [], dots = [];
  const rand = (a, b) => a + Math.random() * (b - a);

  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    fx.width = W * DPR; fx.height = H * DPR;
    fx.style.width = W + 'px'; fx.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W * 0.5;
    cy = H * (sil ? tune.cySil : tune.cyHero);
    R = Math.min(W, H) * (sil ? tune.rSil : tune.rHero);
  }

  function gen() {
    stars = [];
    const n = Math.min(280, Math.round(W * H * 0.00020));
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: rand(0.4, 1.5),
        a: rand(0.25, 0.85), tw: rand(0, Math.PI * 2), sp: rand(0.5, 1.4) });
    }
    parts = [];
    if (cfg.globe) {
      const Rmax = Math.hypot(W, H) / 2;
      for (let j = 0; j < 150; j++) {
        parts.push({ ang: rand(0, Math.PI * 2), startR: rand(1.25, 2.0) * Rmax,
          swirl: rand(-0.5, 0.5), targetR: R * rand(0.94, 1.0), delay: rand(0, 320), seed: Math.random() });
      }
    }
    dots = [];
    if (cfg.globe) {
      for (let k = 0; k < 90; k++) {
        dots.push({ lat: rand(-78, 78), lon: rand(-180, 180), tw: rand(0, Math.PI * 2), sp: rand(0.6, 1.6) });
      }
    }
  }

  function drawStars(t) {
    for (const s of stars) {
      const a = reduced ? s.a : s.a * (0.55 + 0.45 * Math.sin(t / 1000 * s.sp + s.tw));
      ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = '#cfe0f5';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawConverge(t) {
    for (const p of parts) {
      const pc = ease(t, p.delay * sc, (p.delay + 950) * sc);
      if (pc <= 0) continue;
      const sm = pc * pc * (3 - 2 * pc);
      const rr = p.startR + (p.targetR - p.startR) * sm;
      const aa = p.ang + p.swirl * sm;
      ctx.globalAlpha = clamp(Math.sin(pc * Math.PI) * 0.9, 0, 1);
      ctx.fillStyle = p.seed > 0.5 ? '#9fe6ff' : '#cbb6ff';
      ctx.beginPath(); ctx.arc(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawArc(fn, a, b, step, alpha) {
    let pen = false;
    for (let s = a; s <= b + 0.001; s += step) {
      const q = fn(s);
      if (q.z > 0.02) {
        ctx.strokeStyle = 'rgba(' + tune.wire + ',' + clamp(q.z * 1.4, 0, 1) * alpha + ')';
        if (!pen) { ctx.beginPath(); ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y);
      } else if (pen) { ctx.stroke(); pen = false; }
    }
    if (pen) ctx.stroke();
  }

  function drawGlobe(p, rot, tilt) {
    if (p <= 0) return;
    const latLimit = 6 + p * 90;
    const topA = p * (sil ? 0.32 : tune.bodyTopA);
    const botA = p * (sil ? 0.50 : tune.bodyBotA);
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, 'rgba(34,84,140,' + topA + ')');
    g.addColorStop(1, 'rgba(8,18,38,' + botA + ')');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    if (tune.purple > 0 && !sil) {
      const pg = ctx.createRadialGradient(cx + R * 0.25, cy + R * 0.2, R * 0.1, cx, cy, R * 1.05);
      pg.addColorStop(0, 'rgba(150,110,255,' + (p * tune.purple) + ')');
      pg.addColorStop(1, 'rgba(150,110,255,0)');
      ctx.fillStyle = pg; ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 1;
    const base = sil ? 0.32 : 0.62;
    for (let lon = -180; lon < 180; lon += 30) {
      drawArc((s) => project(s, lon, rot, tilt, R, cx, cy), -latLimit, latLimit, 5, p * base);
    }
    for (const lat of [-60, -30, 0, 30, 60]) {
      if (Math.abs(lat) > latLimit) continue;
      drawArc((s) => project(lat, s, rot, tilt, R, cx, cy), -180, 180, 5, p * base * (lat === 0 ? 1.15 : 1));
    }
  }

  function drawAtmo(p, t) {
    if (p <= 0) return;
    const pulse = reduced ? 1 : (0.92 + 0.08 * Math.sin(t / 700));
    const r1 = R * tune.atmoR * pulse;
    const g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, r1);
    g.addColorStop(0, 'rgba(57,208,255,0)');
    g.addColorStop(0.35, 'rgba(57,208,255,' + (tune.atmo * p) + ')');
    g.addColorStop(1, 'rgba(57,208,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r1, 0, Math.PI * 2); ctx.fill();
  }

  function drawDots(p, t, rot, tilt) {
    if (p <= 0) return;
    dots.forEach((d, i) => {
      const q = project(d.lat, d.lon, rot, tilt, R, cx, cy);
      if (q.z <= 0.05) return;
      const tw = reduced ? 0.8 : (0.45 + 0.55 * Math.sin(t / 1000 * d.sp + d.tw));
      ctx.globalAlpha = clamp(p * tw * clamp(q.z * 1.3, 0, 1), 0, 1);
      ctx.fillStyle = i % 4 === 0 ? tune.dotA : tune.dotB;
      ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawRadar(t) {
    const ang = (t / 1000) * 1.4;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    grad.addColorStop(0, 'rgba(57,208,255,0.28)'); grad.addColorStop(1, 'rgba(57,208,255,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ang - 0.5, ang); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,230,255,0.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.stroke();
    ctx.restore();
    const ping = (t % 2200) / 2200;
    ctx.globalAlpha = clamp(1 - ping, 0, 1) * 0.6;
    ctx.strokeStyle = 'rgba(57,208,255,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * (0.2 + ping * 0.85), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- テレメトリ ----
  const timers = [];
  function after(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function rowEl(nm, st) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="nm">' + nm + '</span><span class="dots">'
      + '·'.repeat(40) + '</span><span class="st">' + (st || '') + '</span>';
    telemEl.appendChild(li); return li;
  }
  function setProgress(done, total) {
    if (cfg.bar === 'fill' && barEl) barEl.style.setProperty('--p', Math.round(progressFor(done, total) * 100) + '%');
  }
  function runTelemetry() {
    if (!telemEl) return;
    const feeds = bootFeeds(variant);
    const slim = cfg.telem === 'slim';
    const revealStart = (slim ? 900 : 650) * sc, step = (slim ? 240 : 300) * sc, okDelay = (slim ? 200 : 230) * sc;
    let done = 0;
    feeds.forEach((f, i) => {
      const reveal = () => {
        const li = rowEl(f[0], slim ? '' : f[1]);
        requestAnimationFrame(() => li.classList.add('in'));
        const mark = () => {
          li.classList.add('ok');
          li.querySelector('.st').textContent = (slim ? '' : f[1] + ' ') + '✓';
          done++; setProgress(done, feeds.length);
        };
        if (reduced) mark(); else after(okDelay, mark);
      };
      if (reduced) reveal(); else after(revealStart + i * step, reveal);
    });
    if (cfg.telem === 'full') {
      const at = revealStart + (feeds.length - 1) * step + okDelay + 300 * sc;
      const online = () => { const li = rowEl('', ''); li.className = 'online'; li.textContent = '観測網 オンライン';
        requestAnimationFrame(() => li.classList.add('in')); };
      if (reduced) online(); else after(at, online);
    }
  }

  // ---- ループ / handoff ----
  let raf = 0, running = true, handed = false;
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

  function frame(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    drawStars(t);
    if (cfg.globe) {
      const rot = t / 1000 * tune.rot, tilt = -0.36;
      drawConverge(t);
      drawGlobe(ease(t, 600 * sc, 1900 * sc), rot, tilt);
      if (cfg.radar) drawRadar(t);
      drawAtmo(ease(t, 1600 * sc, 2500 * sc), t);
      drawDots(ease(t, 2100 * sc, 2900 * sc), t, rot, tilt);
    }
    if (running) raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
    ctx.clearRect(0, 0, W, H); drawStars(3000);
    if (cfg.globe) { drawGlobe(1, 0.6, -0.36); drawAtmo(1, 3000); drawDots(1, 3000, 0.6, -0.36); }
  }

  layout(); gen();
  if (cfg.telem) runTelemetry();
  if (reduced) { drawStatic(); running = false; } else raf = requestAnimationFrame(frame);
  window.addEventListener('resize', () => { layout(); gen(); }, { passive: true });

  function destroy() { running = false; cancelAnimationFrame(raf); timers.forEach(clearTimeout); }
  function doHandoff() {
    loading.classList.add('hidden');
    setTimeout(destroy, 700); // .6s フェード後に rAF/timer 停止
  }
  function requestHandoff() {
    if (handed) return; handed = true;
    const elapsed = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
    after(remainingHold(elapsed, minMs), doHandoff);
  }
  return { requestHandoff, destroy };
}
