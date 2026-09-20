#!/bin/sh
# Rewrite personal quest namespaces from <username>.* to user.<username>.*.
set -eu

[ -n "${PROSEDEN_DATA:-}" ] || {
  echo "005-user-quest-namespace: PROSEDEN_DATA is required" >&2
  exit 1
}

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec node "$DIR/005-user-quest-namespace.mjs"
