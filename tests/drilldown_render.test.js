// tests/drilldown_render.test.js
// render 層（js/ui/drilldown.js）の配線検証。HTML ビルダの中身は別テスト（drilldown_view）が担保するので、
// ここは state クラス遷移・行ボタン生成数・onSelect/onClose/onWatchToggle/onRemove 発火・座標なし行 disabled に集中。
// repo 既存の DOM スタブ idiom（tests/live-captions.test.js の makeDoc）を踏襲し新規依存を入れない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDrilldown, setDrilldownState, renderWatchlist } from '../js/ui/drilldown.js';

// --- 最小 DOM シム（render 層が触るサーフェスのみ） ---
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
    get className() { return this._className; },
    set className(v) {
      this._className = String(v);
      this._classes = new Set(this._className.split(/\s+/).filter(Boolean));
    },
    classList: {
      add: (...cs) => { cs.forEach((c) => el._classes.add(c)); el._className = [...el._classes].join(' '); },
      remove: (...cs) => { cs.forEach((c) => el._classes.delete(c)); el._className = [...el._classes].join(' '); },
      contains: (c) => el._classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !el._classes.has(c) : !!on; if (want) el._classes.add(c); else el._classes.delete(c); el._className = [...el._classes].join(' '); return want; },
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
    onclick: null,
    addEventListener(type, fn) { (el._listeners[type] ||= []).push(fn); },
    // テスト用: 登録済みの click ハンドラを発火（onclick プロパティも含む）
    click() {
      if (typeof el.onclick === 'function') el.onclick({ type: 'click' });
      (el._listeners.click || []).forEach((fn) => fn({ type: 'click' }));
    },
    // class / id による子孫検索（render 層が使う最小機能のみ）
    querySelector(sel) { return el._find((c) => el._matches(c, sel)) || null; },
    querySelectorAll(sel) { const out = []; el._walk((c) => { if (el._matches(c, sel)) out.push(c); }); return out; },
    _matches(node, sel) {
      if (sel.startsWith('.')) return node._classes.has(sel.slice(1));
      if (sel.startsWith('#')) return node.id === sel.slice(1);
      return node.tagName === sel.toUpperCase();
    },
    _walk(visit) { for (const c of el.children) { visit(c); if (c._walk) c._walk(visit); } },
    _find(pred) { for (const c of el.children) { if (pred(c)) return c; if (c._find) { const r = c._find(pred); if (r) return r; } } return null; },
  };
  return el;
}

// #drilldown 相当の root を組み立てる（index.html の DOM 構造を模す）。
function makeRoot() {
  const root = makeEl('aside'); root.id = 'drilldown';
  const head = makeEl('div'); head.className = 'dd-head';
  const title = makeEl('h4'); title.className = 'dd-title';
  const watch = makeEl('button'); watch.className = 'dd-watch'; watch.type = 'button';
  const close = makeEl('button'); close.className = 'dd-close'; close.type = 'button';
  head.appendChild(title); head.appendChild(watch); head.appendChild(close);
  const state = makeEl('div'); state.className = 'dd-state';
  const body = makeEl('div'); body.className = 'dd-body';
  const wl = makeEl('div'); wl.className = 'dd-watchlist';
  const wlList = makeEl('div'); wlList.className = 'dd-wl-list';
  wl.appendChild(wlList);
  root.appendChild(head); root.appendChild(state); root.appendChild(body); root.appendChild(wl);
  return root;
}

// patch: render 層は document.createElement を使うので global を差し替える
function withDoc(fn) {
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => makeEl(t) };
  try { return fn(); } finally { globalThis.document = prev; }
}

function sampleModel() {
  return {
    header: { code: 'US', name_ja: 'アメリカ合衆国', score: 60 },
    regions: [
      { a1code: 'US-CA', name_ja: 'カリフォルニア州', count: 3, byLayer: { conflict: 1, protests: 2 }, topEvents: [], lon: -119, lat: 37 },
      { a1code: null, name_ja: 'その他/不明', count: 1, byLayer: { news: 1 }, topEvents: [], lon: null, lat: null },
    ],
    events: [
      { layerId: 'protests', lon: -118, lat: 34, title: '抗議', raw: {}, a1code: 'US-CA', cityName: 'ロサンゼルス' },
      { layerId: 'news', lon: null, lat: null, title: '報道', raw: {}, a1code: null, cityName: null },
    ],
    degraded: false,
  };
}

