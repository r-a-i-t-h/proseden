#!/bin/sh
# Apply pending schema migrations to this instance's data/.
#
# Environment:
#   PROSEDEN_DATA   this instance's data directory (required; never re-seed)
set -eu

err() { echo "migrate: $*" >&2; exit 1; }

DATA=${PROSEDEN_DATA:-}
[ -n "$DATA" ] || err "PROSEDEN_DATA is required"
META="$DATA/meta.json"
[ -f "$META" ] || err "meta.json missing: $META (will not re-seed)"
command -v node >/dev/null 2>&1 || err "node is required"

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
MIGDIR="$ROOT/migrations"

read_version() {
  node -e '
const fs = require("fs");
const meta = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const v = Number(meta.schemaVersion);
process.stdout.write(Number.isFinite(v) ? String(Math.trunc(v)) : "0");
' "$META"
}

decimal() {
  # Strip leading zeros so POSIX $(( )) never treats NNN as octal.
  echo "$1" | sed 's/^0*//'
}

CURRENT=$(read_version)
APPLIED=0

for SCRIPT in "$MIGDIR"/[0-9][0-9][0-9]-*.sh; do
  [ -f "$SCRIPT" ] || continue
  BASE=$(basename "$SCRIPT")
  NNN=${BASE%%-*}
  NNN_DEC=$(decimal "$NNN")
  [ -n "$NNN_DEC" ] || NNN_DEC=0

  if [ "$NNN_DEC" -gt "$CURRENT" ]; then
    echo "migrate: applying $BASE (from schema $CURRENT)"
    sh "$SCRIPT" || err "$BASE failed"
    NEW=$(read_version)
    [ "$NEW" -eq "$NNN_DEC" ] || err "$BASE left schemaVersion=$NEW, expected $NNN_DEC"
    CURRENT=$NEW
    APPLIED=$((APPLIED + 1))
  fi
done

if [ "$APPLIED" -eq 0 ]; then
  echo "migrate: already at schema $CURRENT (data=$DATA)"
else
  echo "migrate: now at schema $CURRENT (data=$DATA)"
fi
