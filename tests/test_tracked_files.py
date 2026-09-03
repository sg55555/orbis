"""AI セッションの作業ディレクトリが git 追跡に混入していないか（設計 §3.5）。

.gitignore に書いてあっても、過去に `git add` されたファイルは無視されない。
Orbis は公開リポなので、会話ログ・作業メモ・鍵が push される事故を静的に止める。
"""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
DIRS = [".superpowers", ".claude", ".claire"]


def test_agent_workdirs_are_not_tracked():
    out = subprocess.run(
        ["git", "ls-files", "--"] + DIRS,
        cwd=str(ROOT), capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert out == "", f"追跡されている作業ファイル:\n{out}\n→ git rm --cached <path> で外す"


def test_gitignore_still_lists_the_agent_workdirs():
    """追跡解除だけでは再追加を防げない（.gitignore とセットで初めて効く）。"""
    ignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for d in DIRS:
        assert f"{d}/" in ignore, f"{d}/ が .gitignore に無い"
