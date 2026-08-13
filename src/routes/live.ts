import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { canRead, isManager, isModerator } from "../access/permissions.js";
import { apiError, ownedSceneLinks, wantsJson } from "../http.js";
import type { LiveEvent } from "../live/types.js";
import { HEARTBEAT_INTERVAL_MS } from "../live/types.js";
import { negotiateFormat } from "../render/format.js";
import {
  editModeHrefs,
  escapeHtml,
  renderHtmlPage,
  renderMessageBodyHtml,
} from "../render/html.js";
import { renderMessageText } from "../render/text.js";

export const liveRoutes = new Hono();

const GUEST_COOKIE = "proseden_guest";

liveRoutes.get("/events", async (c) => {
  const world = c.get("world");
  const presence = c.get("presence");
  const hub = c.get("hub");
  const locations = c.get("locations");
  const sceneId = Number(c.req.query("scene"));
  if (!Number.isFinite(sceneId)) {
    return c.json({ error: "scene query required" }, 400);
  }
  const scene = world.getScene(sceneId);
  if (!scene) return c.json({ error: "Scene not found" }, 404);

  const identity = resolveLiveIdentity(c);
  if (!canRead(identity.user, scene, world)) {
    return c.json({ error: "Forbidden" }, identity.user ? 403 : 401);
  }

  if (identity.guestId && !getCookie(c, guestCookieName(c))) {
    setCookie(c, guestCookieName(c), identity.guestId, {
      httpOnly: true,
      sameSite: "Lax",
      path: c.get("assetBase") || "/",
      maxAge: 60 * 60 * 24,
      secure: cookieSecure(),
    });
  }

  return streamSSE(c, async (stream) => {
    let closed = false;
    const conn = presence.connect({
      userKey: identity.userKey,
      displayName: identity.displayName,
      sceneId,
    });

    const send = (event: LiveEvent) => {
      if (closed) return;
      void stream.writeSSE({
        event: event.kind,
        data: JSON.stringify(event),
      });
    };
    presence.setSend(conn.connectionId, send);

    const snap = hub.snapshot(sceneId);
    send({
      kind: "presence.snapshot",
      ts: new Date().toISOString(),
      sceneId,
      here: snap.here,
      messages: snap.messages,
      shouts: snap.shouts,
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      presence.disconnect(conn.connectionId);
      if (identity.user) void locations.flush(identity.user.username);
    };
    stream.onAbort(cleanup);

    try {
      while (!closed) {
        presence.heartbeat(conn.connectionId);
        await stream.writeSSE({ event: "ping", data: "{}" });
        await stream.sleep(HEARTBEAT_INTERVAL_MS);
      }
    } finally {
      cleanup();
    }
  });
});

liveRoutes.post("/say", async (c) => {
  const presence = c.get("presence");
  const hub = c.get("hub");
  const identity = resolveLiveIdentity(c);
  const body = await readJsonBody(c);
  const text = String(body.text ?? "").trim();
  if (!text) return c.json({ error: "text required" }, 400);

  const online = presence.findByUserKey(identity.userKey);
  if (!online) return c.json({ error: "Not present — open Live mode first." }, 400);

  const world = c.get("world");
  const scene = world.getScene(online.sceneId);
  if (!scene || !canRead(identity.user, scene, world)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const message = hub.say({
    sceneId: online.sceneId,
    fromKey: identity.userKey,
    fromName: identity.displayName,
    text,
  });
  return c.json({ ok: true, message });
});

liveRoutes.post("/shout", async (c) => {
  const presence = c.get("presence");
  const hub = c.get("hub");
  const identity = resolveLiveIdentity(c);
  const body = await readJsonBody(c);
  const text = String(body.text ?? "").trim();
  if (!text) return c.json({ error: "text required" }, 400);

  const online = presence.findByUserKey(identity.userKey);
  if (!online) return c.json({ error: "Not present — open Live mode first." }, 400);

  const world = c.get("world");
  const scene = world.getScene(online.sceneId);
  const message = hub.shout({
    fromKey: identity.userKey,
    fromName: identity.displayName,
    text,
    sceneId: online.sceneId,
    sceneTitle: scene?.title ?? `Scene ${online.sceneId}`,
  });
  return c.json({ ok: true, message });
});

liveRoutes.get("/here", (c) => {
  const sceneId = Number(c.req.query("scene"));
  if (!Number.isFinite(sceneId)) return c.json({ error: "scene query required" }, 400);
  const world = c.get("world");
  const scene = world.getScene(sceneId);
  if (!scene) return c.json({ error: "Scene not found" }, 404);
  const user = c.get("user");
  if (!canRead(user, scene, world)) {
    return c.json({ error: "Forbidden" }, user ? 403 : 401);
  }
  return c.json({ sceneId, here: c.get("presence").here(sceneId) });
});

liveRoutes.get("/online", (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "Authentication required" }, 401);
  const world = c.get("world");
  const list = c.get("presence").online().map((p) => {
    const scene = world.getScene(p.sceneId);
    return {
      ...p,
      sceneTitle: scene?.title,
    };
  });
  return c.json({ online: list });
});

