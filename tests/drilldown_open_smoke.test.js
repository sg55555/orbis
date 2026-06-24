// tests/drilldown_open_smoke.test.js — 最小 DOM smoke テスト（恒久ガード）
//
// main.js の deps 配線欠落・#drilldown[hidden] 未解除・二重発火・onOceanMiss 経路を
// 実 renderDrilldown + 実 openCountry + 最小 DOM スタブで検証する。
// static regex や純 fake では塞げなかった「結線→実行→DOM 変化」経路を恒久カバー。
//
// 実行: node --test tests/drilldown_open_smoke.test.js
//       node --test tests/*.test.js（全テスト一括）
//
// Node の globalThis に最小 DOM スタブ（document.createElement 等）を注入してから
// 各モジュールを dynamic import する。実モジュールのパスは絶対パスで指定。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// 最小 DOM スタブ（Node には document が無いので手製）
// ---------------------------------------------------------------------------

function makeEl(tagName = 'div', attrs = {}) {
  const el = {
    tagName: tagName.toUpperCase(),
    _attrs: { ...attrs },
    _classes: new Set(),
    _children: [],
    innerHTML: '',
    textContent: '',
    type: '',
    onclick: null,
    disabled: false,
    className: '',
    getAttribute(name) { return this._attrs[name] !== undefined ? this._attrs[name] : null; },
    setAttribute(name, val) { this._attrs[name] = String(val); },
    removeAttribute(name) { delete this._attrs[name]; },
    hasAttribute(name) { return name in this._attrs; },
    classList: null, // set below
    appendChild(child) { this._children.push(child); },
    querySelector(sel) {
      // 最小サポート: .classname / #id
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        return this._children.find((c) => c._classes && c._classes.has(cls)) || null;
      }
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  el.classList = {
    _el: el,
    add(...cs) { cs.forEach((c) => { el._classes.add(c); el.className = [...el._classes].join(' '); }); },
    remove(...cs) { cs.forEach((c) => { el._classes.delete(c); el.className = [...el._classes].join(' '); }); },
    toggle(c, force) {
      if (force === true || (force === undefined && !el._classes.has(c))) {
        el._classes.add(c); el.className = [...el._classes].join(' ');
      } else {
        el._classes.delete(c); el.className = [...el._classes].join(' ');
      }
    },
    contains(c) { return el._classes.has(c); },
  };
  return el;
}

function makeDrilldownRoot(hidden = true) {
  const root = makeEl('aside');
  if (hidden) root._attrs.hidden = '';
  // #drilldown の子要素を用意（renderDrilldown が読む）
  root._children = [
    Object.assign(makeEl('h4'), { className: 'dd-title', _classes: new Set(['dd-title']) }),
    Object.assign(makeEl('div'), { className: 'dd-body', _classes: new Set(['dd-body']) }),
    Object.assign(makeEl('button'), { className: 'dd-close', _classes: new Set(['dd-close']) }),
    Object.assign(makeEl('button'), { className: 'dd-watch', _classes: new Set(['dd-watch']) }),
  ];
  root.querySelector = (sel) => {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return root._children.find((c) => c._classes && c._classes.has(cls)) || null;
    }
    return null;
  };
  return root;
}

function fakeMap() {
  return {
    resize() {},
    flyTo() {},
  };
}

// ---------------------------------------------------------------------------
// 共通: baseDeps を生成（実 renderDrilldown・setDrilldownState を使う）
// ---------------------------------------------------------------------------

async function importModules() {
  const [ccMod, drMod, ciMod, zfMod] = await Promise.all([
    import(join(ROOT, 'js/ui/country_click.js')),
    import(join(ROOT, 'js/ui/drilldown.js')),
    import(join(ROOT, 'js/lib/drilldown/country_index.js')),
    import(join(ROOT, 'js/lib/zoom_for_bbox.js')),
  ]);
  return {
    initCountryClick: ccMod.initCountryClick,
    renderDrilldown: drMod.renderDrilldown,
    setDrilldownState: drMod.setDrilldownState,
    countryBbox: ciMod.countryBbox,
    zoomForBbox: zfMod.zoomForBbox,
  };
}

const FAKE_BBOX_INDEX = {
  country: { JA: [129.5, 31.0, 145.8, 45.5] },
  extra: {},
};

const FAKE_MANIFEST = {
  JA: { admin1Bytes: 1, citiesBytes: 1, countryBbox: [129.5, 31.0, 145.8, 45.5] },
};

function fakeLoadCountryGeo() {
  return Promise.resolve({
    admin1: { type: 'FeatureCollection', features: [] },
    cities: [],
    degraded: false,
  });
}

// ---------------------------------------------------------------------------
// smoke テスト (1): openCountry で hidden が外れてパネルが populate される
// ---------------------------------------------------------------------------

