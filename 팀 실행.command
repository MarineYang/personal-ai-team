#!/bin/zsh
cd "${0:A:h}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 24 이상을 먼저 설치해주세요: https://nodejs.org/'
  read '?Enter 키를 누르면 닫습니다. '
  exit 1
fi
node scripts/launch.mjs
