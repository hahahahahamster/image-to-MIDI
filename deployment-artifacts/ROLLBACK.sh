#!/usr/bin/env sh
set -eu
ORIGINAL_HASH="a302a2600f8d6d8e845fcda7d3dcc806868382e7"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT"
git cat-file -e "$ORIGINAL_HASH^{commit}"
git reset --hard "$ORIGINAL_HASH"
git clean -fd -- public package.json tests wrangler.jsonc
if [ -e public/index.html ]; then PUBLIC_STATE="present"; else PUBLIC_STATE="absent"; fi
if [ -e package.json ]; then PACKAGE_STATE="present"; else PACKAGE_STATE="absent"; fi
printf 'ROLLBACK source_head=%s public_index=%s package_json=%s original_flask=%s\n' "$(git rev-parse HEAD)" "$PUBLIC_STATE" "$PACKAGE_STATE" "$(test -f app.py && printf present || printf absent)"
