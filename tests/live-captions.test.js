import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lcWsUrl, createCaptionRenderer } from '../js/ui/live-captions.js';

test('lcWsUrl: protocol 既定（http→ws / https→wss）', () => {
  assert.equal(lcWsUrl('', 'http:'), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('', 'https:'), 'wss://localhost:8900/ws');
  assert.equal(lcWsUrl('?foo=bar', 'https:'), 'wss://localhost:8900/ws');
});

test('lcWsUrl: ?lc=ws|wss が protocol より優先', () => {
  assert.equal(lcWsUrl('?lc=ws', 'https:'), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('?lc=wss', 'http:'), 'wss://localhost:8900/ws');
  assert.equal(lcWsUrl('?x=1&lc=wss', 'http:'), 'wss://localhost:8900/ws');
});

test('lcWsUrl: protocol 省略時は ws 既定（node 環境）', () => {
  assert.equal(lcWsUrl(''), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl(undefined), 'ws://localhost:8900/ws');
  assert.equal(lcWsUrl('?lc=wss'), 'wss://localhost:8900/ws');
});

// ---------------------------------------------------------------------------
// renderer 状態機械（node ⑪-⑱）用の極小 DOM シム。
// controller が触る最小サーフェスのみ実装（jsdom 等の新規依存を入れない）。
// ---------------------------------------------------------------------------
function makeDoc() {
  function makeEl(tag) {
    const el = {
      tagName: tag,
      _className: '',
      textContent: '',
      style: {},
      dataset: {},
      children: [],
      parentNode: null,
      _classes: new Set(),
      get className() { return this._className; },
      set className(v) {
        this._className = v;
        this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
      },
      classList: {
        add: (...cs) => { cs.forEach((c) => el._classes.add(c)); el._className = [...el._classes].join(' '); },
        remove: (...cs) => { cs.forEach((c) => el._classes.delete(c)); el._className = [...el._classes].join(' '); },
        contains: (c) => el._classes.has(c),
      },
      get firstChild() { return el.children[0] || null; },
      appendChild(child) {
        if (child.parentNode) child.parentNode.removeChild(child);
        child.parentNode = el; el.children.push(child); return child;
      },
      removeChild(child) {
        const i = el.children.indexOf(child);
        if (i >= 0) { el.children.splice(i, 1); child.parentNode = null; }
        return child;
      },
    };
    return el;
  }
  return { createElement: (t) => makeEl(t) };
}

// 注入クロック + 手動フラッシュ rAF（時間依存を決定的にする）
function makeHarness({ maxRows = 2 } = {}) {
  const doc = makeDoc();
  const rowsEl = doc.createElement('div');
  let nowMs = 0;
  let pending = null; // LC_RAF が受け取った callback
  const raf = (cb) => { pending = cb; return 1; };
  const flushRaf = () => { const cb = pending; pending = null; if (cb) cb(); };
  const r = createCaptionRenderer({
    rowsEl, doc, maxRows, staleMs: 4000,
    raf, now: () => nowMs,
  });
  return {
    r, rowsEl,
    tick: (ms) => { nowMs += ms; },
    flushRaf,
    rows: () => rowsEl.children,
    texts: () => rowsEl.children.map((c) => c.textContent),
  };
}

// ⑪ upsert: 同一 seg_id の複数 interim は1行（append されない）
test('renderer ⑪ upsert: 同一 seg_id の interim は1行に上書き', () => {
  const h = makeHarness();
  h.r.upsert({ type: 'caption', seg_id: 0, src: 'hel', ja: 'hel', final: false });
  h.flushRaf();
  h.r.upsert({ type: 'caption', seg_id: 0, src: 'hello wor', ja: 'hello wor', final: false });
  h.flushRaf();
  h.r.upsert({ type: 'caption', seg_id: 0, src: 'hello world', ja: 'hello world', final: false });
  h.flushRaf();
  assert.equal(h.rows().length, 1, 'interim は append されず1行');
  assert.equal(h.texts()[0], 'hello world', '最後の interim 文に上書き');
  assert.ok(h.rows()[0].classList.contains('lc-row--interim'), 'interim クラス付与');
});

