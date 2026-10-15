#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 or newer: https://nodejs.org/'
  exit 1
fi
exec node scripts/launch.mjs
