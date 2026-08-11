#!/bin/sh
# Rewrite pedia:/srch:/media: link prefixes in scene and artefact prose.
set -eu

[ -n "${PROSEDEN_DATA:-}" ] || {
  echo "002-rewrite-link-schemes: PROSEDEN_DATA is required" >&2
  exit 1
}

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec node "$DIR/002-rewrite-link-schemes.mjs"
