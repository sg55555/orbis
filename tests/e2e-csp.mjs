#!/usr/bin/env node
// tests/e2e-csp.mjs — 本番と同じヘッダー/ルーティング下で Orbis を実ブラウザに載せる受入 e2e。
//
//   1) tests/harness/serve.py を spawn（vercel.json の builds/routes を tests/vercel_routes.py で
//      評価して配信＝CSP・Cache-Control・308・catch-all 404 まで本番と同じ）
//   2) PC 1280×900 とモバイル 390×844 で ?data=github&e2e=1 を開き spec §4-4 の操作を通す
//      → CSP 違反 0・pageerror 0・自オリジンの console.error 0・自オリジンの 4xx/5xx 0
//   3) 能力アサート（deck.MapboxOverlay・maplibregl canvas・globe 投影・TripsLayer の遅延ロード）
//   4) 表示の正直さ（#brief-fresh / #ins-fresh / #fc-fresh が非空かつ is-stale）と data-style の正の確認
//   5) ルーティング（404・clean URL・308・配信外 404・Cache-Control 4 段）
//   6) negative control＝<style> 注入と setAttribute('style') で違反が「増える」こと
//      （増えないなら CSP が enforce されていない＝1〜5 の緑に意味が無い）
//
// 実行（cwd＝リポジトリルート）:
//   NOULIMIT=1 node tests/e2e-csp.mjs
//   ※ 行頭の NOULIMIT=1 は必須。Bash hook の `ulimit -v` の下では Chromium が起動できない。
//
// RED（negative control が本当に効いているかの確認・落ちるのが正しい）:
//   CSP_OVERRIDE="… style-src 'self' 'unsafe-inline' …" NOULIMIT=1 node tests/e2e-csp.mjs
//
// 環境変数: E2E_PORT（既定 8790）／E2E_ROOT（既定 cwd）／CSP_OVERRIDE（ハーネスへ素通し）
//
// 注意: `waitUntil: 'networkidle'` は使わない。ニュースの YouTube ライブ配信が流れ続けて
// 永遠に idle にならないため、domcontentloaded ＋ 明示的な waitForFunction で待つ。

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const PW_ESM = '/home/shugo/node_modules/playwright/index.mjs';
const PW_CJS = '/home/shugo/node_modules/playwright/index.js';
const { chromium } = existsSync(PW_ESM)
  ? await import(PW_ESM)
  : createRequire(import.meta.url)(PW_CJS);

const ROOT = resolve(process.env.E2E_ROOT || process.cwd());
const PORT = Number(process.env.E2E_PORT || 8790);
const BASE = `http://127.0.0.1:${PORT}`;
// ?data=github＝本番データ（raw.githubusercontent.com/sg55555/orbis-data・読み取りのみ）。
// ?e2e=1＝main.js が window.__orbis = { map } を公開する（能力アサート用のフック）。
const APP = `${BASE}/?data=github&e2e=1`;
const CSP_OVERRIDE = process.env.CSP_OVERRIDE || '';

// 良性の console.error。Permissions-Policy 既定（compute-pressure 等）と headless の
// ソフトウェア GPU 由来で、CSP とは無関係（2026-09-03 の RED 計測で実測・scratchpad/csp-red.md §3）。
const BENIGN_CONSOLE = [
  /Permissions policy violation/i,
  /WebGL|WebGPU|SwiftShader|GL Driver|No available adapters|Automatic fallback to software/i,
];

// 期待本文の比較元（ルーティングの 404/clean URL を「文言」でなく「同一ファイル」で見る）
const FILES = {
  '404.html': readFileSync(join(ROOT, '404.html'), 'utf8'),
  'about.html': readFileSync(join(ROOT, 'about.html'), 'utf8'),
};

let checks = 0;
let failures = 0;
function assert(cond, msg) {
  checks++;
  if (cond) console.log('ok  :', msg);
  else { failures++; console.error('FAIL:', msg); }
}
const warn = (msg) => console.warn('warn:', msg);

