// tests/vendor_loader.test.js
// TripsLayer（@deck.gl/geo-layers）の遅延ロード（設計 §3.2 / A2）。
// 実 DOM もネットワークも使わず、fake document（createElement/head.appendChild を記録し
// onload/onerror を手で発火）と fake root（globalThis.deck の有無）だけで契約を固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAZY_VENDOR, ensureTripsLayer, _resetVendorLoaderForTests } from '../js/lib/vendor-loader.js';

// マイクロタスクを全部流す（Promise の adopt を跨ぐので tick 数を数えない）。
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeDoc() {
  const created = [];
  const appended = [];
  return {
    created,
    appended,
    createElement(tag) {
      const el = { tagName: String(tag).toUpperCase(), src: '', async: true, defer: false, onload: null, onerror: null };
      created.push(el);
      return el;
    },
    head: { appendChild(el) { appended.push(el); return el; } },
  };
}

test('LAZY_VENDOR は mesh-layers → geo-layers の順（geo 単体は Class extends undefined で死ぬ）', () => {
  assert.deepEqual(LAZY_VENDOR, [
    'vendor/deck.gl-mesh-layers-9.3.4.min.js',
    'vendor/deck.gl-geo-layers-9.3.4.min.js',
  ]);
});

test('既に deck.TripsLayer があれば script を 1 本も注入しない', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = { deck: { TripsLayer: function TripsLayer() {} } };
  await ensureTripsLayer({ doc, root });
  assert.equal(doc.created.length, 0);
  assert.equal(doc.appended.length, 0);
});

test('2 本を順に注入する（1 本目の onload が来てから 2 本目）', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  let done = false;
  const p = ensureTripsLayer({ doc, root }).then(() => { done = true; });

  await flush();
  assert.equal(doc.created.length, 1, '最初は 1 本目だけ');
  assert.equal(doc.created[0].src, LAZY_VENDOR[0]);
  assert.equal(doc.created[0].async, false, '実行順を保つため async=false');
  assert.equal(doc.appended.length, 1, 'head に追加されている');
  assert.equal(done, false);

  doc.created[0].onload();
  await flush();
  assert.equal(doc.created.length, 2, '1 本目の onload 後に 2 本目');
  assert.equal(doc.created[1].src, LAZY_VENDOR[1]);
  assert.equal(done, false);

  doc.created[1].onload();
  await p;
  assert.equal(done, true);
  assert.equal(doc.created.length, 2, '余計に注入しない');
});

test('二重呼び出しは同一 Promise を返す（rAF から毎フレーム呼ばれても 1 回だけ）', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  const a = ensureTripsLayer({ doc, root });
  const b = ensureTripsLayer({ doc, root });
  assert.equal(a, b);
  await flush();
  assert.equal(doc.created.length, 1);
  doc.created[0].onload();
  await flush();
  doc.created[1].onload();
  await a;
  assert.equal(doc.created.length, 2);
});

test('onerror で reject し、その後は再試行できる', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  const p = ensureTripsLayer({ doc, root });
  await flush();
  doc.created[0].onerror();
  await assert.rejects(p, /vendor script load failed/);

  // 失敗した Promise はキャッシュに残さない＝次の呼び出しで新しく注入し直せる。
  const doc2 = makeDoc();
  const p2 = ensureTripsLayer({ doc: doc2, root });
  assert.notEqual(p, p2);
  await flush();
  assert.equal(doc2.created.length, 1);
  assert.equal(doc2.created[0].src, LAZY_VENDOR[0]);
  doc2.created[0].onload();
  await flush();
  doc2.created[1].onload();
  await p2;
});

test('_resetVendorLoaderForTests で保持中の Promise を捨てられる', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  const a = ensureTripsLayer({ doc, root });
  _resetVendorLoaderForTests();
  const b = ensureTripsLayer({ doc, root });
  assert.notEqual(a, b);
  await flush();
  assert.equal(doc.created.length, 2, 'reset 後は別系列として 1 本目を注入し直す');
});
