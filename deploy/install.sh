#!/bin/sh
# Install one Proseden instance on a Linux VPS (nginx + systemd).
# Usage: see DEPLOY.md
set -eu

DEFAULT_REPO="r-a-i-t-h/proseden"
DEFAULT_PREFIX="/opt/proseden"
DEFAULT_USER="proseden"

PREFIX=$DEFAULT_PREFIX
NAME=
PORT=3336
BASE_PATH=
SERVER_NAME=
NGINX_SITE=
REPO=$DEFAULT_REPO
VERSION=latest
TARBALL=
APP_USER=$DEFAULT_USER
SKIP_NGINX=0

usage() {
  cat <<'EOF'
Install a Proseden instance (downloads a GitHub Release, systemd, nginx).

Usage:
  install.sh --name NAME (--server-name HOST | --nginx-site FILE --base-path PATH)
             [options]

Required:
  --name NAME           Instance id (directory + service name), e.g. www, test, raith

One of:
  --server-name HOST    New nginx site for this hostname (app at /)
  --nginx-site FILE     Existing nginx server file; add a path-mount include
  --base-path PATH      URL prefix for --nginx-site (e.g. raith → /raith/)

Optional:
  --port PORT           Loopback port (default: 3336; unique per instance)
  --prefix DIR          Parent directory (default: /opt/proseden)
  --repo OWNER/REPO     GitHub repo (default: r-a-i-t-h/proseden)
  --version TAG         Release tag or "latest" (default: latest)
  --tarball FILE        Use a local .tar.gz instead of downloading
  --user NAME           System user to run the app (default: proseden)
  --skip-nginx          Install app + systemd only
  -h, --help            Show this help

Examples:
  install.sh --name www  --server-name www.proseden.co.uk  --port 3336
  install.sh --name test --server-name test.proseden.co.uk --port 3337
  install.sh --name raith --base-path raith --port 3338 \
    --nginx-site /etc/nginx/sites-enabled/proseden.co.uk
EOF
}

err() { echo "install: $*" >&2; exit 1; }
info() { echo "install: $*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --prefix) PREFIX=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;;
    --port) PORT=$2; shift 2 ;;
    --base-path) BASE_PATH=$2; shift 2 ;;
    --server-name) SERVER_NAME=$2; shift 2 ;;
    --nginx-site) NGINX_SITE=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --version) VERSION=$2; shift 2 ;;
    --tarball) TARBALL=$2; shift 2 ;;
    --user) APP_USER=$2; shift 2 ;;
    --skip-nginx) SKIP_NGINX=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "unknown option: $1 (try --help)" ;;
  esac
done

[ -n "$NAME" ] || { usage >&2; err "--name is required"; }

case "$NAME" in
  *[!a-zA-Z0-9_-]* | '' | -* | *_ ) err "--name must be letters, digits, hyphen, or underscore" ;;
esac
case "$PORT" in
  *[!0-9]* | '') err "--port must be a number" ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  err "--port out of range"
fi

BASE_PATH=$(echo "$BASE_PATH" | sed 's#^/##; s#/$##')

if [ "$SKIP_NGINX" -eq 0 ]; then
  if [ -n "$SERVER_NAME" ] && [ -n "$NGINX_SITE" ]; then
    err "use either --server-name (new site) or --nginx-site (path mount), not both"
  fi
  if [ -z "$SERVER_NAME" ] && [ -z "$NGINX_SITE" ]; then
    err "provide --server-name HOST or --nginx-site FILE (or --skip-nginx)"
  fi
  if [ -n "$NGINX_SITE" ] && [ -z "$BASE_PATH" ]; then
    err "--nginx-site requires --base-path (path mounts need a URL prefix)"
  fi
  if [ -n "$SERVER_NAME" ] && [ -n "$BASE_PATH" ]; then
    err "--server-name installs the app at /; omit --base-path (use --nginx-site for /name/)"
  fi
fi

[ "$(id -u)" -eq 0 ] || err "run as root (sudo)"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || err "missing command: $1"
}

need_cmd curl
need_cmd tar
need_cmd sed
need_cmd node
need_cmd systemctl
if [ "$SKIP_NGINX" -eq 0 ]; then
  need_cmd nginx
fi

