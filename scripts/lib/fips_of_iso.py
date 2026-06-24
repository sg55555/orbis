"""ISO 3166-1 alpha-2 → FIPS 10-4 国コード変換表（手キュレート）。

Natural Earth admin1/populated_places は ISO_A2 / ADM0_A3 を持つが、
Orbis の一次キーは FIPS（js/lib/places.js FIPS_JA・239キー）。両系統は
別物で取り違えやすい（ISO CH=スイス↔FIPS CH=中国 / ISO ZA=南アフリカ↔FIPS SF /
ISO AU=豪州↔FIPS AS / ISO AT=オーストリア↔FIPS AU）。resolve_fips が
country_bounds の name 突合と二重チェックして取り違えを検出する。

ここに無い ISO は resolve_fips が name 突合のみで解決を試み、それも外れたら
None（build ログに出して手キュレートへ）。
"""

# ISO_A2 -> FIPS。FIPS_JA（239キー）でカバーされる主要国を網羅する。
# 値は js/lib/places.js FIPS_JA のキーと一致しなければならない。
FIPS_OF_ISO = {
    "AD": "AN", "AE": "AE", "AF": "AF", "AG": "AC", "AI": "AV", "AL": "AL",
    "AM": "AM", "AO": "AO", "AQ": "AY", "AR": "AR", "AS": "AQ", "AT": "AU",
    "AU": "AS", "AW": "AA", "AX": "FI", "AZ": "AJ", "BA": "BK", "BB": "BB",
    "BD": "BG", "BE": "BE", "BF": "UV", "BG": "BU", "BH": "BA", "BI": "BY",
    "BJ": "BN", "BL": "TB", "BM": "BD", "BN": "BX", "BO": "BL", "BQ": "NL",
    "BR": "BR", "BS": "BF", "BT": "BT", "BV": "BV", "BW": "BC", "BY": "BO",
    "BZ": "BH", "CA": "CA", "CC": "CK", "CD": "CG", "CF": "CT", "CG": "CF",
    "CH": "SZ", "CI": "IV", "CK": "CW", "CL": "CI", "CM": "CM", "CN": "CH",
    "CO": "CO", "CR": "CS", "CU": "CU", "CV": "CV", "CW": "UC", "CX": "KT",
    "CY": "CY", "CZ": "EZ", "DE": "GM", "DJ": "DJ", "DK": "DA", "DM": "DO",
    "DO": "DR", "DZ": "AG", "EC": "EC", "EE": "EN", "EG": "EG", "EH": "WI",
    "ER": "ER", "ES": "SP", "ET": "ET", "FI": "FI", "FJ": "FJ", "FK": "FK",
    "FM": "FM", "FO": "FO", "FR": "FR", "GA": "GB", "GB": "UK", "GD": "GJ",
    "GE": "GG", "GF": "FG", "GG": "GK", "GH": "GH", "GI": "GI", "GL": "GL",
    "GM": "GA", "GN": "GV", "GP": "GP", "GQ": "EK", "GR": "GR", "GS": "SX",
    "GT": "GT", "GU": "GQ", "GW": "PU", "GY": "GY", "HK": "HK", "HN": "HO",
    "HR": "HR", "HT": "HA", "HU": "HU", "ID": "ID", "IE": "EI", "IL": "IS",
    "IM": "IM", "IN": "IN", "IO": "IO", "IQ": "IZ", "IR": "IR", "IS": "IC",
    "IT": "IT", "JE": "JE", "JM": "JM", "JO": "JO", "JP": "JA", "KE": "KE",
    "KG": "KG", "KH": "CB", "KI": "KR", "KM": "CN", "KN": "SC", "KP": "KN",
    "KR": "KS", "KW": "KU", "KY": "CJ", "KZ": "KZ", "LA": "LA", "LB": "LE",
    "LC": "ST", "LI": "LS", "LK": "CE", "LR": "LI", "LS": "LT", "LT": "LH",
    "LU": "LU", "LV": "LG", "LY": "LY", "MA": "MO", "MC": "MN", "MD": "MD",
    "ME": "MJ", "MF": "RN", "MG": "MA", "MH": "RM", "MK": "MK", "ML": "ML",
    "MM": "BM", "MN": "MG", "MO": "MC", "MP": "CQ", "MQ": "MB", "MR": "MR",
    "MS": "MH", "MT": "MT", "MU": "MP", "MV": "MV", "MW": "MI", "MX": "MX",
    "MY": "MY", "MZ": "MZ", "NA": "WA", "NC": "NC", "NE": "NG", "NF": "NF",
    "NG": "NI", "NI": "NU", "NL": "NL", "NO": "NO", "NP": "NP", "NR": "NR",
    "NU": "NE", "NZ": "NZ", "OM": "MU", "PA": "PM", "PE": "PE", "PF": "FP",
    "PG": "PP", "PH": "RP", "PK": "PK", "PL": "PL", "PM": "SB", "PN": "PC",
    "PR": "RQ", "PS": "WE", "PT": "PO", "PW": "PS", "PY": "PA", "QA": "QA",
    "RE": "RE", "RO": "RO", "RS": "RI", "RU": "RS", "RW": "RW", "SA": "SA",
    "SB": "BP", "SC": "SE", "SD": "SU", "SE": "SW", "SG": "SN", "SH": "SH",
    "SI": "SI", "SJ": "SV", "SK": "LO", "SL": "SL", "SM": "SM", "SN": "SG",
    "SO": "SO", "SR": "NS", "SS": "OD", "ST": "TP", "SV": "ES", "SX": "NN",
    "SY": "SY", "SZ": "WZ", "TC": "TK", "TD": "CD", "TF": "FS", "TG": "TO",
    "TH": "TH", "TJ": "TI", "TK": "TL", "TL": "TT", "TM": "TX", "TN": "TS",
    "TO": "TN", "TR": "TU", "TT": "TD", "TV": "TV", "TW": "TW", "TZ": "TZ",
    "UA": "UP", "UG": "UG", "US": "US", "UY": "UY", "UZ": "UZ", "VA": "VT",
    "VC": "VC", "VE": "VE", "VG": "VI", "VI": "VQ", "VN": "VM", "VU": "NH",
    "WF": "WF", "WS": "WS", "XK": "KV",  # Kosovo（name 突合頼みを解消・Minor）
    "YE": "YM", "ZA": "SF", "ZM": "ZA", "ZW": "ZI",
}
