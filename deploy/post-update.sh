#!/bin/sh
# Run after this instance's app has been swapped to a new release and before
# systemd restarts the process.
#
# Environment:
#   PROSEDEN_DATA   this instance's data directory (never re-seed it)
#   PROSEDEN_SEED   seed tree from the new release (reference only)
#
# Add versioned migrations here later, e.g. rewrite a field in meta.json.
# Exit non-zero to abort the update (the previous release directory is kept).
set -eu

echo "post-update: no data migrations in this release (data=$PROSEDEN_DATA)"
exit 0
