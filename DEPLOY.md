# Deploying Proseden on a Linux VPS

This guide is for someone who can SSH into a server but has not shipped a Node app before. It walks through putting **one or more** Proseden worlds behind nginx.

You do **not** clone this git repo onto the VPS. A small installer downloads a ready-made release (compiled server, CSS/JS, seed world, and libraries) and wires up the process manager and reverse proxy.

## What you will end up with

Example: two worlds on two hostnames.

| Public URL | Local process | Files on disk |
|---|---|---|
| `http://www.proseden.co.uk/` | Node on port 3336 | `/opt/proseden/www/` |
| `http://test.proseden.co.uk/` | Node on port 3337 | `/opt/proseden/test/` |

Each instance has **its own copy of the app** and **its own world data**. Updating `test` does not change `www`. That is deliberate: try a new version on `test`, then promote `www` when you are happy.

nginx sits on ports 80/443 and forwards each hostname to the matching Node process. Browsers never talk to port 3336 directly.

```
Internet → nginx :80/:443 → 127.0.0.1:3336  (www)
                         → 127.0.0.1:3337  (test)
```

## What you need

- A Linux VPS you can SSH into as a user with `sudo` (Ubuntu 22.04/24.04 is the well-trodden path).
- A domain with DNS you can edit (for the examples: `proseden.co.uk`).
- The GitHub repo **public**, and at least one **Release** published (see [Publishing a release](#publishing-a-release-project-maintainer) if you are the maintainer).
- About 15 minutes for the first instance.

You will install three things on the server: **Node.js 20+** (system-wide), **nginx**, and **certbot** (optional, for HTTPS).

## 1. Point DNS at the VPS

In your DNS panel, create **A** records (and **AAAA** if the VPS has IPv6):

| Name | Type | Value |
|---|---|---|
| `www` | A | your VPS IPv4 |
| `test` | A | the same IPv4 |

Wait until `ping www.proseden.co.uk` from your laptop reaches the VPS. TLS (step 7) will fail if DNS is still pointing elsewhere.

## 2. SSH in and become root when needed

```bash
ssh youruser@YOUR.VPS.IP
```

Commands below that touch `/opt`, systemd, or nginx need root. Prefix them with `sudo`, or `sudo -i` for a root shell.

## 3. Install Node.js, nginx, and curl

**Use a system-wide Node, not nvm.** systemd starts Proseden as a service user (`proseden`) that cannot see your personal `~/.nvm` install.

On Ubuntu / Debian:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg nginx

# Node 22 from NodeSource (includes a /usr/bin/node that systemd can run)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

node -v    # must print v20.x or newer
nginx -v
```

Allow HTTP/HTTPS through the firewall if `ufw` is active:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

Do **not** expose 3336/3337 to the internet; only nginx should reach them.

## 4. Run the installer (first instance)

The installer is a shell script in this repo. Once the repo is public you can pipe it straight from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/r-a-i-t-h/proseden/main/deploy/install.sh \
  | sudo bash -s -- \
      --name www \
      --server-name www.proseden.co.uk \
      --port 3336
```

That single command:

1. Checks you are root and that `node` (>= 20), `nginx`, and `systemctl` exist.
2. Asks GitHub for the **latest Release** and downloads `proseden.tar.gz`.
3. Unpacks it to `/opt/proseden/www/releases/vX.Y.Z` and points `current` at it.
4. Creates `/opt/proseden/www/data` (empty — the app copies the seed world on first boot).
5. Writes `/opt/proseden/www/env` (port, paths, `NODE_ENV=production`).
6. Creates a system user `proseden` if needed.
7. Installs and starts `proseden-www.service`.
8. Writes an nginx **server** block for `www.proseden.co.uk` and reloads nginx.
9. Copies `proseden-install` and `proseden-update` into `/usr/local/sbin/` so you do not need curl next time.

Watch the output. A healthy finish looks like `health check ok` and `Instance 'www' is installed.`

Open `http://www.proseden.co.uk/` in a browser (or `http://YOUR.VPS.IP/` if you have not set DNS yet — only if this is the default nginx site). You should see the entrance scene.

Default seed login: **gardener** / **garden**. Change it from **Profile** after you log in.

## 5. Install a second instance (test)

Same VPS, different hostname, **different port**, **different `--name`**:

```bash
sudo /usr/local/sbin/proseden-install \
  --name test \
  --server-name test.proseden.co.uk \
  --port 3337
```

You now have two independent worlds:

```
/opt/proseden/www/     app + data for production
/opt/proseden/test/    app + data for experiments
```

They do not share files. You can upgrade `test` and leave `www` alone.

## 6. What the installer put on disk

```
/opt/proseden/www/
  current -> releases/v0.1.0     # symlink to the running app
  releases/v0.1.0/               # unpacked tarball (dist, public, seed, node_modules)
  data/                          # live world — updates never replace this
  backup/                        # timestamped data/ tarballs (not the app)
  env                            # PORT, PROSEDEN_* — edits survive updates

/etc/systemd/system/proseden-www.service
/etc/nginx/sites-available/proseden-www   # or conf.d/proseden-www.conf
```

Useful commands:

```bash
sudo systemctl status proseden-www
sudo journalctl -u proseden-www -f          # live logs
sudo nginx -t && sudo systemctl reload nginx
```

Edit `/opt/proseden/www/env` to set `PROSEDEN_MANAGERS=yourname`, then `sudo systemctl restart proseden-www`.

## 7. HTTPS with Let’s Encrypt

After DNS for the hostname reaches this VPS:

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d www.proseden.co.uk
sudo certbot --nginx -d test.proseden.co.uk
```

certbot edits the nginx site files the installer created and renews certificates automatically. Session cookies are already marked `Secure` (`PROSEDEN_SECURE_COOKIES=1` in `env`).

## 8. Updating one instance (not the others)

When a new GitHub Release exists:

```bash
# try it on test first
sudo proseden-update --name test

# browse test.proseden.co.uk — if it looks good, promote www
sudo proseden-update --name www --version v0.2.0
```

`--version` pins the same tag you just verified. `latest` is the default.

The updater:

- **First** archives this instance’s `data/` to `backup/YYYY-MM-DDTHHMMSSZ.tar.gz` (aborts if that fails)
- Downloads that release into `releases/<tag>/` for **that instance only**
- Flips `current`
- Runs `deploy/post-update.sh`, which applies `deploy/migrations/NNN-*.sh` where `NNN` is greater than `schemaVersion` in `data/meta.json` (missing or non-numeric = **0**). `001` stamps `schemaVersion: 1`. `002` rewrites `pedia:`/`srch:`/`media:` link prefixes in scene and artefact prose (including history snapshots) and stamps `2`. `003` creates `quests/` and `alchemy/` if needed, copies default seed quests `builders` and `proseden` (and empty alchemy recipes) when those files are absent, and stamps `3`. Existing quest/recipe files are left alone. A failed hook aborts before restart.
- Restarts `proseden-<name>`
- Does **not** delete or re-seed `data/`, and does **not** rewrite `env`
- Keeps one previous release folder so you can roll back by pointing `current` back and restarting

Migrations are forward-only. Absence of `schemaVersion` in `meta.json` is treated as schema **0**. The app never writes that field; it only preserves it when saving `meta.json`. Rolling `current` back does not undo a data migration.

To apply pending migrations against a local `data/` tree without a full update:

```bash
PROSEDEN_DATA=./data sh deploy/migrate.sh
```

### Data backups

Archives are **data only** (never the app). They accumulate under `backup/`; nothing deletes them automatically.

**From Data** (signed in as a manager): open `/data`, **Backup now**, then Download or Delete.

**From SSH** (same files the Data page lists):

```bash
sudo /opt/proseden/www/current/deploy/backup-data.sh
# or, if that script is not on the running release yet:
sudo mkdir -p /opt/proseden/www/backup
sudo tar -czf /opt/proseden/www/backup/$(date -u +%Y-%m-%dT%H%M%SZ).tar.gz \
  -C /opt/proseden/www/data .
sudo chown -R proseden:proseden /opt/proseden/www/backup
```

Set `PROSEDEN_DATA` (and optionally `PROSEDEN_BACKUP`) when calling `backup-data.sh` if this instance’s `env` uses non-default paths. The helper defaults `PROSEDEN_BACKUP` to the `backup` sibling of the data directory.

**Restore** is not in the web UI. Stop the service, replace `data/` from an archive, start again:

```bash
sudo systemctl stop proseden-www
sudo rm -rf /opt/proseden/www/data
sudo mkdir /opt/proseden/www/data
sudo tar -xzf /opt/proseden/www/backup/2026-08-11T201530Z.tar.gz \
  -C /opt/proseden/www/data
sudo chown -R proseden:proseden /opt/proseden/www/data
sudo systemctl start proseden-www
```

Rolling the app `current` symlink back does not undo a data migration. Restore a pre-update archive if the files in `data/` no longer match the older app.

## 9. Path mounts (optional): `proseden.co.uk/raith`

Subdomains use a full nginx `server { }` (what `--server-name` installs). Personalised worlds on **one** hostname use a `location /name/` snippet **inside** that host’s existing server file. nginx has `include`, not `import`; a `location` is only valid inside `server { }`.

```bash
sudo proseden-install \
  --name raith \
  --base-path raith \
  --port 3338 \
  --nginx-site /etc/nginx/sites-enabled/your-apex-site
```

That writes `/etc/nginx/snippets/proseden-raith.conf` and inserts

```nginx
include /etc/nginx/snippets/proseden-raith.conf;
```

into the file you named, if that file contains exactly one `server` block. If it contains several, the installer prints the line and you paste it yourself into the right block.

The app must see the prefix (`PROSEDEN_BASE_PATH=raith`). Do not strip `/raith` in nginx. See [MULTI_INSTANCE.md](MULTI_INSTANCE.md).

Do not mix a root-mounted world (cookie path `/`) with `/raith` on the same hostname — the root cookie would be visible under every path.

## Installer flags

| Flag | Meaning |
|---|---|
| `--name` | Directory and systemd unit suffix. Required. |
| `--port` | Loopback port. Required. Unique per instance. |
| `--server-name` | New site: this hostname, app at `/`. |
| `--nginx-site` + `--base-path` | Path mount on an existing site. |
| `--prefix` | Parent dir (default `/opt/proseden`). |
| `--version` | Release tag, or `latest`. |
| `--repo` | `owner/name` if you forked. |
| `--tarball` | Local `.tar.gz` (no GitHub). Useful for testing a pack. |
| `--skip-nginx` | App + systemd only. |
| `--user` | Unix user to run Node (default `proseden`). |

Private repo: export `GITHUB_TOKEN` with `repo` read access before running install/update.

## Publishing a release (project maintainer)

The VPS downloads a **built** archive, not the git tree. `dist/` is not in git.

1. Make the GitHub repository public (or use a token on the VPS).
2. From a clean checkout: bump `version` in `package.json` if needed, commit.
3. Tag and push:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. GitHub Actions (`.github/workflows/release.yml`) runs `npm run pack` and attaches `proseden.tar.gz` to the Release.

To pack locally without tagging:

```bash
npm run pack
# → dist-release/proseden.tar.gz
```

You can install that file with `--tarball dist-release/proseden.tar.gz`.

## Troubleshooting

**`could not read …/releases/latest`**  
No Release exists yet, the repo is private without `GITHUB_TOKEN`, or `--repo` is wrong. Open `https://github.com/r-a-i-t-h/proseden/releases` in a browser.

**`Node.js >= 20 required`**  
`apt install nodejs` on older Ubuntu is too old. Use NodeSource as in step 3. If `node -v` is fine as your user but the installer fails, you are on nvm — install a system Node.

**`service proseden-www failed to start`**  
`sudo journalctl -u proseden-www -n 50`. Common causes: port already in use (`ss -lntp | grep 3336`), `env` syntax error, disk full.

**nginx `unknown directive` / `location` not allowed here**  
A `location` snippet was included at the `http` level. It must sit inside `server { }`. Use `--server-name` for subdomains; for path mounts, put the `include` inside the site’s `server` block.

**Site shows the default nginx page**  
The Proseden site is not enabled, or another `default_server` wins. Check `ls /etc/nginx/sites-enabled` and `sudo nginx -T | grep server_name`.

**Styles missing / 404 on `/assets/`**  
The process is running from a tree that was not packed with `public/assets`. Re-install from an official Release tarball, not a git clone.

**Live chat stuck on “Connecting…”**  
The UI waits for the first SSE event. If nginx buffers `/live/events`, the browser never receives it (the Node process is fine — `/live/here` still works). `proseden-update` does **not** rewrite nginx site files (certbot owns them).

On a root-mounted instance (e.g. www on port 3336), add a dedicated location **above** `location /` in the site file (often `/etc/nginx/sites-available/proseden-www`), then reload:

```nginx
location /live/events {
    proxy_pass http://127.0.0.1:3336;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    gzip off;
    proxy_read_timeout 24h;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Use the matching loopback port from that instance’s `env`. Path mounts need `/<base>/live/events` instead (see `deploy/nginx/location.conf`). App releases also send `X-Accel-Buffering: no` so buffering is disabled even without this block. See [LIVE.md](LIVE.md).

**Update left the world empty**  
Updates never copy `seed/` over existing `data/`. If `data/meta.json` was deleted, the next start *will* re-seed. Restore `data/` from backup if you still have one.

## Rolling back one instance

```bash
ls /opt/proseden/www/releases
sudo ln -sfn /opt/proseden/www/releases/v0.1.0 /opt/proseden/www/current
sudo systemctl restart proseden-www
```

Only do this if that older app still understands the files in `data/` (a forward migration is not automatically reversed).
