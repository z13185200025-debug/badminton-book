#!/bin/sh
set -eu
BADMINTON_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$BADMINTON_DIR"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js 22+ is required. Install Node.js LTS from https://nodejs.org/ then retry.' >&2
  exit 1
fi
exec node "$BADMINTON_DIR/tools/start-app.mjs" "$@"
