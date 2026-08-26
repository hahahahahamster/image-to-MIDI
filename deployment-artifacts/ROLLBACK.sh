#!/usr/bin/env sh
set -eu
ORIGINAL_HASH="7cfdbf7ac5f5aaf80956168bf133fb2207704749"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
git cat-file -e "$ORIGINAL_HASH^{commit}"
git reset --hard "$ORIGINAL_HASH"
git clean -fd -- public package.json tests wrangler.jsonc
if [ -e public/index.html ]; then PUBLIC_STATE="present"; else PUBLIC_STATE="absent"; fi
if [ -e package.json ]; then PACKAGE_STATE="present"; else PACKAGE_STATE="absent"; fi
printf 'ROLLBACK source_head=%s public_index=%s package_json=%s original_flask=%s\n' "$(git rev-parse HEAD)" "$PUBLIC_STATE" "$PACKAGE_STATE" "$(test -f app.py && printf present || printf absent)"
