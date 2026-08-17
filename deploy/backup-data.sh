#!/bin/sh
# Archive this instance's data/ into a timestamped tarball under backup/.
# Does not include the app tree.
#
# Environment:
#   PROSEDEN_DATA     live world directory (required)
#   PROSEDEN_BACKUP   archive directory (default: sibling "backup" of data/)
set -eu

err() { echo "backup-data: $*" >&2; exit 1; }

DATA=${PROSEDEN_DATA:-}
[ -n "$DATA" ] || err "PROSEDEN_DATA is required"
[ -d "$DATA" ] || err "data directory missing: $DATA"
command -v tar >/dev/null 2>&1 || err "tar is required"

BACKUP=${PROSEDEN_BACKUP:-}
if [ -z "$BACKUP" ]; then
  BACKUP=$(dirname "$DATA")/backup
fi

mkdir -p "$BACKUP"
NAME=$(date -u +%Y-%m-%dT%H%M%SZ).tar.gz
DEST="$BACKUP/$NAME"
PARTIAL="$DEST.partial"

tar -czf "$PARTIAL" --exclude=.sessions.json -C "$DATA" . || {
  rm -f "$PARTIAL"
  err "tar failed"
}
mv "$PARTIAL" "$DEST"
echo "$DEST"
