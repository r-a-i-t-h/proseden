#!/bin/sh
# Upgrade one Proseden instance to a newer GitHub Release.
# Replaces the app copy; does not re-seed or rewrite data/ or env.
set -eu

DEFAULT_REPO="r-a-i-t-h/proseden"
DEFAULT_PREFIX="/opt/proseden"

PREFIX=$DEFAULT_PREFIX
NAME=
REPO=$DEFAULT_REPO
VERSION=latest
TARBALL=

usage() {
  cat <<'EOF'
Update one Proseden instance to a release. Does not touch data/ or env.

Usage:
  update.sh --name NAME [options]

Required:
  --name NAME           Instance id (www, test, raith, …)

Optional:
  --prefix DIR          Parent directory (default: /opt/proseden)
  --repo OWNER/REPO     GitHub repo (default: r-a-i-t-h/proseden)
  --version TAG         Release tag or "latest" (default: latest)
  --tarball FILE        Use a local .tar.gz instead of downloading
  -h, --help            Show this help

Example (try test first, then promote www):
  update.sh --name test --version v0.2.0
  update.sh --name www  --version v0.2.0
EOF
}

err() { echo "update: $*" >&2; exit 1; }
info() { echo "update: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --version) VERSION=$2; shift 2 ;;
    --tarball) TARBALL=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown option: $1 (try --help)" ;;
  esac
done

[ -n "$NAME" ] || { usage >&2; err "--name is required"; }
[ "$(id -u)" -eq 0 ] || err "run as root (sudo)"

INSTANCE="$PREFIX/$NAME"
ENV_FILE="$INSTANCE/env"
RELEASES="$INSTANCE/releases"
SERVICE="proseden-$NAME"

[ -d "$INSTANCE" ] || err "instance not found: $INSTANCE (install first)"
[ -f "$ENV_FILE" ] || err "missing $ENV_FILE"
[ -L "$INSTANCE/current" ] || [ -d "$INSTANCE/current" ] || err "missing $INSTANCE/current"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "missing command: $1"
}
need_cmd curl
need_cmd tar
need_cmd systemctl

DATA=$(sed -n 's/^PROSEDEN_DATA=//p' "$ENV_FILE" | head -n 1)
[ -n "$DATA" ] || DATA="$INSTANCE/data"
BACKUP=$(sed -n 's/^PROSEDEN_BACKUP=//p' "$ENV_FILE" | head -n 1)
[ -n "$BACKUP" ] || BACKUP="$INSTANCE/backup"

APP_USER=proseden
if [ -f "/etc/systemd/system/${SERVICE}.service" ]; then
  u=$(sed -n 's/^User=//p' "/etc/systemd/system/${SERVICE}.service" | head -n 1)
  [ -n "$u" ] && APP_USER=$u
fi

resolve_tag() {
  ver=$1
  if [ "$ver" != "latest" ]; then
    case "$ver" in
      v*) echo "$ver" ;;
      *) echo "v$ver" ;;
    esac
    return
  fi
  api="https://api.github.com/repos/$REPO/releases/latest"
  auth=
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth="-H Authorization: Bearer $GITHUB_TOKEN"
  fi
  # shellcheck disable=SC2086
  body=$(curl -fsSL $auth "$api") || err "could not read $api"
  tag=$(printf '%s\n' "$body" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$tag" ] || err "latest release has no tag_name"
  printf '%s\n' "$tag"
}

download_release() {
  tag=$1
  dest=$2
  url="https://github.com/$REPO/releases/download/$tag/proseden.tar.gz"
  auth=
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    auth="-H Authorization: Bearer $GITHUB_TOKEN"
  fi
  info "downloading $url"
  # shellcheck disable=SC2086
  curl -fL $auth -o "$dest" "$url" || err "download failed: $url"
}

current_tag() {
  if [ -f "$INSTANCE/current/VERSION" ]; then
    tr -d ' \n' <"$INSTANCE/current/VERSION"
    return
  fi
  readlink "$INSTANCE/current" 2>/dev/null | sed 's#.*/##' || true
}

TAG=$(resolve_tag "$VERSION")
PREV=$(current_tag)
if [ "$PREV" = "$TAG" ] && [ -z "$TARBALL" ]; then
  info "already on $TAG — nothing to do"
  exit 0
