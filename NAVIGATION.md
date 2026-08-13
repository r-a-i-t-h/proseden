# Navigation

Proseden has two ways to move between scenes: **teleport** (by scene id) and **navigate** (follow an exit). Both share the same entrance-group resolution and access checks.

See [SPEC.md](SPEC.md) for the product rules; this document describes the v1 HTTP behaviour.

## Teleport vs navigate

| Mode | Route | How destination is chosen |
|---|---|---|
| Teleport | `GET /s/:id` | Caller names a scene id directly |
| Navigate (go) | `GET /s/:id/go/:exit` | Caller follows a directed exit from the current scene |

Exits are stored per origin scene (`scenes/<id>.exits.json`) with an incremental `exitId`, a `nickname`, and `toSceneId`. `:exit` may be the numeric id or the nickname (case-insensitive).

HTML scene pages list exits under **Exits** and expose a **Travel** form that teleports to a typed scene id while sending `?from=<current>`.

Text clients get the same go URLs plus a travel hint:

```text
Travel: GET /s/<id>?from=<current>
```

## Knowing where you came from

Entrance groups need a “from” scene to decide whether the traveller is already inside the group.

| Mode | From scene |
|---|---|
| Navigate | Always the path param `:id` (the scene being left) |
| Teleport | `?from=<sceneId>` if present; otherwise the first `/s/(\d+)/` match in the `Referer` header; otherwise unknown (treated as outside) |

After a successful go, the redirect includes `?from=` so a subsequent teleport can keep intra-group context.

Artefact home links use `?from=<homeSceneId>` so returning from `/a/:id` to a scene inside an entrance group does not re-enter via the group entrance (an artefact Referer alone is not a scene and would otherwise look like an outsider).

## Entrance groups

An entrance group (`data/entrance-groups/<id>.json`) names:

- `entranceSceneId` — where outsiders must arrive
- `sceneIds` — members of the set

Each member scene stores `entranceGroupId`.

`WorldStore.resolveTeleportTarget(requestedSceneId, fromSceneId, opts?)`:

1. If the destination has no entrance group → land on the requested scene.
2. If `opts.asJoin` → land on the requested scene (live **Join** / future follow only — see below).
3. If `opts.asOwnerUsername` matches the destination owner → land on the requested scene (owners skip entrance groups for CMS / “My scenes” navigation).
4. If `fromSceneId` is in the **same** entrance group → land on the requested scene (intra-group teleport / go).
5. If the request is already for the entrance scene → land there.
6. Otherwise → redirect to `entranceSceneId`.

Both teleport and go call this helper before access checks on the **resolved** destination. Teleport passes the signed-in username as `asOwnerUsername`; go does not (exit navigation always respects entrance groups).

### Join (live)

`GET /live/join/:userKey` resolves a **currently live** user’s scene, requires `canRead` on that scene, then lands with `asJoin: true` (entrance groups are not applied). The redirect is `/s/<sceneId>?from=<sceneId>` so later intra-group teleports keep context.

Ordinary Travel / `GET /s/:id` do **not** use `asJoin`. Skipping the entrance when joining someone inside a public-readable inner room is intentional — see [LIVE.md](LIVE.md).

### Teleport HTTP flow

1. Resolve target with `from` / Referer.
2. If redirected: require `canRead` on the **entrance**; if not readable → `401`/`403` with “Entrance to this area is not reachable.”; if readable → `302` to `/s/<entrance>`.
3. If not redirected: require `canRead` on the requested scene; missing → `404`; unreadable → `401`/`403`.

### Go HTTP flow

1. Require `canRead` on the **from** scene (cannot leave an unreadable scene).
2. Resolve the exit by id or nickname; missing → `404`.
3. Resolve teleport target with `fromId` = current scene.
4. Require `canRead` on the **resolved** destination; fail → `401`/`403`.
5. `302` to `/s/<resolved>?from=<fromId>`.

So an exit that points at an inner room still delivers an outsider to the group entrance, not past it.

## Access and junctions

Movement never bypasses scene ACLs. Public scenes are readable anonymously; private scenes need authentication plus a grant (or ownership / staff rules as usual).

When **adding** exits (`POST /s/:id/exits`):

- The caller must manage the origin scene, hold the organiser role, **or** the origin must be a public junction (`isJunction: true` and `visibility: "public"`).
- The destination must be readable to the caller (any public scene qualifies; private scenes need a normal read grant).

Public junctions let other writers attach outbound edges *from* a shared hub without managing that hub’s prose or ACL. Linking *to* a public scene never required junction status.

## Worked examples

Assume entrance group “Wing”: entrance = scene `2` (private, Bob may read), inner = scene `3` (private, Bob may read), vault = scene `4` (private, Alice only). Scene `1` is a public hall outside the group.

| Action | Result for Bob | Result for Carol |
|---|---|---|
| `GET /s/3` (no from) | `302` → `/s/2` | `403` (entrance unreadable) |
| `GET /s/3?from=2` | `200` at scene 3 | `403` (cannot read inner) |
| `GET /s/1/go/<exit-to-3>` | `302` → `/s/2?from=1` | `403` (resolved entrance unreadable) |
| `GET /s/2/go/<exit-to-3>` | `302` → `/s/3?from=2` | cannot leave `2` if unread |
| `GET /s/3?from=2` as Alice | `200` | — |
| `GET /s/4?from=2` as Bob | `403` (inner vault denied) | — |

## Related routes

| Method | Path | Role |
|---|---|---|
| `GET` | `/s/:id` | Teleport / view scene |
| `GET` | `/s/:id/go/:exit` | Navigate via exit |
| `POST` | `/s/:id/exits` | Add exit |
| `POST` | `/eg` | Create entrance group |
| `POST` | `/s/:id/entrance-group` | Assign/clear entrance group on a scene |

Regression coverage lives in `tests/navigation.test.ts`.
