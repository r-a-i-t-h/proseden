#!/bin/sh
# Build a deployable tarball: compiled app, client assets, seed, production
# node_modules, and deploy scripts. Never includes instance data/.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

if [ ! -f package.json ]; then
  echo "pack-release: run from the repo (package.json missing)" >&2
  exit 1
fi

VERSION=${VERSION:-}
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
fi
case "$VERSION" in
  v*) TAG=$VERSION ;;
  *) TAG="v$VERSION" ;;
esac

echo "pack-release: installing dependencies"
npm ci

echo "pack-release: building ($TAG)"
npm run build

if [ ! -f dist/server.js ]; then
  echo "pack-release: dist/server.js missing after build" >&2
  exit 1
fi
if [ ! -d public/assets ]; then
  echo "pack-release: public/assets missing after build" >&2
  exit 1
fi

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

DEST="$STAGE/proseden"
mkdir -p "$DEST"

cp -R dist public seed deploy package.json package-lock.json "$DEST/"
printf '%s\n' "$TAG" >"$DEST/VERSION"
chmod 755 "$DEST/deploy/install.sh" "$DEST/deploy/update.sh" "$DEST/deploy/post-update.sh" \
  "$DEST/deploy/backup-data.sh" "$DEST/deploy/migrate.sh"
if [ -d "$DEST/deploy/migrations" ]; then
  find "$DEST/deploy/migrations" -name '*.sh' -exec chmod 755 {} +
fi

echo "pack-release: production node_modules"
(
  cd "$DEST"
  npm ci --omit=dev
)

# Drop junk that is not needed at runtime
rm -f "$DEST/package-lock.json"
find "$DEST" -name '*.map' -delete

OUT_DIR="$ROOT/dist-release"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/proseden.tar.gz"
NAMED="$OUT_DIR/proseden-$TAG.tar.gz"

tar -czf "$OUT" -C "$STAGE" proseden
cp "$OUT" "$NAMED"

echo "pack-release: wrote $OUT"
echo "pack-release: wrote $NAMED"
ls -lh "$OUT" "$NAMED"
