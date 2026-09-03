// tests/data-style.test.js
// 厳格 CSP（style-src 'self'）下の唯一のスタイル注入口 applyDataStyles(root)（設計 §3.5 / A5）。
// 実 DOM を使わず、querySelectorAll / getAttribute / removeAttribute / style.cssText だけを持つ
// 最小オブジェクトで契約を固定する（repo 既存の DOM スタブ idiom＝tests/drilldown_render.test.js に倣う）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDataStyles } from '../js/lib/data-style.js';

function makeEl(attrs = {}) {
  const bag = { ...attrs };
  return {
    style: { cssText: '' },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(bag, name) ? bag[name] : null;
    },
    removeAttribute(name) { delete bag[name]; },
    hasAttr(name) { return Object.prototype.hasOwnProperty.call(bag, name); },
  };
}

// children は「今 data-style を持っている子」を毎回数え直す（属性除去が効いているか見るため）。
function makeRoot(children, selfAttrs = null) {
  const root = selfAttrs ? makeEl(selfAttrs) : {};
  root.querySelectorAll = (sel) => {
    assert.equal(sel, '[data-style]', 'セレクタは [data-style] 固定');
    return children.filter((c) => c.getAttribute('data-style') != null);
  };
  return root;
}

test('配下の [data-style] を cssText に流して属性を外す', () => {
  const a = makeEl({ 'data-style': '--chip:rgb(1,2,3)' });
  const b = makeEl({ 'data-style': 'width:42%' });
  const root = makeRoot([a, b]);
  assert.equal(applyDataStyles(root), 2);
  assert.equal(a.style.cssText, '--chip:rgb(1,2,3)');
  assert.equal(b.style.cssText, 'width:42%');
  assert.equal(a.hasAttr('data-style'), false);
  assert.equal(b.hasAttr('data-style'), false);
});

test('root 自身が data-style を持つ場合は自身にも適用する', () => {
  const child = makeEl({ 'data-style': 'color:#7fd8ff' });
  const root = makeRoot([child], { 'data-style': 'display:none' });
  assert.equal(applyDataStyles(root), 2);
  assert.equal(root.style.cssText, 'display:none');
  assert.equal(root.hasAttr('data-style'), false);
  assert.equal(child.style.cssText, 'color:#7fd8ff');
});

test('二重に呼んでも二度目は 0 件（属性が消えている＝冪等）', () => {
  const a = makeEl({ 'data-style': 'opacity:.7' });
  const root = makeRoot([a]);
  assert.equal(applyDataStyles(root), 1);
  assert.equal(applyDataStyles(root), 0);
  assert.equal(a.style.cssText, 'opacity:.7', '既に当てた値は消さない');
});

test('data-style を持たない要素は cssText を触らない', () => {
  const plain = makeEl({ class: 'feed-row' });
  const root = makeRoot([plain]);
  assert.equal(applyDataStyles(root), 0);
  assert.equal(plain.style.cssText, '');
});

test('空文字の data-style は無視する（cssText を空で上書きしない）', () => {
  const a = makeEl({ 'data-style': '' });
  a.style.cssText = 'color:red';
  const root = makeRoot([a]);
  assert.equal(applyDataStyles(root), 0);
  assert.equal(a.style.cssText, 'color:red');
});

test('root が null / undefined なら 0（例外を投げない）', () => {
  assert.equal(applyDataStyles(null), 0);
  assert.equal(applyDataStyles(undefined), 0);
});

test('querySelectorAll を持たない root（document 断片の代用）でも自身だけ処理する', () => {
  const only = makeEl({ 'data-style': 'display:none' });
  assert.equal(applyDataStyles(only), 1);
  assert.equal(only.style.cssText, 'display:none');
});