NODE=$(command -v node)
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js >= 20 required (found $(node -v)). Install a system-wide Node, not only nvm — see DEPLOY.md"
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
  body=$(curl -fsSL $auth "$api") || err "could not read $api (repo public? release published?)"
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

INSTANCE="$PREFIX/$NAME"
RELEASES="$INSTANCE/releases"
DATA="$INSTANCE/data"
ENV_FILE="$INSTANCE/env"
SERVICE="proseden-$NAME"

if [ -d "$INSTANCE/current" ] && [ -f "$ENV_FILE" ]; then
  err "instance '$NAME' already exists at $INSTANCE (use update.sh to upgrade)"
fi

TAG=$(resolve_tag "$VERSION")
info "release $TAG → $INSTANCE"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -n "$TARBALL" ]; then
  [ -f "$TARBALL" ] || err "tarball not found: $TARBALL"
  ARCHIVE=$TARBALL
else
  ARCHIVE="$TMP/proseden.tar.gz"
  download_release "$TAG" "$ARCHIVE"
fi

tar -tzf "$ARCHIVE" >/dev/null || err "not a readable tar.gz: $ARCHIVE"
tar -xzf "$ARCHIVE" -C "$TMP"
[ -d "$TMP/proseden/dist" ] || err "archive missing proseden/dist"
[ -f "$TMP/proseden/dist/server.js" ] || err "archive missing server.js"
if [ -f "$TMP/proseden/VERSION" ]; then
  TAG=$(tr -d ' \n' <"$TMP/proseden/VERSION")
fi

mkdir -p "$RELEASES" "$DATA"
REL_DIR="$RELEASES/$TAG"
if [ -e "$REL_DIR" ]; then
  rm -rf "$REL_DIR"
fi
mv "$TMP/proseden" "$REL_DIR"
ln -sfn "$REL_DIR" "$INSTANCE/current"

if ! id "$APP_USER" >/dev/null 2>&1; then
  info "creating system user $APP_USER"
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --home "$PREFIX" --shell /usr/sbin/nologin "$APP_USER" || \
      useradd --system --home "$PREFIX" --shell /bin/false "$APP_USER"
  else
    err "cannot create user $APP_USER (no useradd)"
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  cat >"$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$PORT
PROSEDEN_DATA=$DATA
PROSEDEN_SEED=$INSTANCE/current/seed
PROSEDEN_BASE_PATH=$BASE_PATH
PROSEDEN_SECURE_COOKIES=1
PROSEDEN_MANAGERS=
EOF
  info "wrote $ENV_FILE"
fi

chown -R "$APP_USER:$APP_USER" "$INSTANCE"

UNIT_SRC="$REL_DIR/deploy/proseden.service"
[ -f "$UNIT_SRC" ] || err "missing $UNIT_SRC"
UNIT_DEST="/etc/systemd/system/${SERVICE}.service"
sed \
  -e "s|__NAME__|$NAME|g" \
  -e "s|__PREFIX__|$PREFIX|g" \
  -e "s|__USER__|$APP_USER|g" \
  -e "s|__NODE__|$NODE|g" \
  "$UNIT_SRC" >"$UNIT_DEST"

systemctl daemon-reload
systemctl enable --now "$SERVICE"
sleep 1
if ! systemctl is-active --quiet "$SERVICE"; then
  journalctl -u "$SERVICE" -n 40 --no-pager || true
  err "service $SERVICE failed to start"
fi
info "started $SERVICE"

install_sbin() {
  src=$1
  dest=$2
  cp "$src" "$dest"
  chmod 755 "$dest"
}

if [ -f "$REL_DIR/deploy/install.sh" ]; then
  install_sbin "$REL_DIR/deploy/install.sh" /usr/local/sbin/proseden-install
fi
if [ -f "$REL_DIR/deploy/update.sh" ]; then
  install_sbin "$REL_DIR/deploy/update.sh" /usr/local/sbin/proseden-update
fi

