# Architecture after the 2026-08 refactor

Maintenance pass that finished halfway migrations, plus a short cleanup of leftovers that pass introduced. Product URLs, the HTML / text / JSON contract, and `WorldStore` as the aggregate root are unchanged.

**Verified:** `npx tsc --noEmit`, `npx vitest run` (483 tests), `npm run build`.

**Related:** [SPEC.md](SPEC.md), [RENDERING.md](RENDERING.md), [NAVIGATION.md](NAVIGATION.md), [AGENTS.md](../AGENTS.md).

---

## What stayed the same (on purpose)

- Layered monolith: `routes` → `access` / `logic` / `store` / `PageView`. No service layer, no ORM, no SPA framework, no OpenAPI.
- One handler, three formats: HTML for browsers, text for curl, JSON for the Edit panel (`page()`, `apiError()`, `wantsJson()`).
- Resource-ish paths plus action verbs (`/a/:id/use`, `/s/:id/go/:exit`, `/alchemy/combine`).
- Named `can*` product rules (junction, repository, transfer, inventory-holding). Those stay outside `hasRight`.
- Cookie auth: `SameSite=Lax` + httpOnly. No CSRF tokens.
- Username free-text fields still use `name="uid"` ([AGENTS.md](../AGENTS.md)).

---

## File map

```
src/routes/world.ts          thin mount: / and /s redirects + route()
src/routes/scenes.ts
src/routes/artefacts.ts
src/routes/groups.ts
src/routes/inbox.ts
src/routes/staff.ts
src/routes/history.ts
src/routes/profile.ts
src/routes/inventory.ts
src/routes/helpers.ts        parseDetails, updateAccess, questActionReply, …
src/routes/admin.ts
src/routes/auth.ts
src/routes/live.ts

src/http.ts                  page(), apiError(), respondMutation, requireUser, …
src/http/body.ts             readRequestBody, parseEnabledFlag, isTruthy
src/access/permissions.ts    AclSubject, hasRightOn, canDelete*
src/access/scene-entry.ts    evaluateSceneEntry, assertSceneEntry
src/store/settings.ts        updateSetting(world, key, enabled)
src/render/bootstrap.ts      EditBootstrap, ManageContext (client imports these)
src/render/html.ts           site shell only (editModeHrefs + renderHtmlPage)
src/render/view/pages/       PageView composers, including the former string pages
```

`src/store/world.ts` was **not** split. Callers still use `world.getScene` / `world.evaluateQuestsForUser`.

---

## What changed

### 1. World router split

`src/routes/world.ts` was ~2800 lines. It now mounts resource routers at the same URLs. Shared parse/persist helpers live in `src/routes/helpers.ts`.

When adding a route, put it on the resource file, not back on `world.ts`.

### 2. HTTP helpers

| Helper | Role |
|---|---|
| `readRequestBody(c)` | One body reader (JSON + form, multi-value / checkbox rules). |
| `respondMutation(c, { json, redirect, status?, flash? })` | JSON for the Edit panel; HTML forms redirect. `flash` becomes query params. |
| `aliasFormMethods(router, "put" \| "delete", path, handler, postPath?)` | PUT+POST on the same path; DELETE plus `POST path/delete` (or a custom `postPath`). |
| `requireUser` / `requireManager` | Return `UserRecord \| Response`. Check with `isResponse(value)`. |
| `page(c, status, view)` | **PageView only.** The old `page(title, html, text)` overload is gone. |

Creates that used to return **201** still do, via `respondMutation(..., { status: 201 })`. Default status is 200. Forgetting `status: 201` on a create is a silent JSON-client break. That includes manager `POST /data/quests`.

`flash` is the only way to add query params on a helper redirect — do not put `?deleted=1` in `redirect` (the helper replaces the query string and does not merge). Inbox delete, group transfer, and profile badge-drop use `flash`. Inbox send still hand-rolls JSON vs redirect because it also returns **text** 201.

