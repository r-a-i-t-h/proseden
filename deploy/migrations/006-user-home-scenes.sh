#!/bin/sh
# Create a permanent home scene for every user; stamp schemaVersion 6.
set -eu

[ -n "${PROSEDEN_DATA:-}" ] || {
  echo "006-user-home-scenes: PROSEDEN_DATA is required" >&2
  exit 1
}

DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec node "$DIR/006-user-home-scenes.mjs"
