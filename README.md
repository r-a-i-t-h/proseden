# Proseden

A prose-driven textual world served over HTTP. Scenes and artefacts are plain descriptions with optional closer details. Public scenes are open to anyone; private scenes and edits require authentication.

See [SPEC.md](SPEC.md) for the product vision, [NAVIGATION.md](NAVIGATION.md) for teleport vs exit navigation, and [MULTI_INSTANCE.md](MULTI_INSTANCE.md) for hosting several worlds under one domain. To put Proseden on a VPS behind nginx, follow **[DEPLOY.md](DEPLOY.md)** (installer, updates, DNS, HTTPS). This README covers the v1 implementation.

## Quick start

```bash
npm install
npm run dev            # vite build + http://127.0.0.1:3336
```

`npm run build:client` alone rebuilds Vite assets into `public/assets` (base: `./`) when you change CSS/JS without restarting the server.

Production-style:

```bash
npm run build
npm start
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3336` | Listen port (`EDEN` on a phone keypad) |
| `PROSEDEN_DATA` | `./data` | Live world files (created from `seed/` on first boot); use a distinct directory per instance |
| `PROSEDEN_SEED` | `./seed` | Seed copied when `data/meta.json` is missing |
| `PROSEDEN_BASE_PATH` | _(empty)_ | URL prefix for subdirectory deploy, e.g. `proseden` or `worlds/alpha` |
| `PROSEDEN_MANAGERS` | _(empty)_ | Comma-separated usernames granted `manager` on boot (may pre-provision names not yet registered) |
| `PROSEDEN_SECURE_COOKIES` | _(empty)_ | Set `1` to mark session cookies `Secure` (also on when `NODE_ENV=production`) |

Seed login: **gardener** / **garden**. Change it from **Profile** after you log in.

Demo invite: **visitor** / **visit** can read the Private Study (`/s/3`) via a scene grant.

## Deploy on a VPS

Novice-friendly walkthrough (DNS, Node, nginx, two subdomains, HTTPS, updates): **[DEPLOY.md](DEPLOY.md)**.

```bash
curl -fsSL https://raw.githubusercontent.com/r-a-i-t-h/proseden/main/deploy/install.sh \
  | sudo bash -s -- --name www --server-name www.proseden.co.uk --port 3336
```

Each instance keeps its own app copy and `data/` directory. `sudo proseden-update --name test` upgrades only that world. Releases are GitHub Release tarballs (`npm run pack` / tag `v*`), not a live git checkout.

### Subdirectory / multiple copies

See [MULTI_INSTANCE.md](MULTI_INSTANCE.md) for reverse-proxy examples, cookie isolation, and a checklist. Short version:

```bash
PROSEDEN_BASE_PATH=garden PROSEDEN_DATA=./data-garden PORT=3336 npm start
PROSEDEN_BASE_PATH=attic  PROSEDEN_DATA=./data-attic  PORT=3337 npm start
```

Proxy `/garden/` and `/attic/` to those processes **without stripping the prefix**.

## Playing with curl

```bash
# Entrance — `/` redirects to `/s/1`
curl -s -L -H 'Accept: text/plain' http://127.0.0.1:3336/
# Same scene directly
curl -s -H 'Accept: text/plain' http://127.0.0.1:3336/s/1

# Examine a detail
curl -s -H 'Accept: text/plain' 'http://127.0.0.1:3336/s/1?card'

# Artefact
curl -s -H 'Accept: text/plain' http://127.0.0.1:3336/a/1

# Log in (returns bearer token)
TOKEN=$(curl -s -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"username":"gardener","password":"garden"}' \
  http://127.0.0.1:3336/auth/login | jq -r .token)

# Private scene
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept: text/plain' \
  http://127.0.0.1:3336/s/3

# Collect / inventory
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' \
  -X POST http://127.0.0.1:3336/a/1/collect
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept: text/plain' \
  http://127.0.0.1:3336/inv
```

`?format=text` or `?format=html` overrides `Accept` negotiation. Browsers get read-only HTML with linked exits/artefacts and login (ACL still applies). Signed-in readers can open **Edit** (`?edit`) to mount a fetch-based editor chrome around the same page — including **New scene**, and from a public junction an optional exit back to the new page. Without JavaScript the HTML stays the hyperlinked text. Entrance groups do not redirect owners on teleport.