Quest / Use / Input still use session one-shots (`setActionMessage`) so the result is not in the URL. Inbox/msg validation errors still re-render the form with `notice`/`error`.

### 3. Shared ACL (`AclSubject`)

Scenes and groups use one evaluator:

1. deny (owner share-all → group → subject)
2. owner
3. grants (subject → group → owner share-all), including `"*"`
4. public read (`visibility` on scenes only)
5. staff roles

`hasRight(user, scene, right, world)` is a scene convenience over `hasRightOn(user, sceneAclSubject(scene, world), right, world)`.

**Behavior change:** a group **deny now beats the group owner**, matching scenes. Previously the group owner always won before deny. A manage-deny on the owner strips manage but leaves other rights unless those are denied too.

`canDeleteScene` = manage or moderator.  
`canDeleteArtefact` = artefact owner, home-scene manager, or moderator.  
Delete routes and the Edit panel `canDelete` flag now share these functions.

Transfer remains **ownership** (owner or staff manager), not a manage grant. UI copy should say transfer ownership, not “manage transfer”.

### 4. Scene entry pipeline

`evaluateSceneEntry` (pure) and `assertSceneEntry` (HTTP) run:

1. entrance-group teleport (`redirect` / `forbid` / `ignore`)
2. `canRead`
3. `bypassesSceneFlagGate` || `sceneAllowed`

| Surface | Teleport mode |
|---|---|
| GET `/s/:id` | `redirect` to the group entrance |
| POST `/s/:id/input`, POST `/a/:id/collect` | `forbid` (403 if you would be teleported away) |
| GET `/s/:id/go/:exit` dest, Live join / SSE / here / say | `ignore` (join still calls `resolveTeleportTarget(..., { asJoin: true })`) |
| POST `/s/:id/subscribe`, POST `/s/:id/view-invites` | not used — `canRead` only (no FlagRef / teleport) |
| POST `/live/shout` | not used — existing presence only; no scene ACL/gate re-check |

**Product decision:** leave subscribe, view-invites, and shout off `assertSceneEntry`. Subscribe and view-invite are ACL actions on a scene you already reached. Shout is global fan-out from an existing presence connection. Applying entry would be a product change: today you can fail GET/input/collect on a gated scene and still subscribe, invite, or shout if you already have presence. Leave that split unless it starts to matter.

**Holding an artefact** still skips ACL and scene/artefact `when` **only on GET `/a/:id`**. Collect, history, and Live do not get that exception.

If teleport would send you to an unreadable entrance, the message is **“Entrance to this area is not reachable.”** (403 signed-in, 401 anonymous) — not the generic private-scene copy.

Live SSE / `/here` / `/say` now apply the FlagRef gate as well as ACL. Someone who can “read” a scene but fails `when` no longer gets a live stream there. Covered by `tests/live.test.ts` (SSE 403 on a public `when`-gated scene). Collect from outside an entrance group is covered by `tests/navigation.test.ts`.

### 5. PageView finished

These pages no longer build HTML/text strings in routes or `html.ts`:

- groups index + group detail
- inventory, user alchemy, user quests
- staff, dashboard, `/msg`
- edit history + snapshots
- admin data hub, quest/alchemy JSON editors
- live admin
- other-user profiles (`/u/:username`)
- generic errors and view lockdown

`src/render/html.ts` is the site shell only. Dead `render*BodyHtml` wrappers are gone.

Shared composers:

- `accessForm` — profile share-all and group access
- `jsonFileEditorPageView` — `/alchemy`, `/data/quests/:name`, `/data/quests/users/:username`, `/data/alchemy`
- `questsPageView` — `/quests` (quest JSON plus collapsible flags/badges editors)
- `messagePageView` — `apiError` HTML and short notices

Error notices use `.notice.notice-error`, not the unstyled `.error` class.

### 6. Shared client/server contracts

`EditBootstrap` and `ManageContext` live in `src/render/bootstrap.ts`. `client/edit.ts` imports those types; it no longer redeclares them.

Live chat types come from `src/live/types.ts` (`ChatMessage.kind` is the union, not `string`).

