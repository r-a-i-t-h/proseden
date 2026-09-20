#!/bin/sh
# Convert users/*.badges.json from string ids to { badge, grantTime? } objects.
set -eu

[ -n "${PROSEDEN_DATA:-}" ] || {
  echo "004-badge-objects: PROSEDEN_DATA is required" >&2
  exit 1
}

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec node "$DIR/004-badge-objects.mjs"
