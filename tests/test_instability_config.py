import json

def test_instability_config_shape():
    cfg = json.load(open("config/instability.json", encoding="utf-8"))
    for k in ["root_w","protest_w","news_sev","quake","tone_div","tone_clamp",
              "weights","normalize_pct","top_n_narrative","rank_show","movers_show",
              "history_days","trend"]:
        assert k in cfg, k
    assert set(cfg["weights"]) == {"conflict","protests","news","quakes"}
    assert cfg["quake"]["mag_min"] > 0
    for k in ["dod_hours","dod_tol_hours","dod_delta","normal_pct","normal_min_samples"]:
        assert k in cfg["trend"], k

def test_fips_countries_known_entries():
    fips = json.load(open("config/fips_countries.json", encoding="utf-8"))
    assert fips["JA"] == "日本"
    assert fips["CH"] == "中国"     # FIPS の罠（ISO とは別系統）
    assert fips["IZ"] == "イラク"
    assert len(fips) > 150