liveRoutes.get("/join/:userKey", (c) => {
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Log in to join someone.");
  const targetKey = decodeURIComponent(c.req.param("userKey"));
  const presence = c.get("presence");
  const target = presence.findByUserKey(targetKey);
  if (!target) return apiError(c, 404, "That person is not online.");

  const world = c.get("world");
  const scene = world.getScene(target.sceneId);
  if (!scene) return apiError(c, 404, "Their scene no longer exists.");
  if (!canRead(user, scene, world)) {
    return apiError(c, 403, "You cannot read the scene they are in.");
  }

  // Join skips entrance groups when the destination is readable (asJoin).
  world.resolveTeleportTarget(target.sceneId, undefined, { asJoin: true });
  const dest = `${c.get("assetBase")}/s/${target.sceneId}?from=${target.sceneId}`;
  if (wantsJson(c)) {
    return c.json({ ok: true, sceneId: target.sceneId, href: dest });
  }
  return c.redirect(dest);
});

liveRoutes.post("/purge", async (c) => {
  const user = c.get("user");
  const world = c.get("world");
  if (!isModerator(user, world)) {
    return c.json({ error: "Moderator access required" }, 403);
  }
  const body = await readJsonBody(c);
  const presence = c.get("presence");
  const identity = user ? `u:${user.username}` : "";
  const online = identity ? presence.findByUserKey(identity) : undefined;
  const sceneId = Number(body.sceneId ?? online?.sceneId);
  if (!Number.isFinite(sceneId)) return c.json({ error: "sceneId required" }, 400);
  c.get("hub").purgeScene(sceneId);
  return c.json({ ok: true, purgedSceneId: sceneId });
});

liveRoutes.get("/admin", (c) => {
  const user = c.get("user");
  const world = c.get("world");
  if (!isModerator(user, world)) {
    return apiError(c, user ? 403 : 401, "Moderator access required.");
  }
  const presence = c.get("presence");
  const hub = c.get("hub");
  const liveKeys = new Set(presence.online().map((p) => p.userKey));
  const recentUsers = world.listUsers().map((u) => {
    const live = liveKeys.has(`u:${u.username}`);
    const scene = u.lastSceneId !== undefined ? world.getScene(u.lastSceneId) : undefined;
    return {
      username: u.username,
      userKey: `u:${u.username}`,
      lastSeenAt: u.lastSeenAt,
      lastSceneId: u.lastSceneId,
      sceneTitle: scene?.title,
      live,
    };
  });
  for (const p of presence.online()) {
    if (p.userKey.startsWith("g:")) {
      recentUsers.push({
        username: p.displayName,
        userKey: p.userKey,
        lastSeenAt: p.lastSeenAt,
        lastSceneId: p.sceneId,
        sceneTitle: world.getScene(p.sceneId)?.title,
        live: true,
      });
    }
  }
  recentUsers.sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""));

  const buffers = hub.bufferStats().map((b) => ({
    ...b,
    sceneTitle:
      b.sceneId === "shouts"
        ? "Shouts (global)"
        : world.getScene(b.sceneId as number)?.title,
  }));

  if (wantsJson(c)) {
    return c.json({ users: recentUsers, buffers });
  }

  const format = negotiateFormat(c);
  const bodyHtml = renderLiveAdminHtml(recentUsers, buffers);
  const textBody = renderLiveAdminText(recentUsers, buffers);
  if (format === "text") return c.text(textBody);
  return c.html(
    renderHtmlPage({
      title: "Live admin",
      bodyHtml,
      user,
      assetBase: c.get("assetBase"),
      ownedScenes: ownedSceneLinks(world, user),
      isManager: isManager(user, world),
      isModerator: true,
      ...editModeHrefs(c.req.url, c.get("assetBase")),
    }),
  );
});

liveRoutes.post("/admin/purge", async (c) => {
  const user = c.get("user");
  const world = c.get("world");
  if (!isModerator(user, world)) {
    return c.json({ error: "Moderator access required" }, 403);
  }
  c.get("hub").purgeAll();
  if (wantsJson(c)) return c.json({ ok: true });
  return c.redirect(`${c.get("assetBase")}/live/admin?purged=1`);
});

