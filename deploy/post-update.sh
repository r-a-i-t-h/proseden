#!/bin/sh
# Run after this instance's app has been swapped to a new release and before
# systemd restarts the process.
#
# Environment:
#   PROSEDEN_DATA   this instance's data directory (never re-seed it)
#   PROSEDEN_SEED   seed tree from the new release (reference only)
#
# Applies deploy/migrations/NNN-*.sh where NNN is greater than the current
# schemaVersion (missing / non-numeric = 0). Exit non-zero to abort the
# update (the previous release directory is kept).
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec "$ROOT/migrate.sh"
