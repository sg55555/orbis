/* Orbis 2.5b モック共通コンテンツ。A/B/C で完全同一の中身を注入し、形(シェル)だけ比較する。
   データは日本のダミー（東京都 admin1）を体裁確認用に肉付け（本文は varied placeholder）。
   .mount を持つ要素へ window.renderProfile() を流し込む。 */
(function () {
  // セクション用 SVG アイコン（mobile-tab と同じ stroke 流儀）
  const ICONS = {
    '概要': '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>',
    '気候': '<path d="M7 17a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5 3.5 3.5 0 0 1-.5 6.5z"/><line x1="9" y1="20" x2="8" y2="22"/><line x1="13" y1="20" x2="12" y2="22"/><line x1="17" y1="20" x2="16" y2="22"/>',
    '特産・名物': '<path d="M20 7h-3.2a2.5 2.5 0 1 0-4.8 0H12a2.5 2.5 0 1 0-4.8 0H4v4h1v8h14v-8h1z"/><line x1="12" y1="7" x2="12" y2="19"/>',
    '主要産業': '<path d="M3 20V9l5 3V9l5 3V6l8 4v10z"/><line x1="7" y1="16" x2="7" y2="17"/><line x1="12" y1="16" x2="12" y2="17"/><line x1="17" y1="16" x2="17" y2="17"/>',
    '交通・地理': '<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 11 11 8.5 15.5 13 13"/>',
    '観光名所': '<path d="M4 9l8-5 8 5v11H4z"/><path d="M9 20v-5h6v5"/><circle cx="12" cy="10" r="1.2"/>',
  };

  // ダミー本文（体裁確認用・長短を変えてレイアウトの呼吸を見る。実データは LLM 生成）
  const SECTIONS = [
    ['概要', '東京都は日本の首都であり、政治・経済・文化の中心。23 の特別区と多摩地域、島嶼部からなり、世界有数の人口集積を擁する。（※デザイン確認用のダミー本文）'],
    ['気候', '太平洋側気候で、夏は高温多湿、冬は乾燥して晴天が多い。都心はヒートアイランド現象により周辺部より高温になりやすい。'],
    ['特産・名物', '江戸前寿司、もんじゃ焼き、東京ばな奈などが知られる。伝統工芸では江戸切子や江戸木目込人形が受け継がれている。'],
    ['主要産業', '金融・情報通信・サービス業を中心とする第三次産業が圧倒的。多くの大企業が本社を置き、出版・放送・広告などのメディア産業も集積する。'],
    ['交通・地理', '関東平野の南端に位置し、東は東京湾に面する。鉄道網は世界最密クラスで、新宿・渋谷・東京・池袋などのターミナルが結節点となる。'],
    ['観光名所', '浅草寺、東京タワー、東京スカイツリー、皇居外苑、上野の博物館群など。近年はチームラボなどの体験型施設も人気を集める。'],
  ];

  const EVENTS = [
    ['📰', '千代田区', '日銀が金融政策の現状維持を発表'],
    ['📢', '新宿区', '都庁前で気候デモ'],
    ['🌐', '─', 'M3.2 の地震（震度1）'],
  ];

  function secIcon(title) {
    return '<span class="pf-sec-ic"><svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[title] || '') + '</svg></span>';
  }

  // 地域の形状シルエット（東京都の実 admin1 ポリゴン由来 SVG パス）。
  // 実装では country_bounds / admin1 ポリゴンから同様に生成。都市(点)は省略しフォールバック。
  const TOKYO_SHAPE = 'M97.7,25.5 L96.3,24.9 L94.9,27.3 L91.8,24.8 L89.9,28.5 L87.5,23.2 L86.7,25.5 L91.0,35.0 L89.7,38.0 L64.0,27.5 L58.7,29.6 L55.2,29.1 L58.9,33.1 L57.0,34.8 L56.1,40.2 L49.4,33.3 L35.7,30.6 L11.7,18.8 L6.0,13.5 L0.0,4.4 L9.4,0.0 L14.3,2.5 L36.2,7.1 L50.7,13.0 L60.7,10.3 L63.6,13.1 L74.6,10.4 L82.2,10.5 L86.7,8.5 L91.5,9.0 L97.7,10.3 L100.0,18.6 L99.1,22.5 L97.7,25.5Z';
  function regionShape() {
    return '<div class="pf-shape" title="東京都の形状（実ポリゴン由来）">'
      + '<svg viewBox="0 0 100 40.2" aria-hidden="true"><path d="' + TOKYO_SHAPE + '"/></svg>'
      + '</div>';
  }

  function miniGlobe() {
    // 発光ドット＝東京（球面右上寄り）。実装では flyTo 中心/輪郭に置換。
    return '<svg viewBox="0 0 64 64" aria-hidden="true">'
      + '<circle class="pf-mini-rim" cx="32" cy="32" r="26"/>'
      + '<ellipse class="pf-mini-grat" cx="32" cy="32" rx="26" ry="9"/>'
      + '<ellipse class="pf-mini-grat" cx="32" cy="32" rx="14" ry="26"/>'
      + '<ellipse class="pf-mini-grat" cx="32" cy="32" rx="26" ry="20"/>'
      + '<line class="pf-mini-grat" x1="6" y1="32" x2="58" y2="32"/>'
      + '<circle class="pf-mini-glow" cx="43" cy="23" r="5.5"/>'
      + '<circle class="pf-mini-dot" cx="43" cy="23" r="2.4"/>'
      + '</svg>';
  }

  window.renderProfile = function () {
    const facts = [
      ['人口', '13.96<small>M</small>'],
      ['面積', '2,194<small>km²</small>'],
      ['位置', '35.7°N<small>139.7°E</small>'],
      ['特別区', '23<small>区</small>'],
    ];
    return ''
      + '<article class="profile" data-level="admin1">'
      // パンくず
      + '<nav class="pf-crumbs" aria-label="現在地">'
      +   '<button>日本</button><span class="pf-sep">›</span>'
      +   '<button class="pf-crumb-cur" aria-current="page">東京都</button>'
      + '</nav>'
      // ヒーロー（画像スロット＋ミニマップ＋HUD）
      + '<header class="pf-hero">'
      +   '<div class="pf-media">'
      +     '<div class="pf-media-label">'
      +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M3 17l5-4 4 3 4-4 5 4"/></svg>'
      +       '<span>画像スロット<br>（将来：Wikipediaサムネ）</span>'
      +     '</div>'
      +     '<div class="pf-mini" title="位置（ミニグローブ）">' + miniGlobe() + '</div>'
      +   '</div>'
      +   '<div class="pf-id">'
      +     '<span class="pf-kind">ADMIN1<span class="pf-kind-ja">県</span></span>'
      +     '<div class="pf-name-row">'
      +       '<h1 class="pf-name">東京都<span class="pf-name-en">Tōkyō</span></h1>'
      +       regionShape()
      +     '</div>'
      +     '<dl class="pf-facts">'
      +       facts.map(([k, v]) => '<div class="pf-fact"><dt>' + k + '</dt><dd>' + v + '</dd></div>').join('')
      +     '</dl>'
      +   '</div>'
      + '</header>'
      // 本文セクション
      + '<div class="pf-sections">'
      +   SECTIONS.map(([t, b]) =>
            '<section class="pf-sec"><h2 class="pf-sec-h">' + secIcon(t) + t + '</h2><p>' + b + '</p></section>'
          ).join('')
      + '</div>'
      // 近隣の最近の動向（折りたたみ）
      + '<details class="pf-events">'
      +   '<summary>近隣の最近の動向<span class="pf-ev-count">' + EVENTS.length + '</span></summary>'
      +   '<div class="pf-ev-list">'
      +     EVENTS.map(([e, where, title]) =>
            '<div class="pf-ev"><span class="pf-ev-emoji">' + e + '</span><span><span class="pf-ev-where">' + where + ' — </span>' + title + '</span></div>'
          ).join('')
      +   '</div>'
      + '</details>'
      // 出典
      + '<footer class="pf-source">'
      +   '<a href="#" onclick="return false">Wikipedia (ja) ↗</a>'
      +   '<span class="pf-qid">QID Q1490</span>'
      + '</footer>'
      + '</article>';
  };

  window.mountProfile = function (sel) {
    const el = document.querySelector(sel || '.mount');
    if (el) el.innerHTML = window.renderProfile();
  };
})();
