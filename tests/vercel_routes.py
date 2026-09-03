"""vercel.json の legacy builds+routes を Vercel のセマンティクスで評価する共有モジュール。

pytest（tests/test_vercel_routing_sim.py・tests/test_security_headers.py）と
e2e ハーネス（tests/harness/serve.py）が **この 1 つの評価器**を使う。
テストは自前実装で緑・ハーネスは別実装で配信、という嘘を作らないための一本化。

仕様の根拠＝Vercel Build Output API の routes（vercel.json の routes と同一仕様と明記）:
  https://vercel.com/docs/build-output-api/configuration#routes
  - src は incoming pathname 全体に対する PCRE マッチ（→ Python は re.fullmatch）
  - continue: true なら src がマッチしても評価を続ける（headers だけ積む）
  - status / dest が付いたマッチで確定する
  - handle: "filesystem" は「ここまでで確定しなければビルド出力の実ファイルを探す」境界

本モジュールは静的サイト（@vercel/static のみ）に必要な範囲だけを実装する。
Serverless Function・rewrite の再入・middleware は Orbis に無いので扱わない。

このシミュレーションが証明しないこと（本番 curl でしか確かめられない部分）:
- エッジでの実配信（TLS・CDN 層・Vercel が独自に足す HSTS 等）
- .gz 資産に Content-Encoding が付かないこと（骨格 Task 11 Step 3 の curl で確認する）
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class RouteResult:
    """1 リクエストの評価結果。

    status  … 最終ステータス（確定しなければ 404）
    dest    … 実際に配信されるビルド出力のパス（308 等・未解決なら None）
    headers … 確定までに積み上がったレスポンスヘッダー
    matched … 評価した routes の index（continue で通過したものと handle も含む）
    """

    status: int
    dest: str | None
    headers: dict[str, str]
    matched: list[int]


def load_config(root: Path) -> dict:
    """<root>/vercel.json を読む。"""
    return json.loads((Path(root) / "vercel.json").read_text(encoding="utf-8"))


def expand_builds(cfg: dict, root: Path) -> set[str]:
    """builds の src グロブを実ファイルへ展開し "/js/main.js" 形式の配信パス集合を返す。

    - 末尾 "/**" は「そのディレクトリ配下の全ファイル（再帰）」。ディレクトリ自身は含めない。
    - それ以外は Path.glob（"index.html" のような固定名もそのまま通る）。
    - ディスクに無い src（Task 4 より前の vendor/** など）は静かに無視する。
      まだ作っていない資産で routing のテストが落ちないようにするため。
    """
    root = Path(root)
    served: set[str] = set()
    for b in cfg.get("builds", []):
        src = b.get("src", "")
        if not src:
            continue
        if src.endswith("/**"):
            base = root / src[:-3]
            if not base.is_dir():
                continue
            candidates = base.rglob("*")
        else:
            candidates = root.glob(src)
        for p in candidates:
            if p.is_file():
                served.add("/" + p.relative_to(root).as_posix())
    return served


def _expand(template: str, m: re.Match) -> str:
    """$1..$N を捕獲グループで置換する（Vercel の dest / Location の記法）。

    捕獲が無い route では何も起きない（そのまま返る）。dest だけでなく headers にも
    適用するが、$ を含む値は Location しか無いので実質 Location 専用。
    """
    out = template
    for i, g in enumerate(m.groups(), start=1):
        out = out.replace(f"${i}", g if g is not None else "")
    return out


def evaluate(cfg: dict, path: str, served: set[str]) -> RouteResult:
    """path に対する routes の評価結果を返す。served は expand_builds の戻り値。"""
    headers: dict[str, str] = {}
    matched: list[int] = []

    for i, r in enumerate(cfg.get("routes", [])):
        # filesystem 境界: ここまでで確定していなければ実ファイルを探す。
        if r.get("handle") == "filesystem":
            matched.append(i)
            target = "/index.html" if path == "/" else path
            if target in served:
                return RouteResult(200, target, headers, matched)
            continue

        src = r.get("src")
        if src is None:
            continue
        m = re.fullmatch(src, path)
        if not m:
            continue
        matched.append(i)

        if "headers" in r:
            for k, v in r["headers"].items():
                headers[k] = _expand(v, m)

        if r.get("continue"):
            continue

        dest = _expand(r["dest"], m) if "dest" in r else None

        if "status" in r:
            # 308 / 明示 404 など。dest はあれば展開して返す（本文の出所）。
            return RouteResult(int(r["status"]), dest, headers, matched)

        if dest is not None:
            # route はあってもビルド出力に無ければ本番は 404。
            if dest not in served:
                return RouteResult(404, None, headers, matched)
            return RouteResult(200, dest, headers, matched)

        return RouteResult(200, None, headers, matched)

    return RouteResult(404, None, headers, matched)
