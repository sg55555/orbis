"""GitHub Actions workflow から『schedule-active ∧ 非 if-gate な collector』集合を算出する。

Layer1 の完全性テスト（REQUIRED ⊆ eligible）が使う＝『本番で定期実行され、かつ条件付きでない』
＝キー供給を期待してよい層はどれか、を workflow から機械判定する。schedule をコメントアウトした
停止層（briefing/forecast/instability）や if: でゲートされた層（news）を静的に除外する。

pyyaml は使わない：orbis の root requirements.txt は Vercel の全 api/ 関数へ install されるため、
テスト/CI 専用の依存を足すと本番の関数が太る（既存 test_workflow_observability.py と同方針）。
"""
import glob
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
WORKFLOW_DIR = os.path.join(ROOT, ".github", "workflows")

_CRON_RE = re.compile(r"^\s*-\s*cron\s*:")
_STEPS_RE = re.compile(r"^\s*steps\s*:\s*$")
_DASH_RE = re.compile(r"^(\s*)-\s")               # YAML の list item（ステップ先頭）
_COLLECTOR_RE = re.compile(r"python -m collectors\.([a-z_]+)")
_IF_KEY_RE = re.compile(r"^\s*(?:-\s*)?if\s*:")   # `if:`・`- if:`（先頭 key）両対応


def _uncommented(line):
    return not line.lstrip().startswith("#")


def schedule_active(text):
    """on: schedule 配下に非コメントの `- cron:` が1本でもあれば True。

    停止層は `# schedule:` / `#   - cron:` とコメントアウトされているため False になる。
    """
    for line in text.splitlines():
        if _uncommented(line) and _CRON_RE.match(line):
            return True
    return False


def collector_steps(text):
    """collector を起動するステップを (mod, has_if) で返す。

    steps: 配下を step-item のインデントで**ブロック分割**し、各ブロック内で
    `python -m collectors.<mod>`（block scalar `run: |` の継続行含む）と `if:`（先頭 key
    の `- if:` 含む）を検出する。YAML の key 順は不定なので run/if の順序に依存しない。
    より深いインデントの `- x`（in-step の block-sequence 項目）はステップ境界にしない。
    """
    lines = text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if _STEPS_RE.match(line):
            start = i + 1
            break
    if start is None:
        return []
    # step-item のインデント＝steps: 直後の最初の `- ` 行の桁。
    step_indent = None
    for line in lines[start:]:
        m = _DASH_RE.match(line)
        if m and _uncommented(line):
            step_indent = len(m.group(1))
            break
    if step_indent is None:
        return []
    # 同一インデントの `- ` 行でブロック分割（深い `- x` は境界にしない）。
    blocks, cur = [], None
    for line in lines[start:]:
        m = _DASH_RE.match(line)
        if m and _uncommented(line) and len(m.group(1)) == step_indent:
            if cur is not None:
                blocks.append(cur)
            cur = [line]
        elif cur is not None:
            cur.append(line)
    if cur is not None:
        blocks.append(cur)
    steps = []
    for block in blocks:
        mod = None
        has_if = False
        for line in block:
            if not _uncommented(line):
                continue
            if _IF_KEY_RE.match(line):
                has_if = True
            if mod is None:
                for cm in _COLLECTOR_RE.finditer(line):
                    if cm.group(1) != "lib":  # collectors.lib.mark_error は起動でない
                        mod = cm.group(1)
                        break
        if mod:
            steps.append((mod, has_if))
    return steps


def eligible_layers():
    """schedule-active ∧ 非 if-gate な collector を {mod: workflow_basename} で返す。"""
    out = {}
    for path in sorted(glob.glob(os.path.join(WORKFLOW_DIR, "*.yml"))):
        text = open(path, encoding="utf-8").read()
        if not schedule_active(text):
            continue
        for mod, has_if in collector_steps(text):
            if not has_if:
                out[mod] = os.path.basename(path)
    return out
