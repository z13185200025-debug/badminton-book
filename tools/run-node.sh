#!/bin/zsh
BADMINTON_DIR="$(cd -- "$(dirname -- "$0")/.." && pwd)"
BADMINTON_NODE="$(command -v node 2>/dev/null)"
for BADMINTON_CANDIDATE in "$BADMINTON_DIR/runtime/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [[ -z "$BADMINTON_NODE" && -x "$BADMINTON_CANDIDATE" ]]; then BADMINTON_NODE="$BADMINTON_CANDIDATE"; fi
done
if [[ -z "$BADMINTON_NODE" ]]; then
  print '没有找到 Node.js。请从 https://nodejs.org/ 安装 Node.js 22 或更高版本，然后重新打开。'
  exit 1
fi
exec "$BADMINTON_NODE" "$@"