test('renderDrilldown: header 差込・region/event 行ボタン生成・onClose/onWatchToggle 配線', () => {
  withDoc(() => {
    const root = makeRoot();
    let closed = 0; let toggled = 0; const selected = [];
    renderDrilldown(root, sampleModel(), {
      onSelect: (s) => selected.push(s),
      onClose: () => { closed += 1; },
      onWatchToggle: (code) => { toggled += 1; assert.equal(code, 'US'); },
    });
    // ヘッダ HTML が差し込まれている（中身は drilldown_view が担保＝非空のみ確認）
    assert.ok(root.querySelector('.dd-title').innerHTML.length > 0, 'header HTML 差込');
    // region 2件 + event 2件 = 4 ボタンが .dd-body 配下に生成
    const body = root.querySelector('.dd-body');
    assert.equal(body.children.length, 4, 'region2 + event2 の行ボタン');
    // 閉じる
    root.querySelector('.dd-close').click();
    assert.equal(closed, 1, 'onClose 発火');
    // ★ watch トグル（header.code を渡す）
    root.querySelector('.dd-watch').click();
    assert.equal(toggled, 1, 'onWatchToggle 発火');
  });
});

test('renderDrilldown: 座標ありの行は onSelect 発火・座標なしは disabled（instability mkRow 同型）', () => {
  withDoc(() => {
    const root = makeRoot();
    const selected = [];
    renderDrilldown(root, sampleModel(), { onSelect: (s) => selected.push(s), onClose() {}, onWatchToggle() {} });
    const btns = root.querySelector('.dd-body').children;
    // region[0]=座標あり, region[1]=座標なし(disabled), event[0]=座標あり, event[1]=座標なし(disabled)
    assert.equal(btns[0].disabled, false);
    assert.equal(btns[1].disabled, true, 'lon/lat null の region は disabled');
    assert.equal(btns[2].disabled, false);
    assert.equal(btns[3].disabled, true, 'lon/lat null の event は disabled');
    btns[0].click(); // region 行
    btns[2].click(); // event 行
    assert.equal(selected.length, 2, '座標あり行のみ onSelect 発火');
    assert.equal(selected[0].lon, -119); assert.equal(selected[0].lat, 37);
    assert.equal(selected[0].title, 'カリフォルニア州', 'region は name_ja を title に');
    assert.equal(selected[1].layerId, 'protests');
    assert.equal(selected[1].lon, -118);
    btns[1].click(); btns[3].click(); // disabled は発火しない（listener 未登録）
    assert.equal(selected.length, 2, 'disabled 行は onSelect しない');
  });
});

test('renderDrilldown: degraded=true で degraded バナーを差し込む', () => {
  withDoc(() => {
    const root = makeRoot();
    const m = sampleModel(); m.degraded = true; m.degradedKind = 'fetcherror';
    renderDrilldown(root, m, { onSelect() {}, onClose() {}, onWatchToggle() {} });
    const body = root.querySelector('.dd-body');
    // degraded バナー要素（.dd-degraded）が body 先頭に入る
    assert.ok(body.querySelector('.dd-degraded'), 'degraded バナー差込');
  });
});

test('setDrilldownState: loading/error/ready で .dd-state へクラス排他適用＋hidden 制御', () => {
  withDoc(() => {
    const root = makeRoot();
    setDrilldownState(root, 'loading');
    assert.ok(root.classList.contains('dd-loading'));
    assert.equal(root.classList.contains('dd-error'), false);
    assert.equal(root.classList.contains('dd-ready'), false);
    setDrilldownState(root, 'error');
    assert.ok(root.classList.contains('dd-error'));
    assert.equal(root.classList.contains('dd-loading'), false, 'state は排他');
    setDrilldownState(root, 'ready');
    assert.ok(root.classList.contains('dd-ready'));
    assert.equal(root.classList.contains('dd-error'), false);
  });
});

