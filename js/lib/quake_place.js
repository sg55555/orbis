// 地震の震源地名（USGS の place 文字列）を日本語へ整形する純粋部。
// REGION_JA = 地域・国名の対訳ガゼッティア。紛争/抗議の FIPS_JA（places.js）に相当する、
// 地震レイヤー専用の地名辞書。都市・ランドマークの固有名詞（Cobb 等）は対象外＝英語のまま。

const DIR_JA = {
  N: '北', S: '南', E: '東', W: '西', NE: '北東', NW: '北西', SE: '南東', SW: '南西',
  NNE: '北北東', ENE: '東北東', ESE: '東南東', SSE: '南南東', SSW: '南南西', WSW: '西南西', WNW: '西北西', NNW: '北北西',
};

// 方角ワード（"west of X" のような語形式用）
const DIR_WORD_JA = {
  north: '北', south: '南', east: '東', west: '西',
  northeast: '北東', northwest: '北西', southeast: '南東', southwest: '南西',
};

export const REGION_JA = {
  // 米国 50州（USGS は California のみ "CA" 略号・他は州名フルが多い。両方収載で保険）
  Alabama: 'アラバマ州', AL: 'アラバマ州',
  Alaska: 'アラスカ州', AK: 'アラスカ州',
  Arizona: 'アリゾナ州', AZ: 'アリゾナ州',
  Arkansas: 'アーカンソー州', AR: 'アーカンソー州',
  California: 'カリフォルニア州', CA: 'カリフォルニア州',
  Colorado: 'コロラド州', CO: 'コロラド州',
  Connecticut: 'コネチカット州', CT: 'コネチカット州',
  Delaware: 'デラウェア州', DE: 'デラウェア州',
  Florida: 'フロリダ州', FL: 'フロリダ州',
  Georgia: 'ジョージア州', GA: 'ジョージア州', // USGS では米州が大多数（国ジョージアは極稀）
  Hawaii: 'ハワイ州', HI: 'ハワイ州',
  Idaho: 'アイダホ州', ID: 'アイダホ州',
  Illinois: 'イリノイ州', IL: 'イリノイ州',
  Indiana: 'インディアナ州', IN: 'インディアナ州',
  Iowa: 'アイオワ州', IA: 'アイオワ州',
  Kansas: 'カンザス州', KS: 'カンザス州',
  Kentucky: 'ケンタッキー州', KY: 'ケンタッキー州',
  Louisiana: 'ルイジアナ州', LA: 'ルイジアナ州',
  Maine: 'メイン州', ME: 'メイン州',
  Maryland: 'メリーランド州', MD: 'メリーランド州',
  Massachusetts: 'マサチューセッツ州', MA: 'マサチューセッツ州',
  Michigan: 'ミシガン州', MI: 'ミシガン州',
  Minnesota: 'ミネソタ州', MN: 'ミネソタ州',
  Mississippi: 'ミシシッピ州', MS: 'ミシシッピ州',
  Missouri: 'ミズーリ州', MO: 'ミズーリ州',
  Montana: 'モンタナ州', MT: 'モンタナ州',
  Nebraska: 'ネブラスカ州', NE: 'ネブラスカ州',
  Nevada: 'ネバダ州', NV: 'ネバダ州',
  'New Hampshire': 'ニューハンプシャー州', NH: 'ニューハンプシャー州',
  'New Jersey': 'ニュージャージー州', NJ: 'ニュージャージー州',
  'New Mexico': 'ニューメキシコ州', NM: 'ニューメキシコ州',
  'New York': 'ニューヨーク州', NY: 'ニューヨーク州',
  'North Carolina': 'ノースカロライナ州', NC: 'ノースカロライナ州',
  'North Dakota': 'ノースダコタ州', ND: 'ノースダコタ州',
  Ohio: 'オハイオ州', OH: 'オハイオ州',
  Oklahoma: 'オクラホマ州', OK: 'オクラホマ州',
  Oregon: 'オレゴン州', OR: 'オレゴン州',
  Pennsylvania: 'ペンシルベニア州', PA: 'ペンシルベニア州',
  'Rhode Island': 'ロードアイランド州', RI: 'ロードアイランド州',
  'South Carolina': 'サウスカロライナ州', SC: 'サウスカロライナ州',
  'South Dakota': 'サウスダコタ州', SD: 'サウスダコタ州',
  Tennessee: 'テネシー州', TN: 'テネシー州',
  Texas: 'テキサス州', TX: 'テキサス州',
  Utah: 'ユタ州', UT: 'ユタ州',
  Vermont: 'バーモント州', VT: 'バーモント州',
  Virginia: 'バージニア州', VA: 'バージニア州',
  Washington: 'ワシントン州', WA: 'ワシントン州',
  'West Virginia': 'ウェストバージニア州', WV: 'ウェストバージニア州',
  Wisconsin: 'ウィスコンシン州', WI: 'ウィスコンシン州',
  Wyoming: 'ワイオミング州', WY: 'ワイオミング州',

  // 準州・特別区
  'Puerto Rico': 'プエルトリコ', PR: 'プエルトリコ',
  'U.S. Virgin Islands': 'アメリカ領ヴァージン諸島',
  'Virgin Islands': 'ヴァージン諸島',
  Guam: 'グアム', GU: 'グアム',
  'American Samoa': 'アメリカ領サモア',
  'Northern Mariana Islands': '北マリアナ諸島',
  'District of Columbia': 'コロンビア特別区', 'D.C.': 'コロンビア特別区', DC: 'コロンビア特別区',

  // カナダ
  Canada: 'カナダ',

  // 中南米・カリブ（略号 MX 含む）
  Mexico: 'メキシコ', MX: 'メキシコ',
  Guatemala: 'グアテマラ', Belize: 'ベリーズ', 'El Salvador': 'エルサルバドル',
  Honduras: 'ホンジュラス', Nicaragua: 'ニカラグア', 'Costa Rica': 'コスタリカ', Panama: 'パナマ',
  Colombia: 'コロンビア', Venezuela: 'ベネズエラ', Ecuador: 'エクアドル', Peru: 'ペルー',
  Bolivia: 'ボリビア', Chile: 'チリ', Argentina: 'アルゼンチン', Brazil: 'ブラジル',
  Paraguay: 'パラグアイ', Uruguay: 'ウルグアイ', Guyana: 'ガイアナ', Suriname: 'スリナム',
  Cuba: 'キューバ', Haiti: 'ハイチ', 'Dominican Republic': 'ドミニカ共和国', Jamaica: 'ジャマイカ',
  'Trinidad and Tobago': 'トリニダード・トバゴ', Bahamas: 'バハマ', Dominica: 'ドミニカ国',
  Barbados: 'バルバドス', Grenada: 'グレナダ', 'Saint Lucia': 'セントルシア',

  // 欧州
  Iceland: 'アイスランド', Ireland: 'アイルランド', 'United Kingdom': 'イギリス',
  Portugal: 'ポルトガル', Spain: 'スペイン', France: 'フランス', Italy: 'イタリア',
  Greece: 'ギリシャ', Germany: 'ドイツ', Switzerland: 'スイス', Austria: 'オーストリア',
  Norway: 'ノルウェー', Sweden: 'スウェーデン', Albania: 'アルバニア', Croatia: 'クロアチア',
  'Bosnia and Herzegovina': 'ボスニア・ヘルツェゴビナ', Serbia: 'セルビア', Montenegro: 'モンテネグロ',
  'North Macedonia': '北マケドニア', Bulgaria: 'ブルガリア', Romania: 'ルーマニア',
  Cyprus: 'キプロス', Malta: 'マルタ',

  // 中東・コーカサス
  Turkey: 'トルコ', Armenia: 'アルメニア', Azerbaijan: 'アゼルバイジャン',
  Iran: 'イラン', Iraq: 'イラク', Syria: 'シリア', Lebanon: 'レバノン', Israel: 'イスラエル',
  Jordan: 'ヨルダン', 'Saudi Arabia': 'サウジアラビア', Yemen: 'イエメン', Oman: 'オマーン',
  'United Arab Emirates': 'アラブ首長国連邦', Kuwait: 'クウェート',

  // 南アジア・中央アジア
  Afghanistan: 'アフガニスタン', Pakistan: 'パキスタン', India: 'インド', Nepal: 'ネパール',
  Bhutan: 'ブータン', Bangladesh: 'バングラデシュ', 'Sri Lanka': 'スリランカ',
  Kazakhstan: 'カザフスタン', Kyrgyzstan: 'キルギス', Tajikistan: 'タジキスタン',
  Uzbekistan: 'ウズベキスタン', Turkmenistan: 'トルクメニスタン',

  // 東南アジア
  Myanmar: 'ミャンマー', Thailand: 'タイ', Laos: 'ラオス', Cambodia: 'カンボジア',
  Vietnam: 'ベトナム', Malaysia: 'マレーシア', Singapore: 'シンガポール', Indonesia: 'インドネシア',
  'Timor-Leste': '東ティモール', Philippines: 'フィリピン',

  // 東アジア
  China: '中国', Mongolia: 'モンゴル', 'North Korea': '北朝鮮', 'South Korea': '韓国',
  Japan: '日本', Taiwan: '台湾',
  // 中国の地方（USGS が region 名で出すもの）
  Xizang: 'チベット', Tibet: 'チベット', Qinghai: '青海省', Sichuan: '四川省', Yunnan: '雲南省',
  Xinjiang: '新疆ウイグル自治区', Gansu: '甘粛省', 'Nei Mongol': '内モンゴル自治区',
  // 日本の地方・主要島
  Honshu: '本州', Hokkaido: '北海道', Kyushu: '九州', Shikoku: '四国', 'Izu Islands': '伊豆諸島',
  // 大スンダ列島ほか主要島
  Sumatra: 'スマトラ', Java: 'ジャワ', Sulawesi: 'スラウェシ', Borneo: 'ボルネオ',
  Mindanao: 'ミンダナオ', Luzon: 'ルソン',

  // 旧ソ連（その他）
  Russia: 'ロシア', Ukraine: 'ウクライナ',

  // アフリカ
  Egypt: 'エジプト', Libya: 'リビア', Tunisia: 'チュニジア', Algeria: 'アルジェリア',
  Morocco: 'モロッコ', Sudan: 'スーダン', Ethiopia: 'エチオピア', Eritrea: 'エリトリア',
  Djibouti: 'ジブチ', Somalia: 'ソマリア', Kenya: 'ケニア', Tanzania: 'タンザニア',
  Uganda: 'ウガンダ', Rwanda: 'ルワンダ', Burundi: 'ブルンジ',
  'Democratic Republic of the Congo': 'コンゴ民主共和国', Malawi: 'マラウイ',
  Mozambique: 'モザンビーク', Zambia: 'ザンビア', Zimbabwe: 'ジンバブエ',
  'South Africa': '南アフリカ', Botswana: 'ボツワナ', Namibia: 'ナミビア',
  Madagascar: 'マダガスカル', Mali: 'マリ', Nigeria: 'ナイジェリア', Cameroon: 'カメルーン', Ghana: 'ガーナ',

  // オセアニア
  'New Zealand': 'ニュージーランド', Australia: 'オーストラリア', 'Papua New Guinea': 'パプアニューギニア',
  Fiji: 'フィジー', Tonga: 'トンガ', Vanuatu: 'バヌアツ', 'Solomon Islands': 'ソロモン諸島',
  'New Caledonia': 'ニューカレドニア', Samoa: 'サモア', 'Wallis and Futuna': 'ウォリス・フツナ',
  Kiribati: 'キリバス', Palau: 'パラオ', 'Federated States of Micronesia': 'ミクロネシア連邦',
  'Marshall Islands': 'マーシャル諸島', Nauru: 'ナウル', Tuvalu: 'ツバル',

  // 特殊地域（海・島嶼・海嶺など主要震源域）
  'Saint Helena': 'セントヘレナ', 'Ascension Island': 'アセンション島',
  'South Sandwich Islands': 'サウスサンドウィッチ諸島', 'South Georgia': 'サウスジョージア',
  'Macquarie Island': 'マッコーリー島', 'Kuril Islands': '千島列島',
  'Kermadec Islands': 'ケルマデック諸島', 'Bouvet Island': 'ブーベ島',
  'Easter Island': 'イースター島', 'Galápagos Islands': 'ガラパゴス諸島', 'Galapagos Islands': 'ガラパゴス諸島',
  Azores: 'アゾレス諸島', 'Canary Islands': 'カナリア諸島',
  'Aleutian Islands': 'アリューシャン列島', 'Andreanof Islands': 'アンドリアノフ諸島',
  'Fox Islands': 'フォックス諸島', 'Rat Islands': 'ラット諸島',
  'Fiji Islands': 'フィジー諸島', 'Loyalty Islands': 'ロイヤルティ諸島',
  'Santa Cruz Islands': 'サンタクルーズ諸島', 'Mariana Islands': 'マリアナ諸島',
  'Bonin Islands': '小笠原諸島', 'Ryukyu Islands': '琉球諸島',
  'Severnaya Zemlya': 'セヴェルナヤ・ゼムリャ', Svalbard: 'スヴァールバル諸島',
  'Banda Sea': 'バンダ海', 'Molucca Sea': 'モルッカ海', 'Flores Sea': 'フローレス海',
  'Celebes Sea': 'セレベス海', 'Sea of Okhotsk': 'オホーツク海', 'Sea of Japan': '日本海',
  'Philippine Sea': 'フィリピン海', 'Bering Sea': 'ベーリング海', 'Scotia Sea': 'スコシア海',
  'Caribbean Sea': 'カリブ海',
  'Mid-Atlantic Ridge': '中央大西洋海嶺', 'Pacific-Antarctic Ridge': '太平洋南極海嶺',
  'Southwest Indian Ridge': '南西インド洋海嶺', 'Reykjanes Ridge': 'レイキャネス海嶺',
  'Carlsberg Ridge': 'カールスバーグ海嶺',
  'Drake Passage': 'ドレーク海峡',
};

