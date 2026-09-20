import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { isManager, isModerator } from "../access/permissions.js";
import { evaluateSceneEntry } from "../access/scene-entry.js";
import { apiError, page, parseEnabledFlag, readRequestBody, respondMutation, sceneBackLink, wantsJson } from "../http.js";
import { liveAdminPageView } from "../render/view/index.js";
import { updateSetting } from "../store/settings.js";
import { guestCookieName, parseGuestId } from "../live/guest.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { clientIp } from "../rate-limit/client-ip.js";
import type { LiveEvent } from "../live/types.js";
import { HEARTBEAT_INTERVAL_MS, SSE_CONNECT_PADDING_BYTES } from "../live/types.js";
import type { WorldStore } from "../store/world.js";

export const liveRoutes = new Hono();

const LIVE_USER_KEY = /^(u:[a-zA-Z0-9_-]{2,32}|g:[a-f0-9]{16,64})$/i;

const liveSseLimit = rateLimit({
  name: "live-sse",
  bucket: (limits) => limits.liveSse,
  key: (c) => `ip:${clientIp(c)}`,
});

const liveChatLimit = rateLimit({
  name: "live-chat",
  bucket: (limits) => limits.liveChat,
  key: liveChatKeys,
});

liveRoutes.get("/events", liveSseLimit, async (c) => {
  const world = c.get("world");
  const presence = c.get("presence");
  const hub = c.get("hub");
  const locations = c.get("locations");
  const sceneId = Number(c.req.query("scene"));
  if (!Number.isFinite(sceneId)) {
    return c.json({ error: "scene query required" }, 400);
  }
  const identity = resolveLiveIdentity(c);
  if (!identity.user && !world.isGuestLiveEnabled()) {
    return c.json({ error: "Guest live is disabled." }, 403);
  }
  const entered = evaluateSceneEntry(world, identity.user, sceneId, { teleport: "ignore" });
  if (!entered.ok) {
    if (entered.status === 404) return c.json({ error: "Scene not found" }, 404);
    return c.json({ error: "Forbidden" }, entered.status);
  }

  if (identity.guestId && !getCookie(c, cookieNameForGuest(c))) {
    setCookie(c, cookieNameForGuest(c), identity.guestId, {
      httpOnly: true,
      sameSite: "Lax",
      path: c.get("assetBase") || "/",
      maxAge: 60 * 60 * 24,
      secure: cookieSecure(),
    });
  }

  // nginx proxies buffer by default; without this (or proxy_buffering off),
  // EventSource hangs on "Connecting…" until the buffer fills.
  c.header("X-Accel-Buffering", "no");
  // streamSSE overwrites Cache-Control with no-cache; no-transform is set on the Response.

  const res = streamSSE(c, async (stream) => {
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
    presence.setAbort(conn.connectionId, () => {
      void stream.close();
    });

    // Chromium sends Accept-Encoding: gzip (EventSource cannot override that).
    // A 4KB SSE comment forces gzip/proxy buffers to flush so the snapshot is parsed.
    await stream.write(`:${" ".repeat(SSE_CONNECT_PADDING_BYTES)}\n\n`);

    const snap = hub.snapshot(sceneId);
    await stream.writeSSE({
      event: "presence.snapshot",
      data: JSON.stringify({
        kind: "presence.snapshot",
        ts: new Date().toISOString(),
        sceneId,
        here: snap.here,
        messages: snap.messages,
        shouts: snap.shouts,
      } satisfies LiveEvent),
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
        if (!presence.getConnection(conn.connectionId)) break;
        await stream.writeSSE({ event: "ping", data: "{}" });
        await stream.sleep(HEARTBEAT_INTERVAL_MS);
      }
    } finally {
      cleanup();
    }
  });
  res.headers.set("Cache-Control", "no-cache, no-transform");
  return res;
});

