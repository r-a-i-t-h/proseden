#!/bin/sh
# Proseden install moved to node-vps-kit.
# Kept as a thin shim for one release cycle / local pack testing.
set -eu

KIT_LIB=/usr/local/lib/node-vps-kit
KIT_URL="https://raw.githubusercontent.com/r-a-i-t-h/node-vps-kit/main/install.sh"

if [ -x "$KIT_LIB/install.sh" ]; then
  exec "$KIT_LIB/install.sh" --app proseden "$@"
fi

if [ "$(id -u)" -eq 0 ] && command -v curl >/dev/null 2>&1; then
  echo "proseden-install: bootstrapping node-vps-kit…" >&2
  exec curl -fsSL "$KIT_URL" | bash -s -- --app proseden "$@"
fi

cat >&2 <<'EOF'
Proseden install is provided by node-vps-kit.

  curl -fsSL https://raw.githubusercontent.com/r-a-i-t-h/node-vps-kit/main/install.sh \
    | sudo bash -s -- --app proseden --name NAME --server-name HOST --port PORT

Or install the kit once, then: sudo proseden-install …
EOF
exit 1
