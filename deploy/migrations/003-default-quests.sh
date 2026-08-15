#!/bin/sh
# Create quests/ and alchemy/ if missing; copy default seed quests (builders,
# proseden) and empty alchemy recipes when absent. Does not overwrite existing
# files (managers may have edited them).
set -eu

[ -n "${PROSEDEN_DATA:-}" ] || {
  echo "003-default-quests: PROSEDEN_DATA is required" >&2
  exit 1
}

DATA=$PROSEDEN_DATA
if [ -n "${PROSEDEN_SEED:-}" ] && [ -d "$PROSEDEN_SEED" ]; then
  SEED=$PROSEDEN_SEED
else
  SEED=$(CDPATH= cd -- "$(dirname "$0")/../../seed" && pwd)
fi

[ -d "$SEED" ] || {
  echo "003-default-quests: seed not found ($SEED); set PROSEDEN_SEED" >&2
  exit 1
}

mkdir -p "$DATA/quests" "$DATA/alchemy"

for q in builders proseden; do
  src="$SEED/quests/$q.json"
  dst="$DATA/quests/$q.json"
  if [ -f "$dst" ]; then
    echo "003-default-quests: keep existing quest $q"
  elif [ -f "$src" ]; then
    cp "$src" "$dst"
    echo "003-default-quests: installed quest $q"
  else
    echo "003-default-quests: missing seed quest $q ($src)" >&2
    exit 1
  fi
done

if [ -f "$DATA/alchemy/recipes.json" ]; then
  echo "003-default-quests: keep existing alchemy/recipes.json"
elif [ -f "$SEED/alchemy/recipes.json" ]; then
  cp "$SEED/alchemy/recipes.json" "$DATA/alchemy/recipes.json"
  echo "003-default-quests: installed alchemy/recipes.json"
else
  printf '%s\n' '[]' >"$DATA/alchemy/recipes.json"
  echo "003-default-quests: created empty alchemy/recipes.json"
fi

node -e '
const fs = require("fs");
const path = require("path");
const metaPath = path.join(process.env.PROSEDEN_DATA, "meta.json");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
meta.schemaVersion = 3;
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
'
