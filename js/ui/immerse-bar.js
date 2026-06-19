// 没入感の比較プロトタイプ用ツールバー。?compare=1 のときだけ画面下部に表示する足場。
// 各ダイヤル（gz/glow/seam/mbg）をクリックで切り替え（URL を変えて reload）。現在値をハイライト。
// 本番では ?compare=1 を付けないので表示されない。採用確定後にこのファイルと index の読み込みを撤去する。

const AXES = [
  { key: 'gz',   label: 'globe',     opts: [['', '現状'], ['55', '55%'], ['70', '70%'], ['85', '85%']] },
  { key: 'glow', label: '大気', opts: [['', '1'], ['2', '2'], ['3', '3']] },
  { key: 'seam', label: '境界',      opts: [['', 'なし'], ['a', 'A 溶'], ['b', 'B 帯'], ['c', 'C 統']] },
  { key: 'mbg',  label: 'media',     opts: [['', '黒'], ['deep', '深宇宙']] },
  { key: 'glass', label: 'パネル',   opts: [['', 'すりガラス'], ['soft', '弱'], ['off', '不透明']] },
];

function current(key) { return new URLSearchParams(location.search).get(key) || ''; }

function hrefWith(key, val) {
  const p = new URLSearchParams(location.search);
  if (val) p.set(key, val); else p.delete(key);
  p.set('compare', '1');
  return location.pathname + '?' + p.toString();
}

function build() {
  if (current('compare') !== '1') return;
  const bar = document.createElement('div');
  bar.id = 'immerse-bar';
  bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:10px;z-index:9999;'
    + 'display:flex;gap:16px;flex-wrap:wrap;align-items:center;padding:8px 14px;'
    + 'background:rgba(5,8,15,.85);border:1px solid rgba(57,208,255,.35);border-radius:12px;'
    + 'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);'
    + 'font:12px system-ui,sans-serif;color:#cfe0f5;box-shadow:0 8px 30px rgba(0,0,0,.5)';
  for (const ax of AXES) {
    const grp = document.createElement('div');
    grp.style.cssText = 'display:flex;align-items:center;gap:5px';
    const lab = document.createElement('span');
    lab.textContent = ax.label;
    lab.style.cssText = 'color:#5b7fb0;margin-right:2px';
    grp.appendChild(lab);
    for (const [val, txt] of ax.opts) {
      const a = document.createElement('a');
      a.textContent = txt;
      a.href = hrefWith(ax.key, val);
      const on = current(ax.key) === val;
      a.style.cssText = 'padding:3px 9px;border-radius:999px;text-decoration:none;'
        + `border:1px solid ${on ? '#39d0ff' : '#1c2c48'};color:${on ? '#39d0ff' : '#cfe0f5'};`
        + (on ? 'box-shadow:0 0 8px rgba(57,208,255,.3)' : '');
      grp.appendChild(a);
    }
    bar.appendChild(grp);
  }
  document.body.appendChild(bar);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
}