liveRoutes.post("/say", liveChatLimit, async (c) => {
  const world = c.get("world");
  if (!world.isLiveChatEnabled()) {
    return c.json({ error: "Live chat is disabled." }, 403);
  }
  const presence = c.get("presence");
  const hub = c.get("hub");
  const identity = resolveLiveIdentity(c);
  const body = await readRequestBody(c);
  const text = String(body.text ?? "").trim();
  if (!text) return c.json({ error: "text required" }, 400);

  const online = presence.findByUserKey(identity.userKey);
  if (!online) return c.json({ error: "Not present — open Live mode first." }, 400);

  const entered = evaluateSceneEntry(world, identity.user, online.sceneId, {
    teleport: "ignore",
  });
  if (!entered.ok) return c.json({ error: "Forbidden" }, 403);

  presence.heartbeatUser(identity.userKey);
  const message = hub.say({
    sceneId: online.sceneId,
    fromKey: identity.userKey,
    fromName: identity.displayName,
    text,
  });
  return c.json({ ok: true, message });
});

liveRoutes.post("/shout", liveChatLimit, async (c) => {
  const world = c.get("world");
  if (!world.isLiveChatEnabled()) {
    return c.json({ error: "Live chat is disabled." }, 403);
  }
  const presence = c.get("presence");
  const hub = c.get("hub");
  const identity = resolveLiveIdentity(c);
  const body = await readRequestBody(c);
  const text = String(body.text ?? "").trim();
  if (!text) return c.json({ error: "text required" }, 400);

  const online = presence.findByUserKey(identity.userKey);
  if (!online) return c.json({ error: "Not present — open Live mode first." }, 400);

  const scene = world.getScene(online.sceneId);
  presence.heartbeatUser(identity.userKey);
  const message = hub.shout({
    fromKey: identity.userKey,
    fromName: identity.displayName,
    text,
    sceneId: online.sceneId,
    sceneTitle: scene?.title ?? `Scene ${online.sceneId}`,
  });
  return c.json({ ok: true, message });
});

liveRoutes.post("/ping", async (c) => {
  const world = c.get("world");
  const identity = resolveLiveIdentity(c);
  if (!identity.user && !world.isGuestLiveEnabled()) {
    return c.json({ error: "Guest live is disabled." }, 403);
  }
  const presence = c.get("presence");
  if (!presence.heartbeatUser(identity.userKey)) {
    return c.json({ error: "Not present — open Live mode first." }, 400);
  }
  return c.json({ ok: true });
});

