#!/bin/sh
# Install the repo's tracked hooks (.githooks/) by pointing git at them.
#
#   ./.githooks/install.sh
#
# Run this ONCE per clone. `.git/hooks` is not versioned, so the hook lives in
# `.githooks/` (tracked) and git is told to look there.
set -eu

cd "$(dirname "$0")/.."

if [ ! -f .githooks/pre-commit ]; then
  echo "x .githooks/pre-commit tidak ditemukan - jalankan dari clone repo ini" >&2
  exit 1
fi

chmod +x .githooks/pre-commit
git config core.hooksPath .githooks

printf 'OK core.hooksPath = %s\n' "$(git config --get core.hooksPath)"
printf 'OK hook aktif     = %s\n' "$(ls -1 .githooks | tr '\n' ' ')"
printf '\nUji cepat: git add -f .env && git commit  (harus DITOLAK)\n'
