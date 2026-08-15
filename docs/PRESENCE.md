# Presence, arrives, and leaves

Behavioral contract for live presence. Transport and API sketch live in [LIVE.md](LIVE.md).

## Definitions

There is **no `isActive` flag**.

| Term | Meaning |
|------|---------|
| **Live / here / online** | Listed by `PresenceStore.here(scene)` / `online()` because the person has at least one open SSE connection **or** a **pending leave** still inside reconnect grace |
| **Arrives / leaves** | Chat system lines (`"Name arrives."` / `"Name leaves."`) produced by `SceneHub` when it hears `presence.join` / `leave` / `move` |
| **Profile last seen** | Persisted `UserRecord.lastSeenAt` (debounced scene visits via `LocationTracker`) — **not** live presence |

Identity keys: `u:<username>` or `g:<hex guest id>`. Multiple tabs for the same key coalesce to one who’s-here / online row.

## State machine

Per `userKey`:

```text
Absent
  └─ connect (no prior, no pending) ──► Present          (emit join → "arrives.")
Present
  ├─ same-scene reconnect ───────────► Present          (silent)
  ├─ other-scene reconnect ──────────► Present @ new     (emit move → leave + arrive lines)
  ├─ last connection disconnect ─────► PendingLeave     (grace timer; still here/online)
  └─ kick ───────────────────────────► Absent           (emit leave now)
PendingLeave
  ├─ reconnect ──────────────────────► Present          (cancel timer; silent or move)
  ├─ grace expires ──────────────────► Absent           (emit leave → "leaves.")
  └─ kick ───────────────────────────► Absent           (emit leave now)
```

Implementation: [`src/live/presence.ts`](../src/live/presence.ts) (connections, grace, idle, kick) and [`src/live/hub.ts`](../src/live/hub.ts) (arrive/leave chat + linger cancel).

## Timing constants

From [`src/live/types.ts`](../src/live/types.ts):

| Constant | Value | Role |
|----------|-------|------|
| `PRESENCE_RECONNECT_GRACE_MS` | 60s | After last connection drops, delay `presence.leave`; cancel if reconnect. Pending people still count as here/online. |
| `PRESENCE_IDLE_MS` | 3 min | No **client** `/live/ping` (or say/shout) → idle sweep disconnects the connection. |
| Idle sweep interval | 30s | How often `sweepIdle` runs |
| `HEARTBEAT_INTERVAL_MS` | 20s | Client ping cadence |
| Location debounce | 30s | Disk write of `lastSceneId` / `lastSeenAt` |

Server SSE comment pings keep the proxy socket alive; they must **not** refresh presence `lastSeenAt`.

## Desired aims

| Aim | Constraint |
|-----|------------|
| Curl-friendly full-page nav | Scene / detail / artefact loads **tear down SSE** |
| No leave/arrive flicker on ordinary browsing | Delay leave across brief socket drops |
| Multi-tab = one person | Coalesce by `userKey`; leave only when last connection is gone |
| No immortal zombies | Hung SSE must not keep you “here” forever → client ping + idle sweep |
| Auth handoff / moderation | Guest→login and mod kick drop presence **immediately** |
| Useful linger for late joiners | Buffer should not keep no-op arrive→leave bounce pairs |
| View = antisocial | Closing Live/Edit disconnects presence on purpose |
| Background tabs stay present | Do not tear SSE on `visibilitychange` |

## Use-cases and outcomes

### Navigation and sockets

| Use-case | Outcome |
|----------|---------|
| Open Live on a scene (first connection) | `presence.join` → `"X arrives."`; appears in who’s-here / online |
| Full-page nav to detail/artefact (same live scene) | SSE drops → pending leave; still listed as here; reconnect within 60s → **silent** |
| Nav to a different scene within grace | Cancel pending leave; `presence.move` → leave line in old scene + arrive in new |
| Stay disconnected past 60s | `presence.leave` → `"X leaves."`; removed from here/online |
| Multi-tab: close one tab | No leave while another tab still connected |
| Multi-tab: close last tab | Grace starts; leave after 60s unless a tab reconnects |
| Switch panel to View | Disconnect → grace path (leave after 60s if they stay in View) |
| Background the tab | SSE + client pings continue; stays present |

