#!/usr/bin/env bash
# tests/harness/serve.py の CLI 契約を 1 発で目視する（受入には含めない・closure.sh からも呼ばない）。
#   使い方: bash tests/harness/smoke.sh [port]   （既定 8790）
# 非対話 bash は job control が無効なので %1 ではなく $! で PID を掴み、trap で必ず落とす。
set -u
cd "$(dirname "$0")/../.."

PORT="${1:-8790}"
BASE="http://127.0.0.1:${PORT}"

python3 tests/harness/serve.py --port "$PORT" &
PID=$!
trap 'kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null' EXIT

# 起動待ち（foreground の sleep はツール側でブロックされうるので curl の再試行で待つ）
curl -s --retry 30 --retry-delay 1 --retry-all-errors -o /dev/null "$BASE/" || {
  echo "smoke: ハーネスが起動しなかった"; exit 1; }

echo "--- GET / ---"
curl -sI "$BASE/"
echo "--- GET /index.html ---"
curl -sI "$BASE/index.html"
echo "smoke: done"
