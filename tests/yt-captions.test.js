import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jaCaptionOption, forceJaCaptions, loadYtApi } from '../js/ui/yt-captions.js';

test('jaCaptionOption: 日本語自動翻訳トラックのペイロード', () => {
  const o = jaCaptionOption();
  assert.equal(o.translationLanguage.languageCode, 'ja');
});

test('forceJaCaptions: setOption を captions/cc 両モジュールで呼ぶ', () => {
  const calls = [];
  const player = {
    loadModule: (m) => calls.push(['load', m]),
    setOption: (m, k, v) => calls.push(['set', m, k, v]),
  };
  forceJaCaptions(player);
  const sets = calls.filter((c) => c[0] === 'set');
  assert.ok(sets.some((c) => c[1] === 'captions' && c[2] === 'track'));
  assert.ok(sets.some((c) => c[1] === 'cc' && c[2] === 'track'));
  assert.equal(sets[0][3].translationLanguage.languageCode, 'ja');
});

test('forceJaCaptions: 不正playerでも例外を出さない', () => {
  assert.doesNotThrow(() => forceJaCaptions(null));
  assert.doesNotThrow(() => forceJaCaptions({}));
  // setOption が投げても飲み込む
  assert.doesNotThrow(() => forceJaCaptions({ setOption: () => { throw new Error('x'); }, loadModule: () => {} }));
});

test('loadYtApi: window 無し環境では null を resolve（node安全）', async () => {
  const r = await loadYtApi();
  assert.equal(r, null);
});
