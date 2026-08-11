# Hosting multiple Proseden instances on one domain

For a full VPS walkthrough (installer, systemd, nginx `include`, updates) see [DEPLOY.md](DEPLOY.md). This page is the application-level contract: unique data dirs, unique ports, keep the URL prefix.

Proseden can run several independent worlds under one hostname, each on its own URL prefix and data directory. Typical layout:

| Public URL | Process | Data |
|---|---|---|
| `https://example.com/garden/` | port 3336 | `./data-garden` |
| `https://example.com/attic/` | port 3337 | `./data-attic` |

Each process is a full Proseden server. They do not share memory, users, scenes, or session state.

## What must differ per instance

| Concern | How |
|---|---|
| URL mount | `PROSEDEN_BASE_PATH` — e.g. `garden`, `attic`, or nested `worlds/alpha` |
| World files | `PROSEDEN_DATA` — separate directory per instance |
| Backups | `PROSEDEN_BACKUP` if data dirs are siblings (default is `../backup` next to the data dir, which would collide for `./data-garden` and `./data-attic`) |
| Listen port | `PORT` — unique per process on the same machine |
| Optional seed | `PROSEDEN_SEED` — only if an instance should boot from a non-default seed |

Do **not** point two instances at the same `PROSEDEN_DATA` directory. Concurrent writers are out of scope; shared data will corrupt.

## Application behaviour under a base path

With `PROSEDEN_BASE_PATH=garden`:

- Routes live under `/garden/…` (`/garden/s/1`, `/garden/auth/login`, `/garden/assets/styles.css`).
- HTML sets `<base href="/garden/">` so relative links, forms, CSS, and scripts stay inside that mount.
- Redirects include the prefix (`Location: /garden/s/1`).
- Session cookies use a mount-scoped **name** (`proseden_garden_session`) and **path** (`/garden`), so logging into one world does not authenticate you in another on the same domain.
- `/garden` and `/garden/` both reach the entrance redirect.

Client assets are built once with Vite `base: './'` into `public/assets`; every instance can share the same built `public/` tree. Only data directories need to be separate.

## Reverse proxy (keep the prefix)

The app expects to see the base path on incoming requests. **Do not strip** `/garden` before proxying.

### Caddy

```caddy
example.com {
  handle_path /garden/* {
    # WRONG for Proseden — handle_path strips the prefix
  }

  handle /garden* {
    reverse_proxy 127.0.0.1:3336
  }

  handle /attic* {
    reverse_proxy 127.0.0.1:3337
  }
}
```

### nginx

```nginx
location /garden/ {
  proxy_pass http://127.0.0.1:3336;   # no trailing URI on proxy_pass → prefix kept
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /attic/ {
  proxy_pass http://127.0.0.1:3337;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Avoid `proxy_pass http://127.0.0.1:3336/;` (with a path) if that would strip `/garden`.

## Local smoke test

```bash
npm run build

PROSEDEN_BASE_PATH=garden PROSEDEN_DATA=./data-garden PORT=3336 npm start &
PROSEDEN_BASE_PATH=attic  PROSEDEN_DATA=./data-attic  PORT=3337 npm start &

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3336/garden/s/1
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3336/garden/assets/styles.css
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3337/attic/health
```

Point a browser at each mount (or at the proxy URLs) and confirm styles load and login cookies stay separate.

## Nested prefixes

`PROSEDEN_BASE_PATH=worlds/alpha` mounts the app at `/worlds/alpha/`. Proxy the full prefix to that process the same way. Cookie name becomes something like `proseden_worlds_alpha_session` with path `/worlds/alpha`.

## Checklist

1. Unique `PROSEDEN_BASE_PATH` and `PROSEDEN_DATA` per instance (and `PROSEDEN_BACKUP` if data dirs share a parent).
2. Unique `PORT` (or equivalent isolation) per process.
3. Reverse proxy forwards the path **with** the prefix intact.
4. Build client assets once (`npm run build` / `npm run build:client`) before starting.
5. Prefer not mixing a root-mounted instance (`PROSEDEN_BASE_PATH` empty, cookie path `/`) with subdirectory mounts on the same domain — a root cookie is visible under every path.
