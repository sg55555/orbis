// tests/profile_render.test.js
// renderProfile の DOM 配線検証。
// profileHtml の中身は profile_view.test.js が担保するので、
// ここは .dd-body への HTML 注入・パンくず/close/watch 配線に集中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderProfile } from '../js/ui/drilldown.js';

// --- 最小 DOM シム（drilldown_render.test.js の makeEl idiom を元に renderProfile の
//     サーフェス（innerHTML/querySelector/querySelectorAll/addEventListener/onclick）に対応） ---
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _className: '',
    _innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    type: '',
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    _classes: new Set(),
    _listeners: {},
    onclick: null,
    get className() { return this._className; },
    set className(v) {
      this._className = String(v);
      this._classes = new Set(this._className.split(/\s+/).filter(Boolean));
    },
    classList: {
      add: (...cs) => { cs.forEach((c) => el._classes.add(c)); el._className = [...el._classes].join(' '); },
      remove: (...cs) => { cs.forEach((c) => el._classes.delete(c)); el._className = [...el._classes].join(' '); },
      contains: (c) => el._classes.has(c),
    },
    get innerHTML() { return el._innerHTML; },
    set innerHTML(v) { el._innerHTML = String(v); el.children = []; },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el; el.children.push(child); return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) { el.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    addEventListener(type, fn) { (el._listeners[type] ||= []).push(fn); },
    // テスト用: onclick プロパティか addEventListener 登録の click を発火
    click() {
      if (typeof el.onclick === 'function') el.onclick({ type: 'click' });
      (el._listeners.click || []).forEach((fn) => fn({ type: 'click' }));
    },
    querySelector(sel) { return el._find((c) => el._matches(c, sel)) || null; },
    // renderProfile は body.querySelectorAll('.pf-crumbs button[data-level]') を呼ぶが、
    // テスト用シムでは innerHTML 文字列からは DOM が生えない。
    // 代わりに body に _crumbBtns を直接セットすることでパンくず配線テストを可能にする。
    querySelectorAll(sel) {
      if (sel.includes('pf-crumbs') && el._crumbBtns) return el._crumbBtns;
      const out = []; el._walk((c) => { if (el._matches(c, sel)) out.push(c); }); return out;
    },
    _matches(node, sel) {
      if (sel.startsWith('.')) return node._classes.has(sel.slice(1));
      if (sel.startsWith('#')) return node.id === sel.slice(1);
      return node.tagName === String(sel).toUpperCase();
    },
    _walk(visit) { for (const c of el.children) { visit(c); if (c._walk) c._walk(visit); } },
    _find(pred) { for (const c of el.children) { if (pred(c)) return c; if (c._find) { const r = c._find(pred); if (r) return r; } } return null; },
  };
  return el;
}

// #drilldown 相当の root を組み立てる（index.html の DOM 構造を模す）
function makeRoot() {
  const root = makeEl('aside'); root.id = 'drilldown';
  const head = makeEl('div'); head.className = 'dd-head';
  const watch = makeEl('button'); watch.className = 'dd-watch'; watch.type = 'button';
  const close = makeEl('button'); close.className = 'dd-close'; close.type = 'button';
  head.appendChild(watch); head.appendChild(close);
  const body = makeEl('div'); body.className = 'dd-body';
  root.appendChild(head); root.appendChild(body);
  return root;
}

const MODEL = {
  profile: { id: 'JP-13', level: 'admin1', name_ja: '東京都', facts: {}, sections: [], source: null, degraded: true },
  breadcrumb: [
    { level: 'country', id: 'JA', name_ja: '日本' },
    { level: 'admin1', id: 'JP-13', name_ja: '東京都' },
  ],
  shapePath: null, miniDot: null, events: [], target: { level: 'admin1', id: 'JP-13' },
};

test('renderProfile: .dd-body に HTML を注入する', () => {
  const root = makeRoot();
  renderProfile(root, MODEL, { onClose: () => {}, onWatchToggle: () => {}, onNavigate: () => {} });
  const body = root.querySelector('.dd-body');
  assert.match(body.innerHTML, /東京都/, '.dd-body に name_ja が含まれる');
});

test('renderProfile: .dd-close onclick → onClose が発火する', () => {
  const root = makeRoot();
  let closed = false;
  renderProfile(root, MODEL, {
    onClose: () => { closed = true; },
    onWatchToggle: () => {},
    onNavigate: () => {},
  });
  root.querySelector('.dd-close').click();
  assert.equal(closed, true, 'onClose が発火');
});

test('renderProfile: .dd-watch onclick → onWatchToggle(model.target.id) が発火する', () => {
  const root = makeRoot();
  let watched = null;
  renderProfile(root, MODEL, {
    onClose: () => {},
    onWatchToggle: (id) => { watched = id; },
    onNavigate: () => {},
  });
  root.querySelector('.dd-watch').click();
  assert.equal(watched, 'JP-13', 'onWatchToggle に target.id が渡る');
});

test('renderProfile: パンくず button[data-level] に onNavigate が配線される', () => {
  const root = makeRoot();
  const navigated = [];

  // body に _crumbBtns を差し込むことで querySelectorAll('.pf-crumbs button[data-level]')
  // を模倣（innerHTML から DOM は生えないため）
  const body = root.querySelector('.dd-body');
  const crumbBtn = makeEl('button');
  crumbBtn.dataset = { level: 'country', id: 'JA' };
  body._crumbBtns = [crumbBtn];

  renderProfile(root, MODEL, {
    onClose: () => {},
    onWatchToggle: () => {},
    onNavigate: (level, id) => { navigated.push({ level, id }); },
  });

  crumbBtn.click();
  assert.equal(navigated.length, 1, 'パンくずクリックで onNavigate 発火');
  assert.equal(navigated[0].level, 'country');
  assert.equal(navigated[0].id, 'JA');
});

test('renderProfile: rootEl/model が null でも throw しない', () => {
  assert.doesNotThrow(() => renderProfile(null, MODEL, {}));
  assert.doesNotThrow(() => renderProfile(makeRoot(), null, {}));
});
