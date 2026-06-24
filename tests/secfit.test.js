import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 後付けセクション馴染ませ（?secfit=on|off 既定on）の CSS 回帰テスト。
// GPU 依存（glow/blur）の見た目はオーナー実機で確認するため、ここでは
// 「規範言語の規則が存在するか」「面（不透明ベタ/radial）を足していないか」を構造的に検証する。

const css = readFileSync(new URL('../css/orbis.css', import.meta.url), 'utf8');

// secfit ブロックを抽出（マーカーコメントから次の大ブロックコメント or ファイル末尾まで）。
const startIdx = css.indexOf('後付けセクション馴染ませ');
assert.ok(startIdx >= 0, 'secfit ブロックのマーカーコメントが存在する');
const block = css.slice(startIdx);

test('#sources: .src-panel が instability 型グラス箱（地/縁/角丸/blur）になっている', () => {
  const m = block.match(/body\.secfit-on\s+\.src-panel\s*\{[^}]*\}/);
  assert.ok(m, 'body.secfit-on .src-panel 規則が存在する');
  const rule = m[0];
  // 背景は「ガラス感」イテレーション値（半透明 rgba・確定後トークン化）。透明度<1 であることを構造的に確認。
  assert.match(rule, /background:\s*rgba\([^)]*0?\.\d+\s*\)/, '半透明ガラス地（透明感）');
  assert.match(rule, /border:[^;]*var\(--rim-blue-grey\)/, '青灰縁 --rim-blue-grey');
  assert.match(rule, /border-radius:\s*14px/, '角丸 14px（規範）');
  assert.match(rule, /backdrop-filter:\s*blur/, 'すりガラス blur');
});

test('#sources: データ行に左アクセント(::before)＋glow dot(.src-name::before)＋鮮度色(cyan既定/stale=アンバー)', () => {
  // 左アクセントバーは grid を乱さないよう絶対配置の ::before
  assert.match(block, /body\.secfit-on\s+\.src-list\s+\.src-row::before\s*\{[^}]*position:\s*absolute/,
    'src-row::before 左アクセントが絶対配置');
  // glow dot は src-row::after（src-name の外＝絶対配置・glow 非クリップ／ellipsis 保持）
  const dot = block.match(/body\.secfit-on\s+\.src-list\s+\.src-row::after\s*\{[^}]*\}/);
  assert.ok(dot, 'src-row::after glow dot 規則が存在する');
  assert.match(dot[0], /position:\s*absolute/, 'glow dot は src-name 外の絶対配置（ellipsis/glow 保護）');
  assert.match(dot[0], /box-shadow:/, 'glow dot に発光（box-shadow）');
  assert.match(dot[0], /var\(--cyan\)/, '既定鮮度色 = cyan（大気ハロ）');
  // base の src-name は flex 化せず（ellipsis 保持）＝secfit が src-name の display を上書きしない
  assert.ok(!/body\.secfit-on\s+\.src-list\s+\.src-row\s+\.src-name\s*\{[^}]*display:\s*flex/.test(block),
    'src-name を flex 化していない（text-overflow:ellipsis を base のまま保持）');
  // stale 行は鮮度色をアンバー --cat-stale に上書き（バー＝::before / dot＝::after）
  assert.match(block, /\.src-row\.src-stale::before\s*\{[^}]*var\(--cat-stale\)/,
    'stale 行は左アクセントバーをアンバー --cat-stale に');
  assert.match(block, /\.src-row\.src-stale::after\s*\{[^}]*var\(--cat-stale\)/,
    'stale 行は glow dot をアンバー --cat-stale に');
});

test('#forecasts: カードが full border でなく border-left アクセント＋glow dot', () => {
  const card = block.match(/body\.secfit-on\s+\.fc-card\s*\{[^}]*\}/);
  assert.ok(card, 'body.secfit-on .fc-card 規則が存在する');
  assert.match(card[0], /border-left:\s*3px/, 'カテゴリ色を左 3px 線で（面でなく線）');
  // 地は「ガラス感」イテレーション値（半透明 rgba・箱の blur 地が透ける／確定後トークン化）
  assert.match(card[0], /background:\s*rgba\([^)]*0?\.\d+\s*\)/, '半透明ガラス地（透明感）');
  // glow dot は fc-head::before
  const dot = block.match(/body\.secfit-on\s+\.fc-head::before\s*\{[^}]*\}/);
  assert.ok(dot, 'fc-head::before glow dot 規則が存在する');
  assert.match(dot[0], /box-shadow:/, 'glow dot に発光');
});

test('#forecasts: 箱トーンを instability と統一・タブにネオン縁glow', () => {
  const box = block.match(/body\.secfit-on\s+#forecasts\.panel-section\s*\{[^}]*\}/);
  assert.ok(box, '#forecasts 箱の secfit 上書き規則が存在する');
  assert.match(box[0], /background:\s*rgba\([^)]*0?\.\d+\s*\)/, '半透明ガラス地（透明感・instability と同系トーン）');
  assert.match(box[0], /var\(--rim-blue-grey\)/, '縁を --rim-blue-grey に（instability 統一）');
  // タブ active/hover に cyan glow（box-shadow）
  assert.match(block, /body\.secfit-on\s+\.fc-tab-active[^{]*\{[^}]*box-shadow:/, 'fc-tab-active に glow');
});

test('リッチアイコン：見出し emoji→SVG ラインアイコンが secfit でトグルされる', () => {
  // 太田さんFB「絵文字がポップすぎ→タブアイコンのようなリッチ感」。.sec-ic は既定非表示、secfit-on で SVG 表示＋emoji 非表示。
  assert.match(block, /\.sec-ic\s*\{[^}]*display:\s*none/, '.sec-ic は既定非表示（before=emoji）');
  assert.match(block, /body\.secfit-on\s+\.sec-emoji\s*\{[^}]*display:\s*none/, 'secfit-on で emoji 非表示');
  const ic = block.match(/body\.secfit-on\s+\.sec-ic\s*\{[^}]*\}/);
  assert.ok(ic, 'secfit-on .sec-ic 表示規則が存在する');
  assert.match(ic[0], /display:\s*inline-block/, 'SVG アイコンを表示');
  assert.match(ic[0], /filter:\s*drop-shadow/, 'アイコンに発光（drop-shadow glow）');
});

test('ネオン感：バー/数値/種別色が発光（box-shadow/text-shadow）', () => {
  // 太田さんFB「もう少しネオン感」。注視度バー fill に box-shadow、ドメイン種別色/数値に text-shadow。
  assert.match(block, /body\.secfit-on\s+\.fc-fill\s*\{[^}]*box-shadow:/, '注視度バー fill が発光');
  assert.match(block, /body\.secfit-on\s+\.fc-bar\s*\{[^}]*overflow:\s*visible/, 'bar の glow をクリップしない（overflow visible）');
  assert.match(block, /body\.secfit-on\s+\.fc-dom\s*\{[^}]*text-shadow:/, 'ドメイン種別色が発光');
});

test('面禁則：secfit ブロックは radial-gradient（光の面）を一切足さない', () => {
  // 周辺光/星雲の「面」は globe＋グラスUI で四角く滲む既知問題（mistakes.md）。線/光/縁のみ（glow=box/text/drop-shadow は可）。
  assert.ok(!/radial-gradient/.test(block), 'secfit ブロックに radial-gradient を使っていない');
});
