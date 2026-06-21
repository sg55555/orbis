#!/usr/bin/env python3
"""country_bounds.geojson の geometry centroid（最大ポリゴン bbox 中心）と
手キュレート EXTRA を合流し js/lib/country_centroids.js を生成する。
出力コードは FIPS_JA 全キー（FS 補完後）と過不足なく一致することを assert する。"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_fips_ja():
    src = open(os.path.join(ROOT, 'js/lib/places.js'), encoding='utf-8').read()
    body = re.search(r'export const FIPS_JA = \{(.*?)\};', src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def largest_ring_bbox_center(geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    best, best_area = None, -1.0
    for poly in polys:
        ring = poly[0]
        xs = [c[0] for c in ring]
        ys = [c[1] for c in ring]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area > best_area:
            best_area = area
            best = [(min(xs) + max(xs)) / 2.0, (min(ys) + max(ys)) / 2.0]
    return best


# FIPS_JA にあって country_bounds に無い 68 国の [英語通称, lng, lat]（首都/島中心）。
# 110m 低解像度ジオメトリが落とす小国・領土。小国ゆえ単一代表点で zoom 4 用途に十分。
EXTRA = {
    'AA': ['Aruba', -69.97, 12.52], 'AC': ['Antigua and Barbuda', -61.80, 17.27],
    'AN': ['Andorra', 1.52, 42.51], 'AQ': ['American Samoa', -170.70, -14.30],
    'AV': ['Anguilla', -63.06, 18.22], 'BA': ['Bahrain', 50.55, 26.07],
    'BB': ['Barbados', -59.54, 13.19], 'BD': ['Bermuda', -64.75, 32.31],
    'BV': ['Bouvet Island', 3.36, -54.42], 'CJ': ['Cayman Islands', -81.25, 19.31],
    'CK': ['Cocos (Keeling) Islands', 96.87, -12.17], 'CN': ['Comoros', 43.34, -11.65],
    'CV': ['Cape Verde', -23.92, 15.93], 'CW': ['Cook Islands', -159.78, -21.24],
    'DO': ['Dominica', -61.37, 15.41], 'FG': ['French Guiana', -53.13, 3.93],
    'FO': ['Faroe Islands', -6.91, 62.00], 'FP': ['French Polynesia', -149.41, -17.65],
    'GI': ['Gibraltar', -5.35, 36.14], 'GJ': ['Grenada', -61.68, 12.12],
    'GK': ['Guernsey', -2.58, 49.45], 'GP': ['Guadeloupe', -61.55, 16.24],
    'GQ': ['Guam', 144.79, 13.44], 'GZ': ['Gaza Strip', 34.39, 31.42],
    'HK': ['Hong Kong', 114.17, 22.32], 'IM': ['Isle of Man', -4.55, 54.24],
    'IO': ['British Indian Ocean Territory', 72.00, -6.34], 'IS': ['Israel', 34.95, 31.45],
    'JE': ['Jersey', -2.13, 49.21], 'KR': ['Kiribati', 172.98, 1.45],
    'KT': ['Christmas Island', 105.68, -10.49], 'LS': ['Liechtenstein', 9.55, 47.16],
    'MB': ['Martinique', -61.02, 14.64], 'MC': ['Macau', 113.55, 22.16],
    'MH': ['Montserrat', -62.19, 16.74], 'MN': ['Monaco', 7.42, 43.74],
    'MP': ['Mauritius', 57.55, -20.28], 'MT': ['Malta', 14.38, 35.94],
    'MV': ['Maldives', 73.22, 3.25], 'NE': ['Niue', -169.87, -19.05],
    'NF': ['Norfolk Island', 167.95, -29.04], 'NO': ['Norway', 9.00, 61.50],
    'NR': ['Nauru', 166.93, -0.52], 'OD': ['South Sudan', 30.00, 7.50],
    'PC': ['Pitcairn Islands', -128.32, -24.37], 'PS': ['Palau', 134.58, 7.51],
    'RE': ['Reunion', 55.54, -21.13], 'RM': ['Marshall Islands', 171.18, 7.13],
    'SB': ['Saint Pierre and Miquelon', -56.27, 46.96], 'SC': ['Saint Kitts and Nevis', -62.73, 17.30],
    'SE': ['Seychelles', 55.49, -4.68], 'SH': ['Saint Helena', -5.72, -15.96],
    'SM': ['San Marino', 12.46, 43.94], 'SN': ['Singapore', 103.82, 1.35],
    'ST': ['Saint Lucia', -60.98, 13.91], 'SV': ['Svalbard', 16.00, 78.20],
    'TK': ['Turks and Caicos Islands', -71.80, 21.75], 'TL': ['Tokelau', -171.86, -9.20],
    'TN': ['Tonga', -175.20, -21.18], 'TP': ['Sao Tome and Principe', 6.61, 0.23],
    'TV': ['Tuvalu', 179.20, -8.52], 'VC': ['Saint Vincent and the Grenadines', -61.20, 13.25],
    'VI': ['British Virgin Islands', -64.62, 18.42], 'VQ': ['U.S. Virgin Islands', -64.90, 17.74],
    'VT': ['Vatican City', 12.45, 41.90], 'WE': ['West Bank', 35.27, 31.95],
    'WF': ['Wallis and Futuna', -176.20, -13.30], 'WS': ['Samoa', -172.10, -13.76],
}


def main():
    fips = load_fips_ja()
    gj = json.load(open(os.path.join(ROOT, 'data/static/country_bounds.geojson'), encoding='utf-8'))
    rows = {}
    for f in gj['features']:
        code = f['properties']['code']
        c = largest_ring_bbox_center(f['geometry'])
        rows[code] = [f['properties']['name'], round(c[0], 4), round(c[1], 4)]
    for code, (en, lng, lat) in EXTRA.items():
        rows.setdefault(code, [en, round(float(lng), 4), round(float(lat), 4)])

    out_codes, fips_codes = set(rows), set(fips)
    missing = sorted(fips_codes - out_codes)
    surplus = sorted(out_codes - fips_codes)
    assert not missing, f'FIPS_JA にあるが centroid 無し（EXTRA に追加せよ）: {missing}'
    assert not surplus, f'centroid にあるが FIPS_JA 無し: {surplus}'
    for code, (en, lng, lat) in rows.items():
        assert -180 <= lng <= 180 and -90 <= lat <= 90, f'範囲外: {code} {lng},{lat}'

    items = ',\n'.join(
        f'  {{ code: "{code}", en: {json.dumps(en, ensure_ascii=False)}, lng: {lng}, lat: {lat} }}'
        for code, (en, lng, lat) in sorted(rows.items()))
    js = ('// 自動生成（scripts/gen_country_centroids.py）。手編集しない。\n'
          '// country_bounds.geojson の最大ポリゴン bbox 中心 + 手キュレート EXTRA（68国）。\n'
          'export const COUNTRY_CENTROIDS = [\n' + items + ',\n];\n')
    open(os.path.join(ROOT, 'js/lib/country_centroids.js'), 'w', encoding='utf-8').write(js)
    print(f'wrote {len(rows)} centroids')


if __name__ == '__main__':
    main()