test('renderDrilldown / setDrilldownState: rootEl が null でも throw しない', () => {
  withDoc(() => {
    assert.doesNotThrow(() => renderDrilldown(null, sampleModel(), {}));
    assert.doesNotThrow(() => setDrilldownState(null, 'loading'));
  });
});

test('renderWatchlist: 各国行を .dd-wl-list に生成・onSelect/onRemove 配線', () => {
  withDoc(() => {
    const root = makeRoot();
    const selected = []; const removed = [];
    const countries = [
      { code: 'US', name_ja: 'アメリカ合衆国', score: 60, lon: -98, lat: 39 },
      { code: 'UA', name_ja: 'ウクライナ', score: 90, lon: 31, lat: 49 },
    ];
    renderWatchlist(root, countries, { onSelect: (c) => selected.push(c), onRemove: (code) => removed.push(code) });
    const list = root.querySelector('.dd-wl-list');
    assert.equal(list.children.length, 2, '2国分の行');
    // 各行は name ボタン + remove ボタン
    const row0 = list.children[0];
    assert.ok(row0.querySelector('.dd-wl-name'));
    assert.ok(row0.querySelector('.dd-wl-remove'));
    // name クリック→onSelect / ★クリック→onRemove(code)
    row0.querySelector('.dd-wl-name').click();
    assert.equal(selected.length, 1); assert.equal(selected[0].code, 'US');
    row0.querySelector('.dd-wl-remove').click();
    assert.deepEqual(removed, ['US']);
  });
});

test('renderWatchlist: 座標なし国は name ボタン disabled（消えずに表示は残す）', () => {
  withDoc(() => {
    const root = makeRoot();
    renderWatchlist(root, [{ code: 'XX', name_ja: '某国', score: 0, lon: null, lat: null }],
      { onSelect() {}, onRemove() {} });
    const list = root.querySelector('.dd-wl-list');
    assert.equal(list.children.length, 1, '座標なしでも行は表示（消えない）');
    assert.equal(list.children[0].querySelector('.dd-wl-name').disabled, true);
  });
});

test('renderWatchlist: 空配列でリストをクリア', () => {
  withDoc(() => {
    const root = makeRoot();
    renderWatchlist(root, [{ code: 'US', name_ja: 'アメリカ合衆国', score: 60, lon: -98, lat: 39 }], { onSelect() {}, onRemove() {} });
    renderWatchlist(root, [], { onSelect() {}, onRemove() {} });
    assert.equal(root.querySelector('.dd-wl-list').children.length, 0);
  });
});

// M-1 回帰テスト: 同一 rootEl に renderDrilldown を2回呼んでも
// onClose/onWatchToggle はちょうど1回しか発火しないこと。
// （実使用では openCountry が同じ #drilldown を再利用するため再現する）
test('renderDrilldown: 同一 rootEl に2回呼んでも onClose はちょうど1回発火（二重発火なし）', () => {
  withDoc(() => {
    const root = makeRoot();
    let closed = 0;
    const cb = () => { closed += 1; };
    // 1回目
    renderDrilldown(root, sampleModel(), { onSelect() {}, onClose: cb, onWatchToggle() {} });
    // 2回目（同じ rootEl・同じ .dd-close/.dd-watch ノードが再利用される）
    renderDrilldown(root, sampleModel(), { onSelect() {}, onClose: cb, onWatchToggle() {} });
    // クリック1回→cb が1回だけ呼ばれるべき
    root.querySelector('.dd-close').click();
    assert.equal(closed, 1, 'onClose は2回呼んでも1回だけ発火（二重発火しない）');
  });
});

test('renderDrilldown: 同一 rootEl に2回呼んでも onWatchToggle はちょうど1回発火（二重発火なし）', () => {
  withDoc(() => {
    const root = makeRoot();
    let toggled = 0;
    const cb = (code) => { toggled += 1; };
    // 1回目
    renderDrilldown(root, sampleModel(), { onSelect() {}, onClose() {}, onWatchToggle: cb });
    // 2回目
    renderDrilldown(root, sampleModel(), { onSelect() {}, onClose() {}, onWatchToggle: cb });
    root.querySelector('.dd-watch').click();
    assert.equal(toggled, 1, 'onWatchToggle は2回呼んでも1回だけ発火（二重発火しない）');
  });
});