// 地域文字列を日本語へ。未知はそのまま返す（英語フォールバック＝silent な切り捨てではない）。
// USGS の "X region"（例 "Japan region"）は " region" を外して再照合する。
export function regionJa(region) {
  const r = (region || '').trim();
  if (REGION_JA[r]) return REGION_JA[r];
  const stripped = r.replace(/\s+region$/i, '');
  if (stripped !== r && REGION_JA[stripped]) return REGION_JA[stripped];
  return r;
}

// 方角の接頭辞（"western Xizang" 等）を「コア地名＋方角部」へ。コアが訳せた時のみ適用。
const ADJ_JA = { western: '西部', eastern: '東部', northern: '北部', southern: '南部', central: '中部' };
function adjRegionJa(x) {
  const t = (x || '').trim();
  const am = t.match(/^(western|eastern|northern|southern|central)\s+(.+)$/i);
  if (am) {
    const core = regionJa(am[2]);
    if (core !== am[2].trim()) return `${core}${ADJ_JA[am[1].toLowerCase()]}`;
  }
  return regionJa(t);
}

// USGS の place を日本語で分かりやすく整形する純粋関数。
// 都市・ランドマークの固有名詞は英語のまま（スコープ＝地域・国名の日本語化）。
export function quakePlaceJa(place) {
  if (!place || typeof place !== 'string') return place || '';
  const s = place.trim();

  // 「…, 地域」形式（最後のカンマで地域を分離）
  const m = s.match(/^(.*),\s*([^,]+)$/);
  if (m) {
    const head = m[1].trim();
    const suffix = `（${regionJa(m[2])}）`;
    const dm = head.match(/^(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i);
    if (dm) {
      const dir = DIR_JA[dm[2].toUpperCase()] || dm[2];
      return `${dm[3]} の${dir} ${dm[1]}km${suffix}`;
    }
    // 非 km の head（島嶼名・方角接頭辞付き地域名など）は地域として訳す。都市名は未知→英語のまま。
    return adjRegionJa(head) + suffix;
  }

  // カンマ無し形式（USGS の海域・島嶼・沿岸表現）
  let mm;
  if ((mm = s.match(/^off (?:the )?(?:[a-z]+ )?coast of (.+)$/i))) return `${regionJa(mm[1])} 沖`;
  if ((mm = s.match(/^near (?:the )?coast of (.+)$/i))) return `${regionJa(mm[1])} 沿岸`;
  if ((mm = s.match(/^(\d+)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i))) {
    const dir = DIR_JA[mm[2].toUpperCase()] || mm[2];
    return `${regionJa(mm[3])} の${dir} ${mm[1]}km`;
  }
  if ((mm = s.match(/^(north|south|east|west|northeast|northwest|southeast|southwest) of (?:the )?(.+)$/i))) {
    const dir = DIR_WORD_JA[mm[1].toLowerCase()] || mm[1];
    return `${regionJa(mm[2])} の${dir}`;
  }
  if ((mm = s.match(/^(.+) region$/i))) return `${regionJa(mm[1])} 付近`;

  // 単独の地域名・不明（方角接頭辞も考慮。既知なら日本語・未知なら英語フォールバック）
  return adjRegionJa(s);
}
