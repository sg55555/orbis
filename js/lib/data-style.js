// 厳格 CSP（style-src 'self'）下で動的スタイルを当てる唯一の口（設計 §3.5 / A5）。
// テンプレートは style 属性ではなく data-style 属性を書き、innerHTML / insertAdjacentHTML の
// 直後にこれを呼ぶ。CSSOM 代入（el.style.cssText）は CSP の対象外＝インライン style 属性の
// パースを経ないので違反にならない。
//
// 注: このファイル自身も静的ガード（tests/test_static_guards.py）の対象なので、
// コードにもコメントにも「属性名＋等号＋引用符」の並びを書かない（属性名は ATTR 定数だけに持つ）。
//
// 属性は当てた直後に外す。理由＝`el.style.display = ''` のリセット型トグル
// （ui/alerts.js:78 の #alerts、ui/cams-pane.js:103-104 の #cams-one-tabs）を壊さないため。
// クラスで display:none を持たせると style.display='' がクラスに勝てず二度と開かない。
const ATTR = 'data-style';

function applyOne(el) {
  if (!el || typeof el.getAttribute !== 'function') return 0;
  const value = el.getAttribute(ATTR);
  if (!value) return 0;
  if (el.style) el.style.cssText = value;
  if (typeof el.removeAttribute === 'function') el.removeAttribute(ATTR);
  return 1;
}

// root（Element / Document）配下の [data-style] と root 自身に適用し、適用した要素数を返す。
export function applyDataStyles(root) {
  if (!root) return 0;
  let applied = 0;
  if (typeof root.querySelectorAll === 'function') {
    for (const el of Array.from(root.querySelectorAll(`[${ATTR}]`))) applied += applyOne(el);
  }
  applied += applyOne(root); // Document は getAttribute を持たないので 0
  return applied;
}