liveRoutes.get("/here", (c) => {
  const sceneId = Number(c.req.query("scene"));
  if (!Number.isFinite(sceneId)) return c.json({ error: "scene query required" }, 400);
  const world = c.get("world");
  const user = c.get("user");
  const entered = evaluateSceneEntry(world, user, sceneId, { teleport: "ignore" });
  if (!entered.ok) {
    if (entered.status === 404) return c.json({ error: "Scene not found" }, 404);
    return c.json({ error: "Forbidden" }, entered.status);
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
  const entered = evaluateSceneEntry(world, user, target.sceneId, { teleport: "ignore" });
  if (!entered.ok) {
    if (entered.status === 404) return apiError(c, 404, "Their scene no longer exists.");
    return apiError(c, entered.status, entered.message);
  }

  // Join skips entrance groups when the destination is readable (asJoin).
  world.resolveTeleportTarget(target.sceneId, undefined, { asJoin: true });
  return respondMutation(c, {
    json: {
      ok: true,
      sceneId: target.sceneId,
      href: `${c.get("assetBase")}/s/${target.sceneId}?from=${target.sceneId}`,
    },
    redirect: `/s/${target.sceneId}`,
    flash: { from: String(target.sceneId) },
  });
});

liveRoutes.post("/purge", async (c) => {
  const user = c.get("user");
  const world = c.get("world");
  if (!isModerator(user, world)) {
    return c.json({ error: "Moderator access required" }, 403);
  }
  const body = await readRequestBody(c);
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
    const payload: Record<string, unknown> = { users: recentUsers, buffers };
    if (isManager(user, world)) {
      Object.assign(payload, liveAdminSecuritySettings(world));
    }
    return c.json(payload);
  }

  const back = sceneBackLink(user!, world);
  const security = isManager(user, world) ? liveAdminSecuritySettings(world) : undefined;
  return page(c, 200, liveAdminPageView({ users: recentUsers, buffers, back, security }));
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

liveRoutes.post("/admin/kick", async (c) => {
  const user = c.get("user");
  const world = c.get("world");
  if (!isModerator(user, world)) {
    return c.json({ error: "Moderator access required" }, 403);
  }
  const body = await readRequestBody(c);
  const userKey = String(body.userKey ?? "").trim();
  if (!LIVE_USER_KEY.test(userKey)) {
    return apiError(c, 400, "userKey required.");
  }
  const kicked = c.get("presence").kick(userKey);
  if (!kicked) return apiError(c, 404, "That presence is not online.");
  if (userKey.startsWith("u:")) {
    void c.get("locations").flush(userKey.slice(2));
  }
  if (wantsJson(c)) return c.json({ ok: true, userKey });
  return c.redirect(`${c.get("assetBase")}/live/admin?kicked=1`);
});

liveRoutes.post("/admin/guest-live", async (c) => setLiveSecurityToggle(c, "guestLiveEnabled"));
liveRoutes.post("/admin/live-chat", async (c) => setLiveSecurityToggle(c, "liveChatEnabled"));
liveRoutes.post("/admin/registration", async (c) => setLiveSecurityToggle(c, "registrationEnabled"));
liveRoutes.post("/admin/non-manager-editing", async (c) =>
  setLiveSecurityToggle(c, "nonManagerEditingEnabled"),
);
liveRoutes.post("/admin/non-manager-view", async (c) =>
  setLiveSecurityToggle(c, "nonManagerViewEnabled"),
);

type LiveSecuritySettingKey =
  | "guestLiveEnabled"
  | "liveChatEnabled"
  | "registrationEnabled"
  | "nonManagerEditingEnabled"
  | "nonManagerViewEnabled";

interface LiveAdminSecuritySettings {
  guestLiveEnabled: boolean;
  liveChatEnabled: boolean;
  registrationEnabled: boolean;
  nonManagerEditingEnabled: boolean;
  nonManagerViewEnabled: boolean;
}

function liveAdminSecuritySettings(world: WorldStore): LiveAdminSecuritySettings {
  return {
    guestLiveEnabled: world.isGuestLiveEnabled(),
    liveChatEnabled: world.isLiveChatEnabled(),
    registrationEnabled: world.isRegistrationEnabled(),
    nonManagerEditingEnabled: world.isNonManagerEditingEnabled(),
    nonManagerViewEnabled: world.isNonManagerViewEnabled(),
  };
}

async function setLiveSecurityToggle(c: Context, key: LiveSecuritySettingKey) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const body = await readRequestBody(c);
  const enabled = parseEnabledFlag(body.enabled ?? body[key]);
  await updateSetting(world, key, enabled);

  const settings = liveAdminSecuritySettings(world);
  const qsParam =
    key === "guestLiveEnabled"
      ? "guest"
      : key === "liveChatEnabled"
        ? "chat"
        : key === "registrationEnabled"
          ? "reg"
          : key === "nonManagerEditingEnabled"
            ? "edit"
            : "view";
  return respondMutation(c, {
    json: { ok: true, ...settings },
    redirect: "/live/admin",
    flash: { [qsParam]: settings[key] ? "on" : "off" },
  });
}


function liveChatKeys(c: Context): string[] {
  const ip = clientIp(c);
  const user = c.get("user");
  if (user) return [`user:${user.username}`];
  const guestId = parseGuestId(getCookie(c, cookieNameForGuest(c)));
  const keys = [`ip:${ip}`];
  if (guestId) keys.push(`g:${guestId}`);
  return keys;
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
  let guestId = parseGuestId(getCookie(c, cookieNameForGuest(c)));
  if (!guestId) {
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

function cookieNameForGuest(c: Context): string {
  return guestCookieName(c.get("sessionCookieName") ?? "proseden_session");
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.PROSEDEN_SECURE_COOKIES === "1";
}