// ⑫ final: 同一 seg_id 行を日本語(ja)へ置換（src→ja）
test('renderer ⑫ final: 同一 seg_id 行を ja へ置換し interim クラス除去', () => {
  const h = makeHarness();
  h.r.upsert({ type: 'caption', seg_id: 0, src: 'hello world', ja: 'hello world', final: false });
  h.flushRaf();
  assert.equal(h.texts()[0], 'hello world');
  // final は bypass=即時（rAF を介さない）
  h.r.upsert({ type: 'caption', seg_id: 0, src: 'hello world', ja: 'こんにちは世界', final: true });
  assert.equal(h.rows().length, 1, '同一行を再利用（append しない）');
  assert.equal(h.texts()[0], 'こんにちは世界', 'ja へ置換');
  assert.ok(!h.rows()[0].classList.contains('lc-row--interim'), 'interim クラス除去');
});

// ⑬ late-interim 無視: finalized 済み seg の interim を描画しない（I2）
test('renderer ⑬ late-interim 無視: finalized 後の interim は無視', () => {
  const h = makeHarness();
  h.r.upsert({ type: 'caption', seg_id: 0, src: 'hi', ja: 'こんにちは', final: true });
  assert.equal(h.texts()[0], 'こんにちは');
  // 確定後に遅延 interim が来ても上書きしない
  h.r.upsert({ type: 'caption', seg_id: 0, src: 'hi there', ja: 'hi there', final: false });
  h.flushRaf();
  assert.equal(h.rows().length, 1);
  assert.equal(h.texts()[0], 'こんにちは', 'final 後の late-interim は無視（吸収的）');
});

// ⑭ trim後 final: MAX_ROWS で trim された seg に final 来ても ghost 行が残らない（map整合）
test('renderer ⑭ trim 後 final: trim された seg に final → ghost 行が残らない', () => {
  const h = makeHarness({ maxRows: 2 });
  // seg0,1,2 を final 化 → MAX_ROWS=2 で seg0 が trim される
  h.r.upsert({ seg_id: 0, src: 'a', ja: 'あ', final: true });
  h.r.upsert({ seg_id: 1, src: 'b', ja: 'い', final: true });
  h.r.upsert({ seg_id: 2, src: 'c', ja: 'う', final: true });
  assert.equal(h.rows().length, 2, 'MAX_ROWS=2 維持');
  assert.deepEqual(h.texts(), ['い', 'う'], 'seg0 は trim 済み');
  // trim 済み seg0 へ更に final（再送）→ 新規行を作り再 trim、ghost や重複は出ない
  h.r.upsert({ seg_id: 0, src: 'a2', ja: 'あ2', final: true });
  assert.equal(h.rows().length, 2, 'trim 後 final でも MAX_ROWS 維持（ghost なし）');
  assert.deepEqual(h.texts(), ['う', 'あ2'], '新規行として末尾追加・最古を trim');
});

// ⑮ 再接続 seg 衝突せず: clear() で state リセット、再接続後の seg0 が前接続の行に衝突しない
test('renderer ⑮ 再接続: clear() 後の seg0 は前接続行に衝突しない', () => {
  const h = makeHarness();
  h.r.upsert({ seg_id: 0, src: 'a', ja: 'あ', final: true });
  assert.equal(h.rows().length, 1);
  // 再接続相当（ws open / stop）で clear
  h.r.clear();
  assert.equal(h.rows().length, 0, 'clear で行が全消去');
  // 新接続の seg0 は新規行（interim は src を表示）
  h.r.upsert({ seg_id: 0, src: 'b', ja: 'b', final: false });
  h.flushRaf();
  assert.equal(h.rows().length, 1);
  assert.equal(h.texts()[0], 'b', '前接続の seg0 行と衝突せず新規描画');
  assert.ok(h.rows()[0].classList.contains('lc-row--interim'));
});

