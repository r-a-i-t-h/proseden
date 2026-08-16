#!/bin/sh
# Proseden update moved to node-vps-kit.
# Kept as a thin shim for one release cycle / local pack testing.
set -eu

KIT_LIB=/usr/local/lib/node-vps-kit
KIT_URL="https://raw.githubusercontent.com/r-a-i-t-h/node-vps-kit/main/update.sh"

if [ -x "$KIT_LIB/update.sh" ]; then
  exec "$KIT_LIB/update.sh" --app proseden "$@"
fi

if [ "$(id -u)" -eq 0 ] && command -v curl >/dev/null 2>&1; then
  echo "proseden-update: bootstrapping node-vps-kit…" >&2
  exec curl -fsSL "$KIT_URL" | bash -s -- --app proseden "$@"
fi

cat >&2 <<'EOF'
Proseden update is provided by node-vps-kit.

  curl -fsSL https://raw.githubusercontent.com/r-a-i-t-h/node-vps-kit/main/update.sh \
    | sudo bash -s -- --app proseden --name NAME

Or install the kit once (via install), then: sudo proseden-update --name NAME
EOF
exit 1