`updateSetting(world, key, enabled)` is the single boolean settings write used by `/live/admin/*` and `/msg/peer-messaging`.

`updateAccess(c, { persist, redirect, flash? })` is the shared grants/denies save for scene, group, and user share-all.

### 7. Cleanup pass

Mopped leftovers from the unexpected-fix work; no new layers.

- Deleted unused `src/render/text.ts` (wrappers around `toText` that nothing imported).
- Removed unused `canEditGroup`. Routes never called it; group rights stay `canReadGroup` / `canManageGroup` / `canTransferGroup`.
- Tests for the two untested behavior changes: Live SSE 403 on a `when`-gated readable scene; collect 403 when the artefact home is an inner entrance-group room and `from` is outside.
- `POST /data/quests` create now passes `status: 201`. Inbox/group/profile helper redirects use `flash` only.

---

## Intentional non-changes

- JSON field aliases still accepted where forms and the Edit panel disagreed (`details` / `detailsJson`, `when` / `flag`). Prefer the stored-domain name on new code.
- Auth login/register still peek `username` from the raw body for rate-limit keys (`peekAuthUsername`). That is not a free-text “other user” field; `uid` does not apply.
- `WorldStore` file split was optional and was not done.
- Live admin, `/data`, and `/msg` stay on their existing URL prefixes. Only the settings helper is shared.

---

## Gotchas for manual validation

Automated tests cover ACL, navigation, inbox, live SSE plumbing, and HTML snippets. They do not replace clicking through a running world (`npm run dev`).

### Auth and shell

- Log in / register / log out from the header. Autofill should target those `username` fields only — group invite, inbox compose, and view-invite should stay `uid` and must not steal the login name.
- After login, header shows Profile, Messages, Inventory, Live/Edit/View. Guests on a public scene can open Live if guest live is on.
- Crisis / view lockdown: with `nonManagerViewEnabled` off, a reader should see the lockdown page with a login form; a manager should still get in.

### Scene entry and travel

- Open a **public** scene, follow an exit (`/s/:id/go/:exit`), confirm `?from=` and the destination body.
- Open a **private** scene you cannot read: signed-in 403 “This scene is private…”, anonymous 401.
- **Entrance group:** from outside, `/s/<inner>` must redirect to the entrance (or 403 “Entrance to this area is not reachable” if the entrance is unreadable). From a sibling with `?from=<inside>`, the inner scene must render.
- Scene **owner** can open inner rooms without teleport.
- **Junction:** a visitor can create a scene and attach an exit from the public junction (JSON create still **201**).
- **Repository:** a non-editor can POST a new artefact onto a public repository scene.
- Phrase **Input** on a gated scene you may read: success flash via session, not a query string. Input on a teleport-only inner id should 403, not redirect.

### Artefacts

- View an artefact in-world (ACL + scene `when`). Collect, then reload `/a/:id` **while holding it** — the page must still render even if you could not read the home scene. History and collect-from-elsewhere must not get that skip.
- Collect from an artefact whose home is behind an entrance group you are not inside: 403, not a silent collect.
- Drop / Use: Use flash is session-based; inventory list and the artefact page should agree on holdings.
- Delete as owner vs home-scene manager vs moderator vs a manage-grant-only user on a different scene.

### Groups and access

- Create a group, assign a scene you manage, save grants/denies on `/g/:id`. Flash `?updated=1` → “Group access saved.”
- **Owner deny:** put a manage-deny on the group owner, reload — they should lose manage UI (access form / assign) but still read unless read is denied. This is the one ACL behavior change.
- Transfer group/scene as owner (keep-access checked and unchecked). A manage grantee must **not** see or succeed at transfer.
- User share-all on `/profile` (sharing section) vs manager editing `/u/:username/access`.

### Inventory, alchemy, quests

