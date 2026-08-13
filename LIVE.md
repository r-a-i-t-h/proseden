# Live presence and chat

Proseden keeps curl-friendly full-page navigation. Live multi-user features are a **progressive enhancement** on scene pages: the shared side panel (`#edit-root`) switches between **Live** and **Edit** without a page load. **View** is antisocial (disconnects presence).

Detail views (`/s/:id?card`) and artefact pages (`/a/:id`) keep you present in the **main scene** (the scene itself, or an artefact’s `homeSceneId`). Full-page navigations briefly drop the SSE socket; presence uses a short reconnect grace so same-scene loads do not emit leave/arrive.

## Modes

| Mode | UI | Presence |
|---|---|---|
| Live | Chat, who’s here, online + Join | Connected |
| Edit | Existing editor (form state kept when switching to Live) | Connected (same as Live) |
| View | Sidebar closed | Disconnected — not visible, not joinable |

Preference: `localStorage` key `proseden-panel` = `live` \| `edit` (absent = View). Legacy `sessionStorage` `proseden-edit` migrates to Edit once. `?edit` still opens Edit.

## Transport

- **SSE** `GET /live/events?scene=<id>` — snapshot then stream (`presence.*`, `chat.*`).
- Responses set `X-Accel-Buffering: no` so nginx does not buffer the stream (UI otherwise sticks on “Connecting…”). Deploy templates also use a dedicated `location` with `proxy_buffering off` — see [DEPLOY.md](DEPLOY.md) if an older site file is missing it.
- **POST** `/live/say`, `/live/shout` — require an active presence connection.
- Guests get a short-lived guest cookie on public scenes; join requires sign-in.

## Chat linger

In-memory only (lost on process restart):

- Per scene: FIFO max **100**, plus 30-minute age prune.
- Global shouts: FIFO max **50**.
- New arrivals / reconnects receive the buffer in the SSE snapshot.

No disk chat files. Moderators may `POST /live/purge` (current scene) or `POST /live/admin/purge` (all).

## Location

Logged-in users get `lastSceneId` / `lastSeenAt` on `data/users/<name>.json` (debounced writes). Login/register redirects to that scene when still readable.

## Join

`GET /live/join/:userKey` teleports to a live user’s scene when you can **read** it. Entrance groups are skipped for this route only (`asJoin`) — stronger than ordinary Travel from outside. See [NAVIGATION.md](NAVIGATION.md).

## Staff

Moderators/managers: `/live/admin` (recent users, buffer counts/ages, purge all).

## API sketch

| Method | Path | Notes |
|---|---|---|
| GET | `/live/events?scene=` | SSE |
| GET | `/live/here?scene=` | JSON who’s here |
| GET | `/live/online` | JSON online directory (auth) |
| GET | `/live/join/:userKey` | Redirect or JSON |
| POST | `/live/say` | `{ text }` |
| POST | `/live/shout` | `{ text }` |
| POST | `/live/purge` | `{ sceneId }` moderator |
| GET | `/live/admin` | HTML/JSON |
| POST | `/live/admin/purge` | Clear all buffers |
