# Proseden

A prose-driven textual world served over HTTP. Scenes and artefacts are plain descriptions with optional closer details. Public scenes are open to anyone; private scenes and edits require authentication.

See [SPEC.md](SPEC.md) for the product vision, [NAVIGATION.md](NAVIGATION.md) for teleport vs exit navigation, and [MULTI_INSTANCE.md](MULTI_INSTANCE.md) for hosting several worlds under one domain. This README covers the v1 implementation.

## Quick start

```bash
npm install
npm run build:client   # Vite assets → public/assets (base: './')
npm run dev            # http://127.0.0.1:8787
```

Production-style:

```bash
npm run build
npm start
```

Environment:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Listen port |
| `PROSEDEN_DATA` | `./data` | Live world files (created from `seed/` on first boot); use a distinct directory per instance |
| `PROSEDEN_SEED` | `./seed` | Seed copied when `data/meta.json` is missing |
| `PROSEDEN_BASE_PATH` | _(empty)_ | URL prefix for subdirectory deploy, e.g. `proseden` or `worlds/alpha` |
| `PROSEDEN_MANAGERS` | _(empty)_ | Comma-separated usernames granted `manager` on boot |

Seed login: **gardener** / **garden**

Demo invite: **visitor** / **visit** can read the Private Study (`/s/3`) via a scene grant.

### Subdirectory / multiple copies

See [MULTI_INSTANCE.md](MULTI_INSTANCE.md) for reverse-proxy examples, cookie isolation, and a checklist. Short version:

```bash
PROSEDEN_BASE_PATH=garden PROSEDEN_DATA=./data-garden PORT=8787 npm start
PROSEDEN_BASE_PATH=attic  PROSEDEN_DATA=./data-attic  PORT=8788 npm start
```

Proxy `/garden/` and `/attic/` to those processes **without stripping the prefix**.
## Playing with curl

```bash
# Entrance — `/` redirects to `/s/1`
curl -s -L -H 'Accept: text/plain' http://127.0.0.1:8787/
# Same scene directly
curl -s -H 'Accept: text/plain' http://127.0.0.1:8787/s/1

# Examine a detail
curl -s -H 'Accept: text/plain' 'http://127.0.0.1:8787/s/1?card'

# Artefact
curl -s -H 'Accept: text/plain' http://127.0.0.1:8787/a/1

# Log in (returns bearer token)
TOKEN=$(curl -s -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"username":"gardener","password":"garden"}' \
  http://127.0.0.1:8787/auth/login | jq -r .token)

# Private scene
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept: text/plain' \
  http://127.0.0.1:8787/s/3

# Collect / inventory
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept: application/json' \
  -H 'Content-Type: application/json' -d '{"tags":["keepsake"]}' \
  -X POST http://127.0.0.1:8787/a/1/collect
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept: text/plain' \
  http://127.0.0.1:8787/inv
```

`?format=text` or `?format=html` overrides `Accept` negotiation. Browsers get HTML with linked exits/artefacts, login, and (when signed in) a management sidebar.

## URL surface (v1)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/s/:id` | Scene; `?<name>` examines a detail; entrance-group teleport may redirect |
| `GET` | `/s/:id/go/:exit` | Follow exit by id or nickname (access-checked) |
| `GET` | `/a/:id` | Artefact |
| `GET` | `/inv` | Inventory (auth) |
| `POST` | `/auth/register` `/auth/login` `/auth/logout` | Session cookie + optional JSON token |
| `POST` | `/s` | Create scene (auth) |
| `PUT`/`POST` | `/s/:id` | Update scene (owner) |
| `POST` | `/s/:id/exits` | Add directed exit (manage origin, or any user from a public junction) |
| `GET`/`PUT`/`POST` | `/s/:id/access` | Scene grants/denies (manage) |
| `GET`/`PUT`/`POST` | `/u/:username/access` | User-level share-all (self or manager) |
| `POST` | `/g` | Create group (auth) |
| `GET`/`PUT`/`POST` | `/g/:id` | Group details / update (manage) |
| `GET`/`PUT`/`POST` | `/g/:id/access` | Group grants/denies |
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

Prose files use YAML frontmatter plus `## detail:<slug>` sections.

**Collect** adds an inventory link to the artefact; it does not remove it from its home scene. Multiple readers may collect the same artefact.

Every prose edit is appended to `scenes/<id>.edits.jsonl` (or artefacts). Snapshots are retained only when the save includes `retainSnapshot` / “Keep version”, stored under `scenes/<id>.versions/<iso>.md`. Exits are not versioned.

## Deferred

None of the planned phases remain; nested groups, chat, presence, search, and multi-process writers stay out of scope.