- `/inv` alchemy panel: combine UI lives in `<details data-persist-open="proseden-alchemy-open">` (open state via `wirePersistedDetails`). Success (`?alchemy=`) and error (`?alchemy-error=`) notices render at the top of the page, not inside the panel.
- `/alchemy`: save JSON, `?saved=1`. Invalid JSON must re-show the editor with an error, not a blank page.
- `/quests` (questor): three collapsible panels (`data-persist-open`) — Quests / Flags / Badges editors. Quest save `?saved=1`; flags `?saved=flags`; badges `?saved=badges`. Invalid JSON must re-show the editor with an error, not a blank page.
- Manager `/data/quests` and `/data/alchemy` are the same editor composer — confirm save/delete and the back crumb to `/data`. `/data/quests` also lists personal `quests/users/*` files for managers.
- `/data/pack/export` downloads a densified adventure pack; `/data/pack/import` merges one into the world (see [PACKS.md](PACKS.md)).

### Live

- Open Live on a public scene (signed-in and guest if enabled). Presence list, say, shout, ping.
- **Join** another user: HTML redirect to `/s/:id?from=:id`; JSON `{ ok, sceneId, href }`.
- Live on a `when`-gated scene you fail: SSE `/live/events` should 403, not a hanging EventSource.
- `/live/admin` toggles (guest live, chat, registration, non-manager edit/view) round-trip through `updateSetting` and flash `?guest=on` etc. Confirm the matching reader-facing behavior after each toggle.
- `/msg` peer-messaging toggle is the same helper with a different key.

### Staff, inbox, history

- `/staff` assign roles: the form still posts to `staff/:username` (path param, not `uid`). Inbox notice to the target on change.
- Inbox compose (`uid` + body), confirm an exit request, delete a message (`POST /inbox/:id/delete` and `DELETE /inbox/:id`).
- Scene/artefact history list, open a retained snapshot, restore as manager. Read-only users must not see Restore.

### Edit panel

- `?edit` on a scene you can edit: bootstrap `ManageContext` must match on-page rights (`canEdit`, `canManage`, `canDelete`, `canTransfer`, `canAddExit`, `canPlaceArtefact`).
- Save scene/artefact body (PUT and HTML POST to the same path). `retainSnapshot` checkbox.
- New scene / new artefact from the panel; JSON creates are **201**.
- After a form save, the redirect lands on the entity page without a raw JSON body in the browser.

### Markup / curl

- `/u/:username` meta line: `N scenes · M artefacts · last seen <time datetime="…" title="…">`. Badge lines include a `<time>` (or “unknown”), not a double-parenthesized plain age.
- `curl -H 'Accept: text/plain'` on a scene, group, inventory, and an error (401/403) — titles still wrap as `[Title]`.
- `Accept: application/json` on mutations returns the entity, not a redirect.

### Regression corners

- Subdirectory mount (`assetBase` not `""`): crumbs, form actions, and Edit/Live script URLs stay relative to `<base href>`.
- POST+PUT aliases: submitting an HTML form to `/s/:id`, `/a/:id`, `/profile`, `/g/:id/access` must work without `_method`.
- POST+DELETE aliases: `/s/:id/delete`, `/a/:id/delete`, `/a/:id/collect/drop`, `/inbox/:id/delete`.

---

## Adding features without undoing this

- New HTML page: a `*PageView` composer + `page(c, status, view)`. Do not add string twins in `html.ts`.
- New mutation: `readRequestBody` + `requireUser`/`requireManager` + `respondMutation`. Use `status: 201` on create. Register form aliases with `aliasFormMethods`.
- New ACL check: extend `AclSubject` only if it is owner/grants/denies/visibility. Otherwise write a named `can*`.
- New scene-touching **reader** GET/POST (open, go, input, collect, Live SSE/here/say/join): `assertSceneEntry` (or `evaluateSceneEntry` when you must keep a JSON-only error body, as Live SSE does). Subscribe and view-invites stay `canRead` only; shout stays presence-only — see the scene-entry table.
- New boolean setting: add a key to `updateSetting`, do not copy another POST handler.
- Edit panel types: change `src/render/bootstrap.ts`, not a second interface in `client/edit.ts`.