fi

info "upgrading $NAME: ${PREV:-unknown} → $TAG"

# Snapshot data before downloading or swapping the app
[ -d "$DATA" ] || err "data directory missing: $DATA"
mkdir -p "$BACKUP"
BACKUP_NAME=$(date -u +%Y-%m-%dT%H%M%SZ).tar.gz
BACKUP_DEST="$BACKUP/$BACKUP_NAME"
info "backing up data to $BACKUP_DEST"
tar -czf "$BACKUP_DEST.partial" -C "$DATA" . || {
  rm -f "$BACKUP_DEST.partial"
  err "data backup failed — update aborted"
}
mv "$BACKUP_DEST.partial" "$BACKUP_DEST"
if id "$APP_USER" >/dev/null 2>&1; then
  chown -R "$APP_USER:$APP_USER" "$BACKUP"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -n "$TARBALL" ]; then
  [ -f "$TARBALL" ] || err "tarball not found: $TARBALL"
  ARCHIVE=$TARBALL
else
  ARCHIVE="$TMP/proseden.tar.gz"
  download_release "$TAG" "$ARCHIVE"
fi

tar -xzf "$ARCHIVE" -C "$TMP"
[ -f "$TMP/proseden/dist/server.js" ] || err "archive missing server.js"
if [ -f "$TMP/proseden/VERSION" ]; then
  TAG=$(tr -d ' \n' <"$TMP/proseden/VERSION")
fi

mkdir -p "$RELEASES"
REL_DIR="$RELEASES/$TAG"
if [ -e "$REL_DIR" ]; then
  rm -rf "$REL_DIR"
fi
mv "$TMP/proseden" "$REL_DIR"

# Keep env pointing at this instance's data; refresh seed path to new tree
if grep -q '^PROSEDEN_SEED=' "$ENV_FILE"; then
  sed -i.bak "s|^PROSEDEN_SEED=.*|PROSEDEN_SEED=$INSTANCE/current/seed|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
fi

ln -sfn "$REL_DIR" "$INSTANCE/current"

if id "$APP_USER" >/dev/null 2>&1; then
  chown -R "$APP_USER:$APP_USER" "$REL_DIR" "$INSTANCE/current"
fi

export PROSEDEN_DATA=$DATA
export PROSEDEN_BACKUP=$BACKUP
export PROSEDEN_SEED=$INSTANCE/current/seed

HOOK="$INSTANCE/current/deploy/post-update.sh"
if [ -f "$HOOK" ]; then
  chmod +x "$HOOK" || true
  info "running post-update hook"
  if id "$APP_USER" >/dev/null 2>&1; then
    su -s /bin/sh -c "$HOOK" "$APP_USER" || err "post-update.sh failed — current still points at $TAG; previous tree is in $RELEASES"
  else
    sh "$HOOK" || err "post-update.sh failed"
  fi
fi

systemctl restart "$SERVICE"
sleep 1
if ! systemctl is-active --quiet "$SERVICE"; then
  journalctl -u "$SERVICE" -n 40 --no-pager || true
  err "service $SERVICE failed after update"
fi

if [ -f "$REL_DIR/deploy/update.sh" ]; then
  cp "$REL_DIR/deploy/update.sh" /usr/local/sbin/proseden-update
  chmod 755 /usr/local/sbin/proseden-update
fi
if [ -f "$REL_DIR/deploy/install.sh" ]; then
  cp "$REL_DIR/deploy/install.sh" /usr/local/sbin/proseden-install
  chmod 755 /usr/local/sbin/proseden-install
fi

# Keep current + one previous release
keep=$TAG
if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
  keep="$keep $PREV"
fi
for dir in "$RELEASES"/*; do
  [ -d "$dir" ] || continue
  base=$(basename "$dir")
  skip=0
  for k in $keep; do
    [ "$base" = "$k" ] && skip=1
  done
  if [ "$skip" -eq 0 ]; then
    info "removing old release $base"
    rm -rf "$dir"
  fi
done

info "updated $NAME to $TAG (data untouched: $DATA)"
info "status: systemctl status $SERVICE"
