#!/usr/bin/env bash
# Orbis 受入一括: node:test → pytest → e2e-csp。全部 0 なら .closure-ok に HEAD を書く。
#   使い方: bash tools/closure.sh
#
# 注意:
#  - ulimit -v を掛けた状態で起動しないこと（e2e が起動する Chromium が落ちる）。
#    ~/.claude/hooks/guards.py は Bash の `python`/`uv run` にだけ ulimit を前置するので、
#    `bash tools/closure.sh` として起動する分には掛からない。
#  - 既存の Playwright スイート（npx playwright test・tests/e2e/*.spec.js）は
#    data/snapshots のローカル生成が前提なので含めない（Phase B で fixture 化）。
#  - set -e は使わない。各段階の rc を見て「どの段階で落ちたか」を出すため。
set -u
cd "$(dirname "$0")/.."

fail() {
  echo "== closure FAILED ($1)"
  rm -f .closure-ok
  exit 1
}

echo "== node --test tests/*.test.js"
node --test tests/*.test.js || fail "node --test"

echo "== python3 -m pytest -q"
python3 -m pytest -q || fail "pytest"

echo "== NOULIMIT=1 node tests/e2e-csp.mjs"
NOULIMIT=1 node tests/e2e-csp.mjs || fail "e2e-csp"

# 受入が HEAD で通った印。push ゲート hook（~/.claude/hooks/guards.py の check_closure）が
# この中身と git rev-parse HEAD を照合する（.gitignore 済）。
git rev-parse HEAD > .closure-ok || fail "git rev-parse"
echo "== closure OK"
