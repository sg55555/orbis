import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tooltipFor } from '../js/layers/registry.js';

test('quakes tooltip: M{mag} {place}', () => {
  const o = { mag: 3.6, place: '93 km SSE of Perryville, Alaska' };
  assert.equal(tooltipFor('quakes', o), 'M3.6 93 km SSE of Perryville, Alaska');
});

test('flights tooltip: callsign + 高度 + 速度（空中）', () => {
  const o = { callsign: 'RTY484 ', alt: 1821.18, velocity: 56.83, on_ground: false };
  assert.equal(tooltipFor('flights', o), 'RTY484 · 1821m · 57m/s');
});

test('flights tooltip: 地上は「地上」表記', () => {
  const o = { callsign: 'AIC1TA', alt: null, velocity: 7.46, on_ground: true };
  assert.equal(tooltipFor('flights', o), 'AIC1TA · 地上 · 7m/s');
});

test('conflict tooltip: {place}（domain）', () => {
  const o = { place: 'FR', url: 'https://www.dailymail.com/tv/article-1.html' };
  assert.equal(tooltipFor('conflict', o), 'FR（dailymail.com）');
});

test('protests tooltip: {place}（domain）', () => {
  const o = { place: 'US', url: 'https://www.sacurrent.com/news/x' };
  assert.equal(tooltipFor('protests', o), 'US（sacurrent.com）');
});

test('trade-chokepoints / trade-routes tooltip: properties.name', () => {
  const choke = { properties: { name: 'Suez Canal' } };
  const route = { properties: { name: 'Trans-Pacific' } };
  assert.equal(tooltipFor('trade-chokepoints', choke), 'Suez Canal');
  assert.equal(tooltipFor('trade-routes', route), 'Trans-Pacific');
});

test('tooltipFor: 未知 deckLayerId や null object は null', () => {
  assert.equal(tooltipFor('quakes', null), null);
  assert.equal(tooltipFor('ghost', {}), null);
});