// ⑯ drop_seg 行削除 ＋ drop 後の同 seg interim でゾンビ復活しない
test('renderer ⑯ drop_seg: orphan interim 行を削除し、drop 後の同 seg interim は復活しない', () => {
  const h = makeHarness();
  h.r.upsert({ seg_id: 5, src: 'partial', ja: 'partial', final: false });
  h.flushRaf();
  assert.equal(h.rows().length, 1);
  h.r.dropSeg(5);
  assert.equal(h.rows().length, 0, 'drop_seg で該当行削除');
  // drop 後に同 seg の late-interim が来てもゾンビ行が復活しない（finalized 登録による I2 相当）。
  h.r.upsert({ seg_id: 5, src: 'zombie', ja: 'zombie', final: false });
  h.flushRaf();
  assert.equal(h.rows().length, 0, 'drop 後の同 seg interim はゾンビ復活しない');
});

// ⑰ stale sweep: 確定が来ないまま放置された interim 行を時間経過で掃除
test('renderer ⑰ stale sweep: 確定なし interim を時間経過で掃除', () => {
  const h = makeHarness();
  h.r.upsert({ seg_id: 0, src: 'orphan', ja: 'orphan', final: false });
  h.flushRaf();
  assert.equal(h.rows().length, 1);
  // staleMs=4000 未満では掃除しない
  h.tick(3000);
  h.r.sweepStale();
  assert.equal(h.rows().length, 1, '4s 未満は維持');
  // 4s 超過で掃除
  h.tick(1500); // 計 4500ms
  h.r.sweepStale();
  assert.equal(h.rows().length, 0, '4s 超過の確定なし interim を掃除');
});

test('renderer ⑰ stale sweep: finalized 行は掃除しない', () => {
  const h = makeHarness();
  h.r.upsert({ seg_id: 0, src: 'x', ja: '確定', final: true });
  h.tick(10000);
  h.r.sweepStale();
  assert.equal(h.rows().length, 1, 'final 行は時間経過でも掃除しない');
  assert.equal(h.texts()[0], '確定');
});

// ⑱ reduced-motion: prefers-reduced-motion で transition 0s（アニメ無効）
test('renderer ⑱ reduced-motion: transition なしで settle（アニメ無効）', () => {
  const doc = makeDoc();
  const rowsEl = doc.createElement('div');
  const r = createCaptionRenderer({
    rowsEl, doc, maxRows: 2, staleMs: 4000,
    raf: (cb) => { cb(); return 1; }, now: () => 0,
    reducedMotion: true,
  });
  r.upsert({ seg_id: 0, src: 'a', ja: 'a', final: false });
  r.upsert({ seg_id: 0, src: 'a', ja: 'あ', final: true });
  assert.equal(rowsEl.children[0].style.transition, 'none', 'reduced-motion は transition:none');
});

test('renderer ⑱ motion 有効時は settle 用 transition を設定', () => {
  const doc = makeDoc();
  const rowsEl = doc.createElement('div');
  const r = createCaptionRenderer({
    rowsEl, doc, maxRows: 2, staleMs: 4000,
    raf: (cb) => { cb(); return 1; }, now: () => 0,
    reducedMotion: false,
  });
  r.upsert({ seg_id: 0, src: 'a', ja: 'a', final: false });
  r.upsert({ seg_id: 0, src: 'a', ja: 'あ', final: true });
  assert.ok(/opacity/.test(rowsEl.children[0].style.transition || ''), 'motion 有効は opacity settle');
});

// 契約: 表示文字列ルール（final→ja / interim→src）
test('renderer 契約: 表示文字列 = final?(ja||src):(src||ja)', () => {
  const h = makeHarness();
  // interim: src 優先
  h.r.upsert({ seg_id: 0, src: 'SRC', ja: 'SRC', final: false });
  h.flushRaf();
  assert.equal(h.texts()[0], 'SRC');
  // final: ja 優先
  h.r.upsert({ seg_id: 0, src: 'SRC', ja: 'JA', final: true });
  assert.equal(h.texts()[0], 'JA');
});

// 互換: seg_id 欠落（旧 e2e の {type:caption, ja} 形式）は毎回新規行（append 相当）
test('renderer 互換: seg_id 欠落の caption は新規行・MAX_ROWS で trim', () => {
  const h = makeHarness({ maxRows: 2 });
  for (let i = 0; i < 4; i++) h.r.upsert({ type: 'caption', ja: '訳' + i });
  assert.equal(h.rows().length, 2, 'seg_id 無しは毎回新規行 → 直近2行');
  assert.deepEqual(h.texts(), ['訳2', '訳3']);
});
