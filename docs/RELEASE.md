# Proseden release build

This is the maintainer walkthrough of how a version bump becomes a tarball a VPS can install. The operator-facing install/update steps live in [DEPLOY.md](../DEPLOY.md). This document is the *why* and *how* of packaging.

The VPS never clones this git repo. `dist/` is not in git. A running instance downloads a **built** archive from a GitHub Release: compiled server, client CSS/JS, seed world, production libraries, and deploy hooks.

```
laptop                          GitHub                            VPS
──────                          ──────                            ───
npm run release -- --patch
  bump package.json
  commit "Bump to X.Y.Z."
  tag vX.Y.Z
  git push origin HEAD + tag  →  workflow on tags "v*"
                                   checkout tagged commit
                                   npm run pack
                                     (scripts/pack-release.sh)
                                   gh release create
                                     + attach tarballs     →  proseden-install / -update
                                                                download proseden.tar.gz
                                                                unpack to releases/vX.Y.Z
                                                                point current, migrate, restart
```

Two scripts, two jobs:

| Command | Where it runs | What it does |
|---|---|---|
| `npm run release -- --patch` (or `--minor` / `--major`) | Your laptop | Bump version, commit, tag, **push**. Does not pack. |
| `npm run pack` | GitHub Actions (or locally, for testing) | Build the app and write `dist-release/*.tar.gz`. |

Pushing the tag is the trigger. Packaging is CI.

## Files involved