function renderLiveAdminHtml(
  users: Array<{
    username: string;
    userKey: string;
    lastSeenAt?: string;
    lastSceneId?: number;
    sceneTitle?: string;
    live: boolean;
  }>,
  buffers: Array<{
    sceneId: number | "shouts";
    sceneTitle?: string;
    count: number;
    oldestAt?: string;
    newestAt?: string;
  }>,
): string {
  const userRows = users
    .map((u) => {
      const age = u.lastSeenAt ? relativeAge(u.lastSeenAt) : "—";
      const loc =
        u.lastSceneId !== undefined
          ? `${escapeHtml(u.sceneTitle ?? "Untitled")} (#${u.lastSceneId})`
          : "—";
      return `<tr>
        <td>${escapeHtml(u.username)}${u.live ? ' <span class="muted">live</span>' : ""}</td>
        <td>${escapeHtml(age)}</td>
        <td>${loc}</td>
      </tr>`;
    })
    .join("\n");
  const bufRows = buffers
    .map((b) => {
      const label =
        b.sceneId === "shouts"
          ? "Shouts"
          : `${escapeHtml(b.sceneTitle ?? "Untitled")} (#${b.sceneId})`;
      return `<tr>
        <td>${label}</td>
        <td>${b.count}</td>
        <td>${b.oldestAt ? escapeHtml(relativeAge(b.oldestAt)) : "—"}</td>
        <td>${b.newestAt ? escapeHtml(relativeAge(b.newestAt)) : "—"}</td>
      </tr>`;
    })
    .join("\n");
  return `<h1>Live admin</h1>
    <p class="muted">Recently seen users and in-memory chat buffer stats (no message text).</p>
    <h2>Users</h2>
    <table class="live-admin-table">
      <thead><tr><th>User</th><th>Last seen</th><th>Location</th></tr></thead>
      <tbody>${userRows || `<tr><td colspan="3" class="muted">None yet</td></tr>`}</tbody>
    </table>
    <h2>Chat buffers</h2>
    <table class="live-admin-table">
      <thead><tr><th>Scene</th><th>Count</th><th>Oldest</th><th>Newest</th></tr></thead>
      <tbody>${bufRows || `<tr><td colspan="4" class="muted">Empty</td></tr>`}</tbody>
    </table>
    <form method="post" action="live/admin/purge" class="stack" onsubmit="return confirm('Purge all in-memory chat buffers?');">
      <button type="submit" class="edit-danger">Purge all chats</button>
    </form>`;
}

function renderLiveAdminText(
  users: Array<{
    username: string;
    lastSeenAt?: string;
    lastSceneId?: number;
    sceneTitle?: string;
    live: boolean;
  }>,
  buffers: Array<{
    sceneId: number | "shouts";
    sceneTitle?: string;
    count: number;
    oldestAt?: string;
    newestAt?: string;
  }>,
): string {
  const lines = ["Live admin", "", "Users:"];
  for (const u of users) {
    lines.push(
      `- ${u.username}${u.live ? " [live]" : ""} · last ${u.lastSeenAt ? relativeAge(u.lastSeenAt) : "—"} · scene ${u.lastSceneId ?? "—"} ${u.sceneTitle ?? ""}`,
    );
  }
  lines.push("", "Buffers:");
  for (const b of buffers) {
    lines.push(
      `- ${b.sceneId} ${b.sceneTitle ?? ""} · ${b.count} msgs · oldest ${b.oldestAt ? relativeAge(b.oldestAt) : "—"} · newest ${b.newestAt ? relativeAge(b.newestAt) : "—"}`,
    );
  }
  lines.push("", "Purge all: POST /live/admin/purge");
  return lines.join("\n");
}

function relativeAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return iso;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function resolveLiveIdentity(c: Context): {
  userKey: string;
  displayName: string;
  user: ReturnType<typeof c.get<"user">>;
  guestId?: string;
} {
  const user = c.get("user");
  if (user) {
    return { userKey: `u:${user.username}`, displayName: user.username, user };
  }
  let guestId = getCookie(c, guestCookieName(c));
  if (!guestId || !/^[a-f0-9]{16,64}$/i.test(guestId)) {
    guestId = randomBytes(16).toString("hex");
  }
  const short = guestId.slice(0, 6);
  return {
    userKey: `g:${guestId}`,
    displayName: `guest-${short}`,
    user: undefined,
    guestId,
  };
}

function guestCookieName(c: Context): string {
  const base = c.get("sessionCookieName") ?? "proseden_session";
  if (base.endsWith("_session")) return `${base.slice(0, -"_session".length)}_guest`;
  return GUEST_COOKIE;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.PROSEDEN_SECURE_COOKIES === "1";
}

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await c.req.json()) as Record<string, unknown>;
  }
  const form = await c.req.parseBody();
  return form as Record<string, unknown>;
}