ensure_http_includes() {
  conf=/etc/nginx/nginx.conf
  [ -f "$conf" ] || err "nginx.conf not found at $conf"
  if grep -qE 'include[[:space:]]+.*/(conf\.d|sites-enabled)' "$conf"; then
    return 0
  fi
  info "adding include /etc/nginx/conf.d/*.conf; to $conf"
  cp "$conf" "$conf.proseden.bak"
  mkdir -p /etc/nginx/conf.d
  awk '
    BEGIN { done = 0 }
    /^[[:space:]]*http[[:space:]]*\{/ { print; if (!done) { print "    include /etc/nginx/conf.d/*.conf;"; done = 1 } next }
    { print }
  ' "$conf.proseden.bak" >"$conf"
}

insert_include_in_server() {
  site=$1
  include_line=$2
  if grep -qF "$include_line" "$site"; then
    info "nginx already includes $include_line"
    return 0
  fi
  servers=$(grep -cE '^[[:space:]]*server[[:space:]]*\{' "$site" || true)
  if [ "$servers" -ne 1 ]; then
    echo "install: $site has $servers server blocks — add this line inside the right server { } yourself:" >&2
    echo "    $include_line" >&2
    return 0
  fi
  cp "$site" "$site.proseden.bak"
  awk -v inc="$include_line" '
    { lines[NR] = $0 }
    END {
      last = 0
      for (i = NR; i >= 1; i--) {
        if (lines[i] ~ /^[[:space:]]*}[[:space:]]*$/) { last = i; break }
      }
      for (i = 1; i <= NR; i++) {
        if (i == last) print "    " inc
        print lines[i]
      }
    }
  ' "$site.proseden.bak" >"$site"
  info "inserted include into $site"
}

if [ "$SKIP_NGINX" -eq 0 ]; then
  ensure_http_includes
  mkdir -p /etc/nginx/conf.d
  cp "$REL_DIR/deploy/nginx/timed-log.conf" /etc/nginx/conf.d/proseden-timed-log.conf
  render() {
    sed \
      -e "s|__NAME__|$NAME|g" \
      -e "s|__PORT__|$PORT|g" \
      -e "s|__SERVER_NAME__|$SERVER_NAME|g" \
      -e "s|__BASE_PATH__|$BASE_PATH|g" \
      "$1"
  }

  if [ -n "$SERVER_NAME" ]; then
    rendered=$(render "$REL_DIR/deploy/nginx/site.conf")
    if [ -d /etc/nginx/sites-available ]; then
      dest=/etc/nginx/sites-available/proseden-$NAME
      printf '%s\n' "$rendered" >"$dest"
      ln -sfn "$dest" /etc/nginx/sites-enabled/proseden-$NAME
      info "wrote $dest and enabled it"
    else
      mkdir -p /etc/nginx/conf.d
      dest=/etc/nginx/conf.d/proseden-$NAME.conf
      printf '%s\n' "$rendered" >"$dest"
      info "wrote $dest"
    fi
  else
    [ -f "$NGINX_SITE" ] || err "nginx site file not found: $NGINX_SITE"
    mkdir -p /etc/nginx/snippets
    dest=/etc/nginx/snippets/proseden-$NAME.conf
    render "$REL_DIR/deploy/nginx/location.conf" >"$dest"
    info "wrote $dest"
    insert_include_in_server "$NGINX_SITE" "include /etc/nginx/snippets/proseden-$NAME.conf;"
  fi

  nginx -t
  if systemctl is-active --quiet nginx; then
    systemctl reload nginx
  else
    systemctl enable --now nginx
  fi
  info "nginx reloaded"
fi

HEALTH="http://127.0.0.1:$PORT"
if [ -n "$BASE_PATH" ]; then
  HEALTH="$HEALTH/$BASE_PATH/health"
else
  HEALTH="$HEALTH/health"
fi
code=$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH" || true)
if [ "$code" != "200" ]; then
  info "warning: $HEALTH returned HTTP ${code:-none} (service may still be starting)"
else
  info "health check ok ($HEALTH)"
fi

cat <<EOF

Instance '$NAME' is installed.

  App:      $INSTANCE/current  ($TAG)
  Data:     $DATA
  Env:      $ENV_FILE
  Service:  systemctl status $SERVICE
  Logs:     journalctl -u $SERVICE -f

Next:
  - Point DNS for this host at this VPS (A / AAAA).
  - Open ports 80 and 443 on the firewall (see DEPLOY.md).
  - After DNS works: sudo certbot --nginx -d ${SERVER_NAME:-your.domain}
  - Later upgrades: sudo proseden-update --name $NAME

Seed login (change it): admin / admin
EOF