Detail views (`/s/:id?card`) and artefact pages (`/a/:id`) keep you present in the **main scene** (the scene itself, or an artefact’s `homeSceneId`).

### Idle and proof-of-life

| Use-case | Outcome today |
|----------|----------------|
| Client stops pinging for 3m (dead tab / hung JS) | Idle sweep **disconnects** → then **another 60s grace** while still listed as here → then leave |
| Client keeps pinging | Stays present indefinitely |
| Server SSE comment pings only | Do **not** refresh presence `lastSeenAt` |

### Auth and moderation

| Use-case | Outcome |
|----------|---------|
| Login / register / logout while guest was live | Kick `g:` presence **immediately** (no grace) |
| Failed login | Guest presence untouched |
| Moderator kick | Immediate leave; no second leave after grace |

### Chat linger vs live footsteps

| Use-case | Live clients in scene | SSE snapshot / late joiner |
|----------|----------------------|----------------------------|
| Arrive then leave with **no** chat between | See arrive, then leave | **Neither** kept (linger cancel pops arrive; leave not buffered) |
| Arrive, chat, then leave | See all three | All three linger |
| Brief nav bounce suppressed by grace | Usually **no** leave/arrive at all | Nothing to cancel |

### Profile and admin

| Use-case | Outcome |
|----------|---------|
| Profile “last seen … ago” | Disk `lastSeenAt` from visits — independent of SSE |
| Admin `[live]` | Based on `presence.online()` (includes grace pending) |

## Why it feels complicated

Layered fixes (reconnect grace → linger cancel → client idle + auth kick → longer grace and no hide-teardown), not one original state machine:

1. **Reconnect grace** (`pendingLeaves`) — stop nav flicker  
2. **Linger arrive→leave cancel** — stop buffer pollution when leave *does* fire  
3. **Client-only idle + kick-on-auth** — stop phantoms / dual guest+user  
4. **Grace 5s→60s + stop hide-teardown** — stop false leaves in background tabs  

Two mitigations for related UX (presence grace vs chat linger cancel), plus **idle then grace** (a dead user can stay “here” up to ~3m+60s), is the main source of confusion. `PresenceStore.setScene` / `moveUser` are unused; HTTP scene changes go through reconnect.

## Simplification

**Modestly yes — not by deleting grace.** Full-page nav drops SSE, so some delayed leave is load-bearing.

### Keep (essential)

- Coalesce by `userKey`
- Reconnect grace + pending counted as here/online
- Same-scene silent reconnect; cross-scene `move`
- Client `/live/ping` + idle sweep
- Immediate `kick` for auth/mod
- View disconnects
- Linger cancel (late-joiner hygiene; separate from presence grace)

### Recommended trim (not implemented yet)

1. **Idle sweep should leave immediately** (kick path, not `disconnect` → grace). Grace is for expected socket drops; failed proof-of-life should not get another 60s of phantom “here”.
2. **Delete unused `setScene` / `moveUser`**.

Target mental model after that trim:

```text
disconnect (nav / View / last tab) → grace 60s → leave
idle (no client ping)              → leave now
kick (auth / mod)                  → leave now
reconnect within grace             → silent or move
```

### Non-goals (not a simplification of this layer)

- Dropping reconnect grace while keeping full-page SSE teardown  
- Merging leave into the 3m idle timer only (closed tabs would linger in who’s-here for 3 minutes)  
- Soft-nav / SPA so SSE never drops — a separate product change  

## Related code

| Path | Role |
|------|------|
| `src/live/presence.ts` | Connections, grace, idle, kick, fanout |
| `src/live/hub.ts` | Chat linger; join/leave/move → system lines |
| `src/live/types.ts` | Events, messages, timing constants |
| `src/live/location.ts` | Persisted `lastSceneId` / `lastSeenAt` |
| `src/routes/live.ts` | SSE, ping, say/shout, here/online, admin kick |
| `client/live.ts` | SSE client, who’s here / online UI |
| `client/panel.ts` | Live/Edit keep SSE; View disconnects |
| `tests/live.test.ts` | Behavior contract |
