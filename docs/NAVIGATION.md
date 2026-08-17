# Navigation

Proseden has two ways to move between scenes: **teleport** (by scene id) and **navigate** (follow an exit). Both share the same entrance-group resolution and access checks.

See [SPEC.md](SPEC.md) for the product rules; this document describes the v1 HTTP behaviour.

## Teleport vs navigate

| Mode | Route | How destination is chosen |
|---|---|---|
| Teleport | `GET /s/:id` | Caller names a scene id directly |
| Navigate (go) | `GET /s/:id/go/:exit` | Caller follows a directed exit from the current scene |

Exits are stored per origin scene (`scenes/<id>.exits.json`) with an incremental `exitId`, a `nickname`, and `toSceneId`. `:exit` may be the numeric id or the nickname (case-insensitive).

HTML scene pages list exits under **Exits**, offer **Subscribe** / **Unsubscribe** with a subscriber count (signed-in readers), and expose an **Actions** section: teleport to a typed scene id (sending `?from=<current>`), and invite a signed-in user to view the current scene.

Text clients get the same go URLs plus action hints:

```text
Actions:
  Teleport: GET /s/<id>?from=<current>
  Invite to view: POST /s/<current>/view-invites
  Subscribe: POST /s/<current>/subscribe
```

## Knowing where you came from

Entrance groups need a “from” scene to decide whether the traveller is already inside the group.

| Mode | From scene |
|---|---|
| Navigate | Always the path param `:id` (the scene being left) |
| Teleport | `?from=<sceneId>` if present; otherwise the first `/s/(\d+)/` match in the `Referer` header; otherwise the signed-in user’s readable `lastSceneId` (so Profile / Data / `/u/...` returns stay inside an entrance group); otherwise unknown (treated as outside) |

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
2. If redirected: require `canRead` on the **entrance**; if not readable → `401`/`403` with “Entrance to this area is not reachable.”; if readable and entrance FlagRef gate fails (non-bypass) → `401`/`403` with `whenDenied` or default; if ok → `302` to `/s/<entrance>`.
3. If not redirected: require `canRead` on the requested scene; missing → `404`; unreadable → `401`/`403`; then FlagRef scene access gate (owner / edit / manage / staff bypass).

### Go HTTP flow

1. Require `canRead` on the **from** scene (cannot leave an unreadable scene).
2. Resolve the exit by id or nickname; missing → `404`.
3. Require exit FlagRef gate (`exitAllowed`); fail → `403` with `whenDenied` or default.
4. Resolve teleport target with `fromId` = current scene.
5. Require `canRead` on the **resolved** destination; fail → `401`/`403`.
6. Require destination FlagRef scene access gate (same bypass rules as teleport).
7. `302` to `/s/<resolved>?from=<fromId>`.

So an exit that points at an inner room still delivers an outsider to the group entrance, not past it. A locked exit plus a gated destination scene must both be authored explicitly (no auto-pairing).

## Access and junctions

Movement never bypasses scene ACLs. Public scenes are readable anonymously; private scenes need authentication plus a grant (or ownership / staff rules as usual).

When **adding** exits (`POST /s/:id/exits`):

- The caller must manage the origin scene, hold the topographer role, **or** the origin must be a public junction (`isJunction: true` and `visibility: "public"`).
- The destination must be readable to the caller (any public scene qualifies; private scenes need a normal read grant).

Public junctions let other writers attach outbound edges *from* a shared hub without managing that hub’s prose or ACL. Linking *to* a public scene never required junction status.

## Exit requests

When you can read a scene but cannot add exits from it, Edit → Exits offers **Request exit** instead of Add. That posts `POST /s/:id/exit-requests` with a nickname, a destination scene you own, and an optional note.

The request is delivered only to the **owner** of the origin scene (not manage grantees). Their header **Messages** link shows the total message count. The Messages page (`/inbox`) is a short queue — every message’s subject and body are listed in full, with no read/unread state. Delete clears a message; for an exit request, **Confirm** adds the exit (same rights checks as `POST /s/:id/exits`), removes the request, and places a confirmation notice in the requester’s inbox.

