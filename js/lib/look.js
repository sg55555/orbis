// 画面リッチ化のルック・プリセット。?look=A|B|C で実物をブラウザ比較するための切替。
// 主観的なダイヤル（大気の強さ・星雲の色味・海陸の色・グラス透明度）をここに集約する。
// 採用が決まったら DEFAULT_LOOK を確定し、不要プリセットを整理する。
// sky.* は MapLibre v5 globe の setSky（大気ハロ）パラメータ。space は透明＝背面の星雲が透ける。

export const LOOKS = {
  // A: バランス（深い藍＋シアンの大気、ほどよい星雲）
  A: {
    label: '標準',
    sky: { skyColor: '#0a1f3c', horizonColor: '#2f6fb3', fogColor: '#081428', atmosphere: 0.9 },
    water: '#071a33', land: '#16294a',
    nebula: { a: 'rgba(46,111,179,0.12)', b: 'rgba(138,92,246,0.08)', base: '#05080f' },
    glass: { blur: 16, bg: 'rgba(10,18,32,0.55)', rim: 'rgba(90,200,255,0.22)' },
  },
  // B: 濃いオーロラ（大気強め・星雲を青紫で濃く・グラスを大きくぼかす）
  B: {
    label: 'オーロラ濃',
    sky: { skyColor: '#0c2350', horizonColor: '#3b8fe0', fogColor: '#0a1838', atmosphere: 1.0 },
    water: '#08203f', land: '#1b305a',
    nebula: { a: 'rgba(72,152,255,0.32)', b: 'rgba(178,98,255,0.26)', base: '#04070e' },
    glass: { blur: 20, bg: 'rgba(10,20,38,0.50)', rim: 'rgba(120,180,255,0.30)' },
  },
  // C: シック（大気控えめ・星雲薄め・締まった暗色・グラスは不透明寄り）
  C: {
    label: 'シック',
    sky: { skyColor: '#08182e', horizonColor: '#245a8c', fogColor: '#060f1f', atmosphere: 0.7 },
    water: '#06162b', land: '#13243f',
    nebula: { a: 'rgba(40,90,150,0.08)', b: 'rgba(90,70,160,0.05)', base: '#04060c' },
    glass: { blur: 14, bg: 'rgba(8,14,26,0.62)', rim: 'rgba(70,150,210,0.16)' },
  },
};

// 採用: B（オーロラ濃）。A/C は将来調整用の比較プリセットとして ?look= で選べる。
export const DEFAULT_LOOK = 'B';

// ?look=A|B|C を読む（無効/未指定は DEFAULT_LOOK）。テストのため search を明示注入可能。
export function currentLookId(search) {
  const s = typeof search === 'string'
    ? search
    : (typeof location !== 'undefined' ? location.search : '');
  const m = /[?&]look=([A-Za-z])/.exec(s || '');
  const id = m ? m[1].toUpperCase() : DEFAULT_LOOK;
  return LOOKS[id] ? id : DEFAULT_LOOK;
}

export function getLook(search) {
  return LOOKS[currentLookId(search)];
}

// ルックに応じた CSS 変数を :root に適用（星雲・グラス）。ブラウザのみ。
export function applyLookCss(look, root) {
  const el = root || (typeof document !== 'undefined' ? document.documentElement : null);
  if (!el || !look) return;
  el.style.setProperty('--neb-a', look.nebula.a);
  el.style.setProperty('--neb-b', look.nebula.b);
  el.style.setProperty('--neb-base', look.nebula.base);
  el.style.setProperty('--glass-blur', `${look.glass.blur}px`);
  el.style.setProperty('--glass-bg', look.glass.bg);
  el.style.setProperty('--glass-rim', look.glass.rim);
}