## URL surface (v1)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/s/:id` | Scene; `?<name>` examines a detail; entrance-group teleport may redirect |
| `GET` | `/s/:id/go/:exit` | Follow exit by id or nickname (access-checked) |
| `GET` | `/a/:id` | Artefact |
| `GET` | `/inv` | Inventory (auth) |
| `GET` | `/profile` | Profile, password, and share-all (auth) |
| `POST` | `/auth/register` `/auth/login` `/auth/logout` | Session cookie + optional JSON token |
| `POST` | `/auth/password` | Change password (auth); other sessions for that user are dropped |
| `POST` | `/s` | Create scene (auth) |
| `PUT`/`POST` | `/s/:id` | Update scene (owner) |
| `POST` | `/s/:id/exits` | Add directed exit (manage origin, or any user from a public junction) |
| `DELETE`/`POST` | `/s/:id/exits/:exit/delete` | Remove one exit (manage/organise any; on a public junction, also exits to scenes you own) |
| `POST` | `/s/:id/exits/delete` | Remove one or more exits (`exitId` / `exitIds`) |
| `GET`/`PUT`/`POST` | `/s/:id/access` | Scene grants/denies (manage) |
| `POST` | `/s/:id/transfer` | Transfer ungrouped scene (+ owner's homed artefacts); owner or staff manager |
| `GET`/`PUT`/`POST` | `/u/:username/access` | User-level share-all (self or manager) |
| `GET` | `/g` | Groups you can manage or see (auth) |
| `POST` | `/g` | Create group (auth) |
| `GET`/`PUT`/`POST` | `/g/:id` | Group page; manage ACL if you have manage |
| `GET`/`PUT`/`POST` | `/g/:id/access` | Group grants/denies |
| `POST` | `/g/:id/transfer` | Transfer group (+ member scenes and matching artefacts); owner or staff manager |
| `POST` | `/g/:id/scenes` | Add scene to group |
| `POST` | `/s/:id/group` | Assign/clear scene group |
| `POST` | `/eg` | Create entrance group (entrance = scene id) |
| `POST` | `/s/:id/entrance-group` | Assign/clear entrance group on scene |
| `DELETE`/`POST` | `/s/:id/delete` | Delete scene (manage or moderator) |
| `DELETE`/`POST` | `/a/:id/delete` | Delete artefact (owner/manage/moderator) |
| `GET` | `/staff` | List staff roles (manager) |
| `PUT`/`POST` | `/staff/:username` | Set roles (manager) |
| `GET` | `/admin` | Admin endpoint index (manager) |
| `POST` | `/admin/reload` | Reload in-memory world cache from disk (manager) |
| `GET` | `/s/:id/history` | Edit log (readers) |
| `GET` | `/s/:id/history/:version` | View retained snapshot |
| `POST` | `/s/:id/history/:version/restore` | Restore snapshot (manage) |
| `GET` | `/a/:id/history` … | Same for artefacts |
| `POST` | `/a` | Create artefact (auth, edit rights on home) |
| `PUT`/`POST` | `/a/:id` | Update artefact |
| `POST` | `/a/:id/collect` | Collect (inventory link) |
| `DELETE` | `/a/:id/collect` | Drop from inventory |

## Storage

On boot the server loads `data/` into memory and write-throughs on every mutation (atomic temp + rename). Layout:

```
data/
  meta.json
  staff.json
  users/<username>.json
  groups/<id>.json
  entrance-groups/<id>.json
  scenes/<id>.md
  scenes/<id>.exits.json
  artefacts/<id>.md
```

Prose files use YAML frontmatter plus `## detail:<slug>` sections. Hash-leading lines in body/detail text are saved escaped (`\#`, `\##`) so they cannot be mistaken for section markers.

**Collect** adds an inventory link to the artefact; it does not remove it from its home scene. Multiple readers may collect the same artefact.

Every prose edit is appended to `scenes/<id>.edits.jsonl` (or artefacts). Snapshots are retained only when the save includes `retainSnapshot` / “Keep version”, stored under `scenes/<id>.versions/<iso>.md`. Exits are not versioned.

## Deferred

None of the planned phases remain; nested groups, chat, presence, search, and multi-process writers stay out of scope.