Exit requests and view invites remain world-building aids. Peer free-text notes are separate (`type: message`) when peer messaging is enabled.

## Peer messages

When peer messaging is enabled (default), a signed-in user can compose on the Messages page (`POST /inbox/send` with `uid` and `body`, max 2000 characters; subject is always `Personal message from <sender>`). Recipients see a `message` entry and may Reply (prefills To) or Delete. Manager notices from `/msg` use subject `Manager message from <manager>`. Quest badge grants deliver a `notice` from `Proseden` (`You've earned a badge …`, body = badge description when set). There is no content filter; rate limits curb API spam. Managers can disable peer messaging or purge all inbox rows from a username on `/msg`.

## Manager messages

Staff managers may send a free-text notice to one registered user or everyone. The Edit toolbar **Msg** link (managers only) opens `/msg`. The form posts `POST /msg` with `to` (a username or `*` / `ALL users`) and `body`. The body keeps line breaks and the same prose adornments as scene text: `_emphasis_`, `*bold*`, `~strike~`, `---` (horizontal rule), and `[label](https://…)`. Each recipient gets a `notice` in their inbox. Success and failure are reported on the Msg page (or as JSON `{ ok, to, messages }` / `{ error }`).

The Msg page also exposes:

- **Peer messaging** — `POST /msg/peer-messaging` with `enabled` true/false (persisted in `data/settings.json`)
- **Purge inbox from user** — `POST /msg/purge-from` with `uid` (username); deletes every inbox message that user sent

## View invites

From any scene you can read, **Actions** → Invite posts `POST /s/:id/view-invites` with a username. That delivers an `invite_to_view` message to their inbox (the scene need not be yours). Re-inviting the same person to the same scene refreshes the existing message instead of stacking a second copy. The recipient can follow a link to the scene and delete the message; there is no confirm step, and the invite does not grant access.

## Scene subscriptions

Signed-in readers who can reach a scene may **Subscribe** (`POST /s/:id/subscribe`) or **Unsubscribe** (`POST /s/:id/subscribe/drop`). The scene page shows the current subscriber count beside that control. Subscribers are stored in `scenes/<id>.subs.json`. When title, description, details, or artefacts at that scene change, each subscriber (except the editor) gets a `scene_update` inbox notice with merged change kinds and a link to the scene. Repeated edits coalesce into one undeleted notice per recipient. Exits and ACL changes do not notify. Recipients who no longer can read the scene are skipped and pruned from the list.

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
| `POST` | `/s/:id/exit-requests` | Request exit (owner inbox) |
| `POST` | `/s/:id/view-invites` | Invite a user to view this scene |
| `POST` | `/s/:id/subscribe` | Subscribe to scene content changes |
| `POST` | `/s/:id/subscribe/drop` | Unsubscribe |
| `GET` | `/inbox` | Messages page (auth) |
| `POST` | `/inbox/send` | Peer free-text message (auth; when enabled) |
| `POST` | `/inbox/:id/confirm` | Confirm exit request |
| `POST` | `/inbox/:id/delete` | Delete inbox message |
| `GET` | `/dashboard` | World overview counts (manager) |
| `GET` | `/msg` | Manager notices + peer-messaging controls (manager) |
| `POST` | `/msg` | Send to one user or all (manager) |
| `POST` | `/msg/peer-messaging` | Enable/disable peer messaging (manager) |
| `POST` | `/msg/purge-from` | Delete all inbox messages from a user (manager) |
| `POST` | `/eg` | Create entrance group |
| `POST` | `/s/:id/entrance-group` | Assign/clear entrance group on a scene |

Regression coverage lives in `tests/navigation.test.ts`, `tests/inbox.test.ts`, and `tests/msg.test.ts`.
