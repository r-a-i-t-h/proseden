# Proseden

A prose-driven textual world served over HTTP. Locations (nodes) and artefacts are plain descriptions with optional closer details. Public rooms are open to anyone; private rooms and edits require authentication.

See [SPEC.md](SPEC.md) for the product vision. This README covers the v1 implementation.

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
| `PROSEDEN_DATA` | `./data` | Live world files (created from `seed/` on first boot) |
| `PROSEDEN_SEED` | `./seed` | Seed copied when `data/meta.json` is missing |
| `PROSEDEN_BASE_PATH` | _(empty)_ | URL prefix for subdirectory deploy, e.g. `proseden` |

Seed login: **gardener** / **garden**

## Playing with curl

```bash
# Entrance (public)
curl -s -H 'Accept: text/plain' http://127.0.0.1:8787/n/1

# Examine a detail
curl -s -H 'Accept: text/plain' 'http://127.0.0.1:8787/n/1?card'

# Artefact
curl -s -H 'Accept: text/plain' http://127.0.0.1:8787/a/1

# Log in (returns bearer token)
TOKEN=$(curl -s -H 'Accept: application/json' -H 'Content-Type: application/json' \
  -d '{"username":"gardener","password":"garden"}' \
  http://127.0.0.1:8787/auth/login | jq -r .token)

# Private node
curl -s -H "Authorization: Bearer $TOKEN" -H 'Accept: text/plain' \
  http://127.0.0.1:8787/n/3

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
| `GET` | `/n/:id` | Node; `?<name>` examines a detail (e.g. `?card`) |
| `GET` | `/a/:id` | Artefact |
| `GET` | `/inv` | Inventory (auth) |
| `POST` | `/auth/register` `/auth/login` `/auth/logout` | Session cookie + optional JSON token |
| `POST` | `/n` | Create node (auth) |
| `PUT`/`POST` | `/n/:id` | Update node (owner) |
| `POST` | `/n/:id/exits` | Add directed exit (owner) |
| `POST` | `/a` | Create artefact (auth, edit rights on home) |
| `PUT`/`POST` | `/a/:id` | Update artefact |
| `POST` | `/a/:id/collect` | Collect (inventory link) |
| `DELETE` | `/a/:id/collect` | Drop from inventory |

## Storage

On boot the server loads `data/` into memory and write-throughs on every mutation (atomic temp + rename). Layout:

```
data/
  meta.json
  users/<username>.json
  nodes/<id>.md
  nodes/<id>.exits.json
  artefacts/<id>.md
```

Prose files use YAML frontmatter plus `## detail:<slug>` sections.

**Collect** adds an inventory link to the artefact; it does not remove it from its home node. Multiple readers may collect the same artefact.

## Deferred (schema-ready, not in v1 UI)

Invites, deny lists, user-level share-all, groups, public junctions, entrance-group teleport rules, moderator/organiser/manager roles, and historical snapshot browsing. Access helpers already consult deny/invite hooks so these can be enabled without rewiring callers.