test('smoke(1): openCountry が rootEl の hidden 属性を外しパネルに国名ヘッダを populate する', async () => {
  const { initCountryClick, renderDrilldown, setDrilldownState, countryBbox, zoomForBbox } = await importModules();

  const rootEl = makeDrilldownRoot(true); // hidden 付き
  const bodyEl = makeEl('body');

  assert.ok(rootEl.hasAttribute('hidden'), '初期状態: hidden 属性あり');

  const cc = initCountryClick({
    map: fakeMap(),
    getSnapshots: () => ({}),
    deps: {
      fetchFn: async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }),
      loadCountryGeo: fakeLoadCountryGeo,
      buildDrilldown: ({ fips }) => ({
        header: { code: fips, name_ja: '日本', score: 0 },
        regions: [],
        events: [],
        degraded: false,
      }),
      renderDrilldown,
      setDrilldownState,
      countryBbox,
      zoomForBbox,
      loadPolygonsFn: (geo) => [],
      bboxIndex: FAKE_BBOX_INDEX,
      manifest: FAKE_MANIFEST,
      rootEl,
      bodyEl,
      onSelectEvent: () => {},
      onOceanMiss: () => {},
      onWatchToggle: () => {},
    },
  });

  await cc.openCountry('JA', [135, 36]);

  // Critical-2: hidden が外れていること
  assert.ok(!rootEl.hasAttribute('hidden'), 'openCountry 後: hidden 属性が外れた');
  // パネルヘッダが populate されていること
  const titleEl = rootEl.querySelector('.dd-title');
  assert.ok(titleEl, '.dd-title 要素が存在する');
  // innerHTML に drilldownHeaderHtml の出力が入っていること（空でない）
  assert.ok(typeof titleEl.innerHTML === 'string', 'dd-title.innerHTML は string');
});

// ---------------------------------------------------------------------------
// smoke テスト (2): 別国 open でも二重発火/残留がない
// ---------------------------------------------------------------------------

test('smoke(2): 別国で2回 openCountry しても renderDrilldown が後勝ちの国のみで呼ばれる', async () => {
  const { initCountryClick, renderDrilldown, setDrilldownState, countryBbox, zoomForBbox } = await importModules();

  const rootEl = makeDrilldownRoot(true);
  const bodyEl = makeEl('body');
  const rendered = [];
  let resolveFirst;

  const cc = initCountryClick({
    map: fakeMap(),
    getSnapshots: () => ({}),
    deps: {
      fetchFn: async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }),
      loadCountryGeo: async (fips) => {
        if (fips === 'JA') {
          // 先行: Promise を保留して後から解決
          return new Promise((res) => {
            resolveFirst = () => res({ admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false });
          });
        }
        return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false };
      },
      buildDrilldown: ({ fips }) => ({
        header: { code: fips, name_ja: fips === 'JA' ? '日本' : 'アメリカ', score: 0 },
        regions: [],
        events: [],
        degraded: false,
      }),
      renderDrilldown: (rootEl, model, cbs) => {
        rendered.push(model.header.code);
        renderDrilldown(rootEl, model, cbs); // 実 renderDrilldown にも通す
      },
      setDrilldownState,
      countryBbox,
      zoomForBbox,
      loadPolygonsFn: () => [],
      bboxIndex: FAKE_BBOX_INDEX,
      manifest: FAKE_MANIFEST,
      rootEl,
      bodyEl,
      onSelectEvent: () => {},
      onOceanMiss: () => {},
      onWatchToggle: () => {},
    },
  });

  const p1 = cc.openCountry('JA', [135, 36]);   // 先行（保留中）
  const p2 = cc.openCountry('US', [-95, 37]);   // 後勝ち（即解決）
  await p2;
  resolveFirst();                                // 先行が後から解決
  await p1;

  // 後勝ちの US のみ render されること（先行 JA は token 不一致で破棄）
  assert.deepEqual(rendered, ['US'], `後勝ち US のみ render。実際: ${JSON.stringify(rendered)}`);
});

// ---------------------------------------------------------------------------
// smoke テスト (3): onOceanMiss 経路でパネルが開かない
// ---------------------------------------------------------------------------

test('smoke(3): resolveFipsAt が null を返す座標（海洋）では openCountry を呼ばずパネルが開かない', async () => {
  const { initCountryClick, renderDrilldown, setDrilldownState, countryBbox, zoomForBbox } = await importModules();

  const rootEl = makeDrilldownRoot(true); // hidden 付き
  const bodyEl = makeEl('body');
  let oceanMissCalled = 0;
  let opened = 0;

  // boundsPolys: 日本の近似四角形
  const POLYS = [
    { code: 'JA', name: 'Japan', name_ja: '日本', bbox: [129.5, 31.0, 145.8, 45.5],
      rings: [[[129.5, 31.0], [145.8, 31.0], [145.8, 45.5], [129.5, 45.5], [129.5, 31.0]]] },
  ];

  const cc = initCountryClick({
    map: fakeMap(),
    getSnapshots: () => ({}),
    deps: {
      fetchFn: async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }),
      loadCountryGeo: async () => { opened += 1; return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false }; },
      buildDrilldown: () => ({ header: {}, regions: [], events: [], degraded: false }),
      renderDrilldown,
      setDrilldownState,
      countryBbox,
      zoomForBbox,
      loadPolygonsFn: () => [],
      bboxIndex: FAKE_BBOX_INDEX,
      manifest: FAKE_MANIFEST,
      rootEl,
      bodyEl,
      onOceanMiss: () => { oceanMissCalled += 1; },
      onSelectEvent: () => {},
      onWatchToggle: () => {},
    },
  });

  // boundsPolys を注入してから海洋座標でクリック
  cc.setBoundsPolys(POLYS);
  await cc.handleMapClick({ lngLat: { lng: 0, lat: 0 } }); // 大西洋（海洋）

  assert.equal(oceanMissCalled, 1, 'onOceanMiss が1回呼ばれた');
  assert.equal(opened, 0, 'loadCountryGeo は呼ばれない（パネルが開かない）');
  assert.ok(rootEl.hasAttribute('hidden'), 'hidden 属性が残っている（パネルが開いていない）');
});
