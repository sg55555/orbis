// tests/forecast.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { filterByDomain, cardHtml, confBadge, domainColor } from '../js/ui/forecast.js';

test('filterByDomain all returns score-desc', () => {
  const cards = [{domain:'conflict',attention_score:30},{domain:'market',attention_score:80}];
  assert.equal(filterByDomain(cards, 'all')[0].attention_score, 80);
  assert.equal(filterByDomain(cards, 'conflict').length, 1);
});

test('cardHtml active shows AI badge and escapes', () => {
  const h = cardHtml({domain:'conflict',place_ja:'<b>UP</b>',attention_score:80,attention_level:5,
    trend:'up',confidence:'high',horizon:'24-72h',signals:[{label:'紛争 3件'}],
    outlook_ja:'再拡大の恐れ',rationale_ja:'件数増加',ai_generated:true,status:'active'});
  assert.match(h, /AI生成/);
  assert.match(h, /&lt;b&gt;UP&lt;\/b&gt;/);   // esc
  assert.match(h, /再拡大の恐れ/);
});

test('cardHtml watch shows 監視中, no AI badge', () => {
  const h = cardHtml({domain:'cyber',place_ja:'グローバル',attention_score:0,attention_level:1,
    trend:'new',confidence:'low',signals:[],ai_generated:false,status:'watch'});
  assert.match(h, /監視中/);
  assert.doesNotMatch(h, /AI生成/);
});

test('confBadge maps level', () => {
  assert.match(confBadge('high'), /高/);
  assert.ok(domainColor('conflict'));
});

// Task 10
import { tabsHtml } from '../js/ui/forecast.js';
test('tabsHtml marks active and lists all domains', () => {
  const h = tabsHtml('conflict');
  assert.match(h, /data-dom="all"/);
  assert.match(h, /data-dom="conflict"[^>]*fc-tab-active/);
  assert.match(h, /data-dom="cyber"/);
});