// ── ハーネス起動 ──────────────────────────────────────────────────
const harnessArgs = ['tests/harness/serve.py', '--port', String(PORT)];
if (CSP_OVERRIDE) harnessArgs.push('--csp-override', CSP_OVERRIDE);
const server = spawn('python3', harnessArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const serverLog = [];
server.stdout.on('data', (b) => serverLog.push(String(b)));
server.stderr.on('data', (b) => serverLog.push(String(b)));
server.on('error', (e) => serverLog.push(`spawn error: ${String(e && e.message)}\n`));
let harnessExited = null;
server.on('exit', (code, sig) => {
  harnessExited = `harness が起動直後に終了した (code=${code} sig=${sig})`;
});

// 「その port が 200 を返すか」だけを見てはいけない。PORT に先客がいると serve.py は
// bind に失敗して即死するのに、先客が 200 を返すので待機ループは抜けてしまい、e2e は
// **別のツリー**（別 worktree の vercel.json・別の --csp-override）に対して緑になる。
// closure.sh はその緑で .closure-ok に HEAD を書く＝受入ゲートの false-green。
// 並行 worktree 運用が既定なので現実に起こりうる。
// そこで「自分が spawn したプロセスが bind に成功した」ことを起動バナーで確かめてから
// 応答を待つ（バナーは make_server() の後＝bind 成功後にしか出ない）。
// exit の検知だけでは足りない: 先客は即座に 200 を返すので、python の終了イベントが
// 届く前に待機ループを抜けてしまう競合がある。
const HARNESS_BANNER = 'orbis harness: http://';

async function waitForHarness(ms = 20000) {
  const t0 = Date.now();
  const fail = (why) => new Error(`${why}:\n${serverLog.join('')}`);

  // ① 自分の子プロセスが listen したことの確認
  for (;;) {
    if (serverLog.join('').includes(HARNESS_BANNER)) break;
    if (harnessExited) throw fail(harnessExited);
    if (Date.now() - t0 > ms) throw fail(`ハーネスが ${ms}ms で起動バナーを出さなかった`);
    await new Promise((r) => setTimeout(r, 100));
  }

  // ② 実際に応答を返すまで待つ
  for (;;) {
    if (harnessExited) throw fail(harnessExited);
    try {
      const r = await fetch(`${BASE}/`, { redirect: 'manual' });
      await r.arrayBuffer();                       // undici の接続を確実に解放する
      if (r.status === 200) return;
    } catch { /* 起動待ち */ }
    if (Date.now() - t0 > ms) {
      throw fail(`ハーネスが ${ms}ms で起動しなかった`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ── ページ生成（違反・例外・4xx コレクタ付き）──────────────────────
async function newPage(viewport) {
  const ctx = await browser.newContext({
    serviceWorkers: 'block',     // SW が応答を差し替えると CSP の観測が濁る
    timezoneId: 'Asia/Tokyo',
    locale: 'ja-JP',
    viewport,
  });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  const bag = { errs: [], consoleErrs: [], bad: [] };
  page.on('pageerror', (e) =>
    bag.errs.push(String((e && e.stack) || (e && e.message) || e).slice(0, 400)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    bag.consoleErrs.push({ text: m.text().slice(0, 300), url: loc.url || '' });
  });
  page.on('response', (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400) bag.bad.push(`${r.status()} ${r.url()}`);
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  // addInitScript は全フレームで走るが window はフレームごとに別。page.evaluate は
  // メインフレームで動くので、ここに集まるのはトップ文書の違反だけ（YouTube iframe の
  // 内部 CSP 違反は混ざらない）。
  await page.addInitScript(() => {
    window.__cspv = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspv.push({
        d: e.effectiveDirective || e.violatedDirective,
        blocked: e.blockedURI,
        src: String(e.sourceFile || '').replace(/^https?:\/\/[^/]+/, ''),
        line: e.lineNumber || 0,
        sample: String(e.sample || '').slice(0, 80),
      });
    });
  });
  return { ctx, page, bag };
}

const cspv = (page) => page.evaluate(() => (window.__cspv || []).slice());

function summarize(v) {
  const m = new Map();
  for (const x of v) {
    const k = `${x.d} <- ${x.blocked} @${x.src}:${x.line}${x.sample ? ` 例:${x.sample}` : ''}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`);
}

async function assertClean(page, bag, label) {
  const v = await cspv(page);
  if (v.length) {
    console.error(`  ${label} の CSP 違反 ${v.length} 件（多い順・上位 12）:`);
    for (const line of summarize(v).slice(0, 12)) console.error('   - ' + line);
  }
  assert(v.length === 0, `${label}: CSP 違反 0（実測 ${v.length}）`);

  if (bag.errs.length) {
    console.error(`  ${label} の pageerror:`);
    for (const e of bag.errs) console.error('   - ' + e);
  }
  assert(bag.errs.length === 0, `${label}: pageerror 0（実測 ${bag.errs.length}）`);

  // 自オリジン由来だけを見る（YouTube iframe 内のログは対象外）。既知の良性は除く。
  const own = bag.consoleErrs
    .filter((c) => c.url.startsWith(BASE))
    .filter((c) => !BENIGN_CONSOLE.some((re) => re.test(c.text)));
  if (own.length) {
    console.error(`  ${label} の console.error（自オリジン）:`);
    for (const c of own) console.error(`   - ${c.text} @${c.url}`);
  }
  assert(own.length === 0, `${label}: 自オリジンの console.error 0（実測 ${own.length}）`);

  if (bag.bad.length) {
    console.error(`  ${label} の 4xx/5xx（自オリジン）:`);
    for (const b of bag.bad) console.error('   - ' + b);
  }
  assert(bag.bad.length === 0, `${label}: 自オリジンの 4xx/5xx 0（実測 ${bag.bad.length}）`);
}

// ── 操作ヘルパ（無い要素は warn してスキップ＝実装差分ではなく退行だけを落とす）──
async function tap(page, selector, label, { nth = 0, timeout = 4000, settle = 900 } = {}) {
  const all = page.locator(selector);
  if ((await all.count()) <= nth) { warn(`${label}: ${selector} が見つからない（スキップ）`); return false; }
  try {
    const loc = all.nth(nth);
    await loc.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await loc.click({ timeout });
    await page.waitForTimeout(settle);
    return true;
  } catch (e) {
    warn(`${label}: クリックできなかった（${String((e && e.message) || e).split('\n')[0].slice(0, 140)}）`);
    return false;
  }
}

async function bootApp(page, label) {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!(window.__orbis && window.__orbis.map), null, { timeout: 30000 });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
  // ?data=github の実データ到着（フィード行が出れば snapshot が届いている）
  await page.waitForFunction(
    () => document.querySelectorAll('#feed-rows .feed-row').length > 0, null, { timeout: 45000 },
  ).catch(() => warn(`${label}: フィード行が 45s で出なかった（raw の遅延）`));
  await page.waitForTimeout(3000);   // AI 3 層・メディアの初期描画が落ち着くまで
}

async function search(page, label) {
  const input = page.locator('#search-input');
  if ((await input.count()) === 0) { warn(`${label}: #search-input が無い（スキップ）`); return false; }
  try {
    await input.click({ timeout: 4000 });
    await input.fill('東京');
    await page.waitForSelector('#search-results .search-opt', { timeout: 5000 });
    await page.locator('#search-results .search-opt').first().click({ timeout: 4000 });
    await page.waitForTimeout(2000);     // flyTo（1.5s）の完了待ち
    return true;
  } catch (e) {
    warn(`${label}: 検索『東京』が通らなかった（${String((e && e.message) || e).split('\n')[0].slice(0, 140)}）`);
    return false;
  }
}

// ドリルダウンは map.on('click', cc.handleMapClick) 経由でしか開かない（main.js:527）。
// 検索『東京』で日本の中心へ飛んだ直後に地図の中央をクリックする。
async function drilldown(page, label) {
  const box = await page.locator('#map').boundingBox();
  if (!box) { warn(`${label}: #map が測れない（ドリルダウンをスキップ）`); return false; }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  try {
    await page.waitForSelector('#drilldown:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(2500);      // admin1 の展開・プロフィール描画待ち
    await page.keyboard.press('Escape');  // 以降の操作を邪魔しないよう閉じる
    await page.waitForTimeout(500);
    return true;
  } catch {
    warn(`${label}: 地図クリックでドリルダウンが開かなかった（陸に当たらなかった可能性・スキップ）`);
    return false;
  }
}

// ── ルーティング（page.request＝ブラウザのネットワークスタックで実測）──────
async function checkRouting(page) {
  const get = async (path, readBody = true) => {
    const r = await page.request.get(BASE + path, { maxRedirects: 0, failOnStatusCode: false });
    return { status: r.status(), headers: r.headers(), text: readBody ? await r.text() : '' };
  };

  let r = await get('/nope');
  assert(r.status === 404, `routing: /nope → 404（実測 ${r.status}）`);
  assert(r.text === FILES['404.html'], 'routing: /nope の本文が 404.html と同一');
  assert((r.headers['content-security-policy'] || '').includes("style-src 'self'"),
    'routing: /nope にも CSP が乗る');

  r = await get('/about');
  assert(r.status === 200, `routing: /about → 200（実測 ${r.status}）`);
  assert(r.text === FILES['about.html'], 'routing: /about の本文が about.html と同一');
  assert((r.headers['content-type'] || '').startsWith('text/html'),
    `routing: /about は text/html（実測 ${r.headers['content-type']}）`);

  r = await get('/about.html', false);
  assert(r.status === 308 && r.headers['location'] === '/about',
    `routing: /about.html → 308 /about（実測 ${r.status} ${r.headers['location']}）`);

  r = await get('/index.html', false);
  assert(r.status === 308 && r.headers['location'] === '/',
    `routing: /index.html → 308 /（実測 ${r.status} ${r.headers['location']}）`);

  r = await get('/config/news_feeds.json', false);
  assert(r.status === 404, `routing: /config/news_feeds.json は配信しない（実測 ${r.status}）`);

  r = await get('/README.md', false);
  assert(r.status === 404, `routing: /README.md は配信しない（実測 ${r.status}）`);

  r = await get('/vendor/deck.gl-core-9.3.4.min.js', false);
  assert(r.status === 200, `routing: /vendor/deck.gl-core-9.3.4.min.js → 200（実測 ${r.status}）`);
  assert(r.headers['cache-control'] === 'public, max-age=31536000, immutable',
    `routing: vendor は immutable（実測 ${r.headers['cache-control']}）`);

  r = await get('/data/static/admin1_bbox.json', false);
  assert(r.status === 200, `routing: /data/static/admin1_bbox.json → 200（実測 ${r.status}）`);
  assert(r.headers['cache-control'] === 'public, max-age=3600, stale-while-revalidate=86400',
    `routing: data/static は SWR（実測 ${r.headers['cache-control']}）`);

  r = await get('/robots.txt', false);
  assert(r.status === 200, `routing: /robots.txt → 200（実測 ${r.status}）`);
}

// ── メイン ────────────────────────────────────────────────────────
let browser = null;
try {
  await waitForHarness();

  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  // ── PC 1280×900 ────────────────────────────────────────────────
  {
    const { ctx, page, bag } = await newPage({ width: 1280, height: 900 });
    await bootApp(page, 'PC');

    // フィードの data-style（--chip / --rowcat）は **boot 直後に測る**。
    // プリセット『交通』は表示レイヤーを交通系だけに切り替えるので、その後はフィードの
    // 対象が 0 件になりチップも行も DOM から消える（実測: chips 0 / rows 0）。
    // 後段でまとめて測ると「要素が無いので null」＝data-style の退行と区別できない偽赤になる。
    // アサート自体は下の data-style ブロックで出す（出力の並びを揃えるため）。
    const feedVars = await page.evaluate(() => {
      const chip = document.querySelector('#feed-chips .feed-chip[data-chip]');
      const row = document.querySelector('#feed-rows .feed-row');
      return {
        chip: chip ? getComputedStyle(chip).getPropertyValue('--chip').trim() : null,
        row: row ? getComputedStyle(row).getPropertyValue('--rowcat').trim() : null,
      };
    });

    // 能力アサート（headless の画素は信用しないが「動いているか」は測れる）
    assert(await page.evaluate(() => typeof globalThis.deck?.MapboxOverlay === 'function'),
      'PC: deck.MapboxOverlay が関数（自前配信の deck.gl core+layers+mapbox がロードされた）');
    assert((await page.locator('.maplibregl-canvas').count()) >= 1,
      'PC: .maplibregl-canvas が存在（MapLibre が描画している）');
    const proj = await page.evaluate(() => {
      const m = window.__orbis && window.__orbis.map;
      if (!m) return { err: 'window.__orbis.map が無い（?e2e=1 のフック未実装）' };
      if (typeof m.getProjection !== 'function') return { err: 'map.getProjection が無い' };
      const p = m.getProjection() || {};
      return { type: p.type };
    });
    assert(proj.type === 'globe', `PC: globe 投影（実測 ${proj.err || proj.type}）`);

    // 操作: レイヤートグル・プリセット『交通』・凡例
    await tap(page, '.layer-row', 'PC: レイヤートグル[0]', { nth: 0 });
    await tap(page, '.layer-row', 'PC: レイヤートグル[1]', { nth: 1 });
    const traffic = await tap(page, '.preset-chip[data-preset="traffic"]', 'PC: プリセット『交通』', { settle: 1500 });
    assert(traffic, 'PC: プリセット『交通』をクリックできた');
    if (traffic) {
      // trade（TripsLayer）は @deck.gl/geo-layers。mesh-layers → geo-layers の順に
      // 遅延ロードされる（js/lib/vendor-loader.js）。
      let lazy = true;
      await page.waitForFunction(
        () => typeof globalThis.deck?.TripsLayer === 'function', null, { timeout: 20000 },
      ).catch(() => { lazy = false; });
      assert(lazy, 'PC: 『交通』ON で deck.TripsLayer が遅延ロードされる（mesh-layers → geo-layers）');
    }
    await tap(page, '.legend-collapse', 'PC: 凡例の開閉');
    await tap(page, '.legend-tab[data-tab="help"]', 'PC: 凡例「使い方」タブ');

    // 検索『東京』→候補 → ドリルダウン 1 国（PC のみ）
    await search(page, 'PC');
    await drilldown(page, 'PC');

    // メディア導線（youtube-nocookie の iframe が frame-src で通ることの実測を兼ねる）
    await tap(page, '#media-hint', 'PC: メディアへ移動');
    await tap(page, '.mode-btn[data-mode="1"]', 'PC: カメラ 1 画面');
    await tap(page, '.area-tab', 'PC: カメラのエリアタブ[0]');
    await tap(page, '.mode-btn[data-mode="4"]', 'PC: カメラ 4 画面へ戻す');
    await tap(page, '#news-tabs button', 'PC: ニュースのタブ[0]', { settle: 2000 });
    await tap(page, '#media-cc-toggle', 'PC: 字幕トグル');
    // #lc-toggle（AI 字幕）は getDisplayMedia を要求するので headless では操作しない。

    // frame-src の実測。「CSP 違反 0」だけだと iframe が 1 つも生成されていない場合も
    // 緑になってしまう（黙ったカバレッジ欠落）ので、src が入った iframe の存在と
    // その全てが youtube-nocookie であることを明示的に測る（T8 の nocookie 化の証拠）。
    const frameSrcs = await page.evaluate(() => [...document.querySelectorAll('iframe')]
      .map((f) => f.getAttribute('src') || '').filter((s) => s));
    assert(frameSrcs.length > 0,
      `PC: src の入った iframe が 1 つ以上ある（frame-src を実際に通している・実測 ${frameSrcs.length}）`);
    const notNocookie = frameSrcs.filter((s) => !s.startsWith('https://www.youtube-nocookie.com/embed/'));
    assert(notNocookie.length === 0,
      `PC: iframe の src は全て youtube-nocookie（実測 ${notNocookie.join(' , ') || 'すべて nocookie'}）`);

    // ブリーフィング / 不安定性 / 予測 / 共有 / パネル
    await tap(page, '.brief-card:not(.no-loc)', 'PC: ブリーフィングカード');
    await tap(page, '.ins-row', 'PC: 不安定性ランキング行');
    await tap(page, '.fc-tab', 'PC: 予測タブ[0]');
    await tap(page, '.fc-cardbtn:not([disabled])', 'PC: 予測カード');
    await tap(page, '.fc-log summary', 'PC: 予測の過去ログ');
    await tap(page, '#share-btn', 'PC: 共有ボタン');
    await tap(page, '#panel-toggle', 'PC: レイヤーパネル折りたたみ');
    await tap(page, '#feed-toggle', 'PC: フィードパネル折りたたみ');

    // 表示の正直さ（AI 3 層は 2026-08-23 で停止＝各セクションに「更新停止中」チップが出る）
    // js/main.js:636/648/651… は raw の取得に失敗するとセクションごと display:none にするので、
    // 「セクションが生きている（＝AI データが取れている）のにチップが無い／stale でない」ときだけ赤にする。
    // 外部要因（orbis-data の一時障害・squash 直後）で closure.sh が赤くなるのを避ける暫定措置
    // （Phase B の fixture 化で恒久対応する）。
    await page.waitForFunction(
      () => document.querySelectorAll('.fresh-chip.is-stale').length >= 3, null, { timeout: 20000 },
    ).catch(() => {});
    for (const [sec, chip, name] of [
      ['#ai-brief', '#brief-fresh', 'ブリーフィング'],
      ['#instability', '#ins-fresh', '不安定性'],
      ['#forecasts', '#fc-fresh', '予測'],
    ]) {
      const st = await page.evaluate(([s, c]) => {
        const sectionEl = document.querySelector(s);
        if (!sectionEl) return { missing: 'section' };
        if (getComputedStyle(sectionEl).display === 'none') return { off: true };
        const chipEl = document.querySelector(c);
        if (!chipEl) return { missing: 'chip' };
        return { text: (chipEl.textContent || '').trim(), stale: !!chipEl.querySelector('.is-stale') || chipEl.classList.contains('is-stale') };
      }, [sec, chip]);
      if (st.off) { warn(`PC: ${name}（${sec}）が非表示＝raw の AI データが取れていない（鮮度チップの検証をスキップ）`); continue; }
      assert(!st.missing && !!st.text, `PC: ${chip} が非空（${name}・実測 ${st.missing || JSON.stringify(st.text)}）`);
      assert(!!st.stale, `PC: ${chip} が is-stale（${name}・AI 3 層は 2026-08-23 で停止・実測 ${st.stale}）`);
    }
    const staleN = await page.locator('.fresh-chip.is-stale').count();
    console.log(`info: PC の .fresh-chip.is-stale 総数 = ${staleN}`);

    // data-style の正の確認（属性が消費され、値が CSSOM に流れていること）
    assert((await page.locator('[data-style]').count()) === 0,
      'PC: [data-style] は全て CSSOM に流し込まれ属性が残っていない');
    // index.html の静的 2 件（#alerts・#cams-one-tabs）の証拠。computed display で測ると
    // alerts.js:78 と cams-pane.js:103 が自分で display を書くのでトートロジーになる（レビュー F-2）。
    // Task 6 Step 11-b が ?e2e=1 のときだけ公開する applyDataStyles(document) の戻り値を見る。
    const appliedStatic = await page.evaluate(
      () => (window.__orbis && window.__orbis.e2e || {}).appliedStatic);
    assert(appliedStatic === 2,
      `PC: applyDataStyles(document) が index.html の静的 data-style 2 件に適用された（実測 ${appliedStatic}）`);
    // feedVars は boot 直後の実測（上記参照・『交通』プリセット後はフィードが空になる）。
    assert(!!feedVars.chip, `PC: フィードチップの --chip が computed で非空（実測 ${JSON.stringify(feedVars.chip)}）`);
    assert(!!feedVars.row, `PC: フィード行の --rowcat が computed で非空（実測 ${JSON.stringify(feedVars.row)}）`);
    // 以下 2 つは data-style の証拠ではなく「描画ロジックの結果」の確認。
    // #cams-one-tabs は cams-pane.js:103 が mode!==1（既定 4）で display:none を書く。
    const camsDisp = await page.evaluate(() => {
      const el = document.getElementById('cams-one-tabs');
      return el ? getComputedStyle(el).display : null;
    });
    assert(camsDisp === 'none',
      `PC: #cams-one-tabs は 4 画面モードで display:none（cams-pane の描画結果・実測 ${camsDisp}）`);
    // #alerts は renderAlerts（js/ui/alerts.js:78）が件数で display を上書きするので、
    // 「none 固定」ではなく「件数と表示が整合しているか」を見る（0 件なら none・1 件以上なら非 none）。
    const alerts = await page.evaluate(() => {
      const el = document.getElementById('alerts');
      if (!el) return null;
      const list = el.querySelector('.alert-list');
      return { display: getComputedStyle(el).display, n: list ? list.children.length : 0 };
    });
    assert(alerts && (alerts.n === 0 ? alerts.display === 'none' : alerts.display !== 'none'),
      `PC: #alerts の表示がアラート件数と整合（件数 ${alerts && alerts.n} / display ${alerts && alerts.display}）`);

    // ここまでが「通常導線の観測」。assertClean を先に済ませてから、意図的に 404 を叩く
    // checkRouting に入る（page.request が page.on('response') を発火する実装/版でも
    // 「自オリジンの 4xx/5xx 0」が誤検知しないようにする・レビュー F-3）。
    await assertClean(page, bag, 'PC');
    await checkRouting(page);
    await ctx.close();
  }

  // ── モバイル 390×844 ───────────────────────────────────────────
  // 能力・ルーティングは PC で見たので、ここはモバイル専用テンプレート（シート）の
  // CSP 違反 0 と data-style の消費だけを見る。
  {
    const { ctx, page, bag } = await newPage({ width: 390, height: 844 });
    await bootApp(page, 'モバイル');
    await tap(page, '.mobile-tab[data-sheet="layers"]', 'モバイル: レイヤーシート');
    await tap(page, '.layer-row', 'モバイル: レイヤートグル[0]', { nth: 0 });
    await tap(page, '.preset-chip[data-preset="traffic"]', 'モバイル: プリセット『交通』', { settle: 1500 });
    await tap(page, '.mobile-tab[data-sheet="legend"]', 'モバイル: 凡例シート');
    await tap(page, '.legend-tab[data-tab="help"]', 'モバイル: 凡例「使い方」タブ');
    await tap(page, '.mobile-tab[data-sheet="feed"]', 'モバイル: フィードシート');
    await search(page, 'モバイル');
    await tap(page, '#media-hint', 'モバイル: メディアへ移動');
    await tap(page, '.mode-btn[data-mode="1"]', 'モバイル: カメラ 1 画面');
    await tap(page, '.mode-btn[data-mode="4"]', 'モバイル: カメラ 4 画面へ戻す');
    await tap(page, '#news-tabs button', 'モバイル: ニュースのタブ[0]', { settle: 2000 });
    await tap(page, '#media-cc-toggle', 'モバイル: 字幕トグル');
    await tap(page, '.brief-card:not(.no-loc)', 'モバイル: ブリーフィングカード');
    await tap(page, '.ins-row', 'モバイル: 不安定性ランキング行');
    await tap(page, '.fc-tab', 'モバイル: 予測タブ[0]');
    await tap(page, '.fc-cardbtn:not([disabled])', 'モバイル: 予測カード');
    await tap(page, '#share-btn', 'モバイル: 共有ボタン');

    assert((await page.locator('[data-style]').count()) === 0,
      'モバイル: [data-style] は全て CSSOM に流し込まれ属性が残っていない');
    await assertClean(page, bag, 'モバイル');
    await ctx.close();
  }

  // ── negative control（CSP が本当に enforce されている証拠）──────────
  // ここが緑（違反が増える）にならない限り、上の「違反 0」は「CSP が効いていないだけ」
  // と区別できない。CSP_OVERRIDE で 'unsafe-inline' を足すとこのブロックだけが落ちる。
  {
    const { ctx, page } = await newPage({ width: 1280, height: 900 });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#app', { timeout: 15000 });
    await page.waitForTimeout(1500);
    const before = (await cspv(page)).length;
    await page.evaluate(() => {
      const st = document.createElement('style');
      // !important は付けない。付けると CSP_OVERRIDE で 'unsafe-inline' を許した RED の
      // ときに、この <style> が下の setAttribute('style') に勝ってしまい、最後の
      // 「inline style が適用されない」アサートが enforce の有無を区別できなくなる
      // （実測 2026-09-04: !important 有りだと RED で 3 FAIL・無しだと期待どおり 4 FAIL）。
      st.textContent = '#nc-probe{color:rgb(1,2,3)}';
      document.head.appendChild(st);
      const d = document.createElement('div');
      d.id = 'nc-probe';
      d.textContent = 'negative control';
      document.body.appendChild(d);
      d.setAttribute('style', 'color:rgb(4,5,6)');
    });
    await page.waitForTimeout(400);
    const delta = (await cspv(page)).slice(before);
    const dirs = delta.map((x) => String(x.d));
    assert(delta.length > 0, `negative control: 違反が増える（実測 +${delta.length}）`);
    assert(dirs.some((d) => d.startsWith('style-src-elem')),
      `negative control: <style> 注入で style-src-elem 違反（実測 ${dirs.join(',') || 'なし'}）`);
    assert(dirs.some((d) => d.startsWith('style-src-attr')),
      `negative control: setAttribute('style') で style-src-attr 違反（実測 ${dirs.join(',') || 'なし'}）`);
    const color = await page.evaluate(
      () => getComputedStyle(document.getElementById('nc-probe')).color);
    assert(color !== 'rgb(4, 5, 6)',
      `negative control: setAttribute('style') が適用されない（実測 ${color}）`);
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error('FATAL:', String((e && e.stack) || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((r) => {
    const t = setTimeout(() => { try { server.kill('SIGKILL'); } catch { /* 既に終了 */ } r(); }, 3000);
    server.once('exit', () => { clearTimeout(t); r(); });
  });
}

if (failures) {
  console.error(`\n=== ${failures} FAIL / ${checks} checks`);
  const log = serverLog.join('');
  if (log) console.error('--- harness log（末尾 2000 字）---\n' + log.slice(-2000));
  process.exit(1);
}
console.log(`\nALL OK (${checks} checks)`);
process.exit(0);
