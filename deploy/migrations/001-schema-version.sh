#!/bin/sh
# Stamp schemaVersion: 1 on meta.json. Leaves every other key untouched.
set -eu

[ -n "${PROSEDEN_DATA:-}" ] || {
  echo "001-schema-version: PROSEDEN_DATA is required" >&2
  exit 1
}

node -e '
const fs = require("fs");
const path = require("path");
const metaPath = path.join(process.env.PROSEDEN_DATA, "meta.json");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
meta.schemaVersion = 1;
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
'
