// 国ドリルダウン render 層。drilldown_view.js（純 HTML）を DOM に差し込み、
// region/event 行に onSelect を配線する。map/fetch は呼ばずコールバックで外部委譲（instability mkRow 同型）。
import { drilldownHeaderHtml, regionRowHtml, eventLineHtml, degradedNoticeHtml } from '../lib/drilldown/drilldown_view.js';
import { rowHtml } from './instability.js';
import { profileHtml } from '../lib/drilldown/profile_view.js';

const STATE_CLASSES = { loading: 'dd-loading', error: 'dd-error', ready: 'dd-ready' };

// rootEl=#drilldown。state in {'loading','error','ready'}。クラスを排他適用。
export function setDrilldownState(rootEl, state) {
  if (!rootEl) return;
  for (const cls of Object.values(STATE_CLASSES)) rootEl.classList.remove(cls);
  const next = STATE_CLASSES[state];
  if (next) rootEl.classList.add(next);
}

// 行ボタンを作る（instability の mkRow と同型: 座標ありは onSelect、なしは disabled）。
function mkRowButton(html, payload, onSelect) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'dd-rowbtn';
  el.innerHTML = html;
  if (payload && typeof payload.lon === 'number' && typeof payload.lat === 'number'
      && (payload.lon || payload.lat) && onSelect) {
    el.addEventListener('click', () => onSelect(payload));
  } else {
    el.disabled = true;
  }
  return el;
}

// rootEl=#drilldown。model={header, regions, events, degraded, degradedKind?}。
// onSelect({lon,lat,title,layerId}) は座標あり行クリック / onClose() / onWatchToggle(code)。
export function renderDrilldown(rootEl, model, { onSelect, onClose, onWatchToggle } = {}) {
  if (!rootEl || !model) return;
  const titleEl = rootEl.querySelector('.dd-title');
  const body = rootEl.querySelector('.dd-body');
  const closeBtn = rootEl.querySelector('.dd-close');
  const watchBtn = rootEl.querySelector('.dd-watch');
  const header = model.header || {};

  if (titleEl) titleEl.innerHTML = drilldownHeaderHtml(header);
  if (closeBtn && onClose) { closeBtn.innerHTML = '×'; closeBtn.onclick = () => onClose(); }
  if (watchBtn && onWatchToggle) { watchBtn.innerHTML = '★'; watchBtn.onclick = () => onWatchToggle(header.code); }

  if (body) {
    body.innerHTML = '';
    if (model.degraded) {
      const banner = document.createElement('div');
      banner.className = 'dd-degraded';
      banner.innerHTML = degradedNoticeHtml(model.degradedKind || 'missing');
      body.appendChild(banner);
    }
    for (const region of (model.regions || [])) {
      // region 行は name_ja を title に乗せ flyTo の見出しにする
      body.appendChild(mkRowButton(
        regionRowHtml(region),
        { lon: region.lon, lat: region.lat, title: region.name_ja, layerId: 'country' },
        onSelect));
    }
    for (const ev of (model.events || [])) {
      body.appendChild(mkRowButton(
        eventLineHtml(ev),
        { lon: ev.lon, lat: ev.lat, title: ev.title, layerId: ev.layerId },
        onSelect));
    }
  }
}

// rootEl=#drilldown。model（profile_view のモデル）を .dd-body に描画し、パンくず/close/watch を配線。
export function renderProfile(rootEl, model, { onClose, onWatchToggle, onNavigate } = {}) {
  if (!rootEl || !model) return;
  const body = rootEl.querySelector('.dd-body');
  const closeBtn = rootEl.querySelector('.dd-close');
  const watchBtn = rootEl.querySelector('.dd-watch');
  if (body) {
    body.innerHTML = profileHtml(model);
    if (onNavigate) {
      for (const btn of body.querySelectorAll('.pf-crumbs button[data-level]')) {
        btn.addEventListener('click', () => onNavigate(btn.dataset.level, btn.dataset.id));
      }
    }
  }
  if (closeBtn && onClose) { closeBtn.onclick = () => onClose(); }
  if (watchBtn && onWatchToggle && model.target) { watchBtn.onclick = () => onWatchToggle(model.target.id); }
}

// rootEl=#drilldown。countries=orderByInstability 済の [{code,name_ja,score,lon,lat}]。
// instability rowHtml を流用（座標あり=onSelect / ★=onRemove）。.dd-wl-list に描画。
export function renderWatchlist(rootEl, countries, { onSelect, onRemove } = {}) {
  if (!rootEl) return;
  const list = rootEl.querySelector('.dd-wl-list');
  if (!list) return;
  list.innerHTML = '';
  for (const c of (countries || [])) {
    const row = document.createElement('div');
    row.className = 'dd-wl-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-wl-name';
    btn.innerHTML = rowHtml(c);
    if (typeof c.lon === 'number' && typeof c.lat === 'number' && (c.lon || c.lat) && onSelect) {
      btn.addEventListener('click', () => onSelect(c));
    } else {
      btn.disabled = true;
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'dd-wl-remove';
    rm.innerHTML = '★';
    if (onRemove) rm.addEventListener('click', () => onRemove(c.code));
    row.appendChild(btn);
    row.appendChild(rm);
    list.appendChild(row);
  }
}