| Path | Role |
|---|---|
| `scripts/release.mjs` | Bump, commit, tag, push. |
| `scripts/pack-release.sh` | Clean install, build, stage, tar. |
| `.github/workflows/release.yml` | On `v*` tags: pack, then `gh release create`. |
| `package.json` scripts `release` / `pack` | Thin wrappers around those two files. |
| `package-lock.json` | Pins every npm package. `npm ci` refuses to guess. |
| `.gitignore` | Ignores `dist/`, `dist-release/`, `public/assets/`, `/data/`. |
| `deploy/*.sh` | Shipped *inside* the tarball. Install/update are shims to [node-vps-kit](https://github.com/r-a-i-t-h/node-vps-kit); `post-update.sh` / `migrate.sh` run on the VPS after a swap. |

`dist-release/` is **this repo’s** output directory, not a GitHub platform convention. The pack script writes it; the workflow YAML hardcodes the same path when attaching assets. It is gitignored so local packs never get committed.

---

## 1. Start a release on your laptop

From a clean checkout of the branch you want to ship:

```bash
npm run release -- --patch   # 0.2.3 → 0.2.4
npm run release -- --minor   # 0.2.3 → 0.3.0
npm run release -- --major   # 0.2.3 → 1.0.0
```

`scripts/release.mjs` then, in order:

1. **Refuse to run** unless:
   - you are inside a git repo
   - `git status` is clean (commit or stash other work first)
   - HEAD is a real branch, not detached
   - `package.json` version is exactly `X.Y.Z`
   - the tag `v<next>` does not already exist
2. **Bump** `package.json` `version`.
3. **Rewrite the two root version fields** in `package-lock.json` (top-level `"version"`, then `packages[""].version`). Other `"version"` strings in the lockfile are left alone — those belong to dependencies.
4. **Commit** `Bump to X.Y.Z.`
5. **Create tag** `vX.Y.Z` on that commit.
6. **Push** the current branch *and* the tag: `git push -u origin HEAD <tag>`.

That last push is what GitHub sees. The script stops there. It does not run `npm run pack`, does not talk to `gh`, and does not upload files.

If you only wanted to retag an already-bumped commit, you could `git tag vX.Y.Z && git push origin vX.Y.Z` by hand. The usual path is `npm run release` so the package version and the git tag cannot drift.

---

## 2. GitHub Actions wakes up on the tag

`.github/workflows/release.yml`:

```yaml
on:
  push:
    tags:
      - "v*"
```

`v*` is a **GitHub tag glob**, not a shell glob. `v0.2.4` matches; `release-1` does not.

The job runs on `ubuntu-latest` with `permissions: contents: write` so the later `gh release create` can publish using `GITHUB_TOKEN`.

Steps:

1. **`actions/checkout@v4`** — the workspace is the tagged commit (typically `/home/runner/work/proseden/proseden`).
2. **`actions/setup-node@v4`** — Node **20**, with `cache: npm` keyed off `package-lock.json`. That matches `engines.node` (`>=20`). The cache only speeds `npm ci`; it does not replace the lockfile.
3. **Pack tarball** — `npm run pack`, which is `sh scripts/pack-release.sh`, with:

   ```yaml
   env:
     VERSION: ${{ github.ref_name }}
   ```

   `github.ref_name` for a tag push is the tag itself (`v0.2.4`). That becomes the `VERSION` environment variable inside the pack script.
4. **Publish GitHub Release** — `gh release create` with both tarballs from `dist-release/`, titled with the tag, `--generate-notes` (changelog from commits since the previous tag).

`GITHUB_REF_NAME` in that shell step is the same tag string as `github.ref_name`. The workflow does not bump versions; that already happened on the laptop.

---

## 3. `pack-release.sh`, step by step

This is the same script CI and `npm run pack` locally execute. It is a POSIX `sh` script (`set -eu`: exit on error, exit on unset variables).

### 3.1 Find the repo root

```sh
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"
```

`$0` is `scripts/pack-release.sh`, so `dirname` is `scripts/`, `..` is the repository root. `pwd` makes `ROOT` an **absolute** path. `CDPATH=` is emptied for that `cd` so a user `CDPATH` cannot send the script to the wrong directory.

`ROOT` is set **here**. GitHub does not inject it.

Then the script checks `package.json` exists, so a misplaced invocation fails early.

### 3.2 Decide the tag string

```sh
VERSION=${VERSION:-}
if [ -z "$VERSION" ]; then
  VERSION=$(node -p "require('./package.json').version")
fi
```

`${VERSION:-}` means “use `$VERSION` if set, otherwise empty.” On Actions it is already `v0.2.4`. Locally, with no env var, it reads `package.json` (e.g. `0.2.4`).

A `case` then normalizes: if it already starts with `v`, keep it; otherwise prefix `v`. Either way `TAG` is `v0.2.4`. That string is written into the archive’s `VERSION` file and into the versioned tarball filename.

### 3.3 `npm ci` — a lockfile-strict install

Not `npm install`.

`npm ci` (“clean install”):

- Removes existing `node_modules` if present.
- Installs **exactly** what `package-lock.json` pins.
- **Fails** if `package.json` and the lockfile disagree, instead of rewriting the lockfile.
- Does not update `package-lock.json`.

That is why CI (and this pack script) use it: the tarball’s runtime deps are reproducible. This first `npm ci` is a **full** install, including `devDependencies` (TypeScript, Vite, Vitest types). The next step is a build; those tools are required on the builder, not on the VPS.

### 3.4 Build the app

```sh
npm run build   # vite build && tsc -p tsconfig.build.json
```

Two products, both gitignored:

| Output | From | Used for |
|---|---|---|
| `public/assets/` (`styles.css`, `panel.js`, …) | Vite (`vite.config.ts`: `base: "./"`, `outDir: "public"`) | Browser CSS/JS. `base: "./"` keeps subdirectory deploys working. |
| `dist/server.js` (and the rest of `src/` compiled) | `tsc -p tsconfig.build.json` (`outDir: dist`) | `node dist/server.js` on the VPS. |

Vite is configured with `publicDir: false` and `emptyOutDir: true`, so `public/` is a **build output**, not a source tree of static files.

The script then asserts both `dist/server.js` and `public/assets/` exist. A successful `npm run build` that somehow emitted nothing must not produce a shippable archive.

### 3.5 Stage into a temp directory (`mktemp` + `trap`)

```sh
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

DEST="$STAGE/proseden"
mkdir -p "$DEST"
```

**`mktemp -d`** creates a unique empty directory under the system temp dir (on the Ubuntu runner, typically `/tmp/tmp.XXXXXX`). Packing never writes a half-built tree into the git checkout.

**`trap 'rm -rf "$STAGE"' EXIT`** registers a handler the shell runs when the script exits for **any** reason: success, `set -e` failure, interrupt. The staging tree is always deleted. Only the finished tarballs under `dist-release/` remain.

`DEST` is `$STAGE/proseden` so the tarball’s top-level folder is `proseden/`, not a random `/tmp/...` path.

### 3.6 Copy the payload

```sh
cp -R dist public seed deploy package.json package-lock.json "$DEST/"
printf '%s\n' "$TAG" >"$DEST/VERSION"
```

Then `chmod 755` on the deploy shell scripts (and any `deploy/migrations/*.sh`) so they are executable after unpack, regardless of how git stored the bits.

`package-lock.json` is copied because the *next* `npm ci` needs it. It is deleted after that install.

### 3.7 Second `npm ci` — production `node_modules` inside the archive

```sh
(
  cd "$DEST"
  npm ci --omit=dev
)
```

The subshell (`(` … `)`) cds into the staged copy without changing the script’s own working directory.

`--omit=dev` installs only `dependencies` (`hono`, `@hono/node-server`, `gray-matter`, `yaml`). Vite and TypeScript stay off the VPS.

Then:

- delete `$DEST/package-lock.json` (already consumed; not needed at runtime)
- delete `*.map` files (TypeScript emits source maps in `dist/`; they are not needed in production and bloat the archive)

### 3.8 Write tarballs into `dist-release/`

```sh
OUT_DIR="$ROOT/dist-release"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/proseden.tar.gz"
NAMED="$OUT_DIR/proseden-$TAG.tar.gz"

tar -czf "$OUT" -C "$STAGE" proseden
cp "$OUT" "$NAMED"
```

`-C "$STAGE"` means tar’s paths start at that directory, so the archive contains `proseden/dist/...`, not `/tmp/tmp.xyz/proseden/...`.

Two identical files, two names:

| File | Why |
|---|---|
| `dist-release/proseden.tar.gz` | Stable name. node-vps-kit asks GitHub for the latest Release and downloads this asset. |
| `dist-release/proseden-v0.2.4.tar.gz` | Versioned name, so older Releases stay identifiable if you keep copies around. |

On Actions, `gh release create` attaches **both**. After `trap` runs, `$STAGE` is gone; `$ROOT/dist-release/` is what the next workflow step uploads.

---

## 4. What is in the tarball (and what is not)

Unpacked, a release looks like:

```
proseden/
  VERSION                 # "v0.2.4"
  package.json
  dist/                   # compiled server
  public/assets/          # Vite CSS/JS
  seed/                   # copied into data/ on first boot only
  deploy/                 # shims + post-update + migrations + nginx snippets
  node_modules/           # production deps only
```

**Never included:**

- `/data/` — live world files. Each VPS instance owns its own. Updates must not clobber them.
- `/backup/` — instance data archives.
- `src/`, `client/`, `tests/`, docs, `.github/` — source and CI. The VPS runs `node dist/server.js`.
- `devDependencies` — no TypeScript, Vite, or Vitest on the server.
- `package-lock.json` and `*.map` — stripped after the production install.

That split is the whole point of packing: the VPS gets a runnable tree; world state lives beside it (`data/`, `env`) and survives `proseden-update`.

---

## 5. How a VPS consumes the Release

Covered in detail in [DEPLOY.md](../DEPLOY.md). Short version:

1. `proseden-install` / `proseden-update` (from node-vps-kit, `--app proseden`) ask GitHub for a Release (`latest` or `--version vX.Y.Z`) and download `proseden.tar.gz`.
2. Unpack to `/opt/proseden/<name>/releases/vX.Y.Z/`.
3. Point `current` at that directory. `data/` and `env` sit next to `releases/` and are **not** inside the tarball.
4. On update: backup `data/`, run `deploy/post-update.sh` (migrations), restart systemd.

`--tarball dist-release/proseden.tar.gz` skips GitHub and installs a pack you built locally. Useful before you trust a tag.

`deploy/install.sh` and `deploy/update.sh` in the repo (and therefore in the tarball) are thin shims that exec node-vps-kit. The kit is the installer; the release only needs to be a complete app tree plus `post-update.sh`.

---

## 6. Pack locally without tagging

Same script, same output directory, no GitHub:

```bash
npm run pack
# → dist-release/proseden.tar.gz
# → dist-release/proseden-v<package.json version>.tar.gz
```

If you need the filename to match a tag you have not bumped yet:

```bash
VERSION=v0.2.4 npm run pack
```

Requires Node 20+ and a lockfile that matches `package.json` (`npm ci` will fail otherwise).

---

## 7. Shell and npm glossary

Terms the pack script uses that are easy to skim past:

| Thing | Meaning here |
|---|---|
| `npm ci` | Clean, lockfile-strict install. Fails rather than mutating `package-lock.json`. |
| `npm ci --omit=dev` | Same, but skip `devDependencies`. |
| `npm install` | **Not used** in release packaging. Would update the lockfile if ranges allow. |
| `mktemp -d` | Create a unique empty directory in `$TMPDIR` / `/tmp`. |
| `trap '…' EXIT` | Run `…` when the shell leaves this script, success or failure. |
| `set -e` | Exit immediately if a command fails. |
| `set -u` | Exit if an unset variable is expanded. |
| `ROOT` | Absolute path to the git checkout, computed in `pack-release.sh`. |
| `dist-release/` | Local output dir (`$ROOT/dist-release`). Gitignored. Mirrored in the workflow YAML by path, not by GitHub magic. |
| `github.ref_name` | For a tag push, the tag name (`v0.2.4`). Passed in as `VERSION`. |
| `v*` (workflow) | GitHub Actions tag filter. |

---

## 8. Failure modes

| Symptom | Likely cause |
|---|---|
| `release: working tree is not clean` | Uncommitted files. The bump commit must be the only change. |
| `release: tag vX.Y.Z already exists` | That version was already tagged. Bump further, or delete the local tag only if you are sure it was never pushed. |
| `release: package.json version is not X.Y.Z` | Pre-release suffixes (`0.2.4-beta`) are not supported by this bumper. |
| Workflow never starts | Tag does not match `v*` (`v0.2.4` yes, `0.2.4` no). Or the tag was created but not pushed. |
| `npm ci` fails on the runner | `package.json` and `package-lock.json` disagree. `npm run release` updates both; a hand-edited version bump that skipped the lockfile will fail here. |
| `pack-release: dist/server.js missing` | `tsc` did not emit. Check `npm run build` locally. |
| `pack-release: public/assets missing` | Vite did not emit. Same. |
| GitHub Release exists but VPS `could not read …/releases/latest` | Repo is private without `GITHUB_TOKEN` on the VPS, or no Release was published (the workflow failed after tagging). See [DEPLOY.md](../DEPLOY.md) troubleshooting. |
| Styles 404 on a fresh install | The process is running from a git clone or an incomplete pack, not a Release tarball that includes `public/assets`. |

A failed pack fails the workflow; `gh release create` does not run. The git tag still exists. Fix, delete the GitHub-side draft if any, and either re-run the workflow or move to a new patch version. Do not retag a different commit with the same `vX.Y.Z` if that tag already reached other clones.

---

## 9. Related docs

- [DEPLOY.md](../DEPLOY.md) — VPS install, nginx, HTTPS, updates, data backups.
- [MULTI_INSTANCE.md](MULTI_INSTANCE.md) — several worlds on one host; the tarball is the same, `env` differs.
- [README.md](../README.md) — local `npm run dev` / `npm start` (source tree, not a Release).
