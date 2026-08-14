import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { PresenceStore } from "../src/live/presence.js";
import { clientIp } from "../src/rate-limit/client-ip.js";
import { RateLimiter } from "../src/rate-limit/limiter.js";
import { WorldStore } from "../src/store/world.js";

describe("RateLimiter", () => {
  it("allows up to max hits inside the window then rejects", () => {
    const limiter = new RateLimiter();
    expect(limiter.hit("a", 2, 1000, 0).ok).toBe(true);
    expect(limiter.hit("a", 2, 1000, 100).ok).toBe(true);
    const blocked = limiter.hit("a", 2, 1000, 200);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBe(1000);
  });

  it("expires hits that slide out of the window", () => {
    const limiter = new RateLimiter();
    expect(limiter.hit("a", 1, 1000, 0).ok).toBe(true);
    expect(limiter.hit("a", 1, 1000, 500).ok).toBe(false);
    expect(limiter.hit("a", 1, 1000, 1001).ok).toBe(true);
  });

  it("tracks independent keys separately", () => {
    const limiter = new RateLimiter();
    expect(limiter.hit("a", 1, 1000, 0).ok).toBe(true);
    expect(limiter.hit("b", 1, 1000, 0).ok).toBe(true);
    expect(limiter.hit("a", 1, 1000, 1).ok).toBe(false);
    expect(limiter.hit("b", 1, 1000, 1).ok).toBe(false);
  });

  it("prunes expired keys", () => {
    const limiter = new RateLimiter();
    limiter.hit("a", 5, 1000, 0);
    limiter.hit("b", 5, 2000, 500);
    expect(limiter.size()).toBe(2);
    limiter.pruneExpired(1001);
    expect(limiter.size()).toBe(1);
    limiter.pruneExpired(2501);
    expect(limiter.size()).toBe(0);
  });
});

describe("clientIp", () => {
  it("uses the last X-Forwarded-For hop", async () => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c)));
    const res = await app.request("/", {
      headers: { "X-Forwarded-For": "10.0.0.1, 203.0.113.5" },
    });
    expect(await res.text()).toBe("203.0.113.5");
  });

  it("falls back to unknown without a connection", async () => {
    const app = new Hono();
    app.get("/", (c) => c.text(clientIp(c)));
    const res = await app.request("/");
    expect(await res.text()).toBe("unknown");
  });
});

describe("HTTP rate limits", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let presence: PresenceStore;
  let publicSceneId: number;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-rl-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    const scene = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Public.",
      visibility: "public",
    });
    publicSceneId = scene.id;
    sessions = new SessionStore();
    token = sessions.create("alice").token;
    presence = new PresenceStore();
  });

  afterEach(async () => {
    presence.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  function app(rateLimits: Parameters<typeof createApp>[0]["rateLimits"]) {
    return createApp({ world, sessions, presence, rateLimits });
  }

  function jsonHeaders(extra: Record<string, string> = {}) {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...extra,
    };
  }

  it("returns 429 after too many logins from one IP", async () => {
    const hono = app({ auth: { max: 2, windowMs: 60_000 } });
    const body = JSON.stringify({ username: "alice", password: "wrong" });
    const headers = jsonHeaders({ "X-Forwarded-For": "203.0.113.10" });

    expect((await hono.request("/auth/login", { method: "POST", headers, body })).status).toBe(401);
    expect((await hono.request("/auth/login", { method: "POST", headers, body })).status).toBe(401);

    const blocked = await hono.request("/auth/login", { method: "POST", headers, body });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(await blocked.json()).toEqual({ error: "Too many requests. Try again later." });
  });

  it("still allows a different IP after one address is blocked", async () => {
    const hono = app({ auth: { max: 1, windowMs: 60_000 } });
    const body = JSON.stringify({ username: "nobody", password: "x" });
    const first = await hono.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders({ "X-Forwarded-For": "203.0.113.10" }),
      body,
    });
    expect(first.status).toBe(401);

    const blocked = await hono.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders({ "X-Forwarded-For": "203.0.113.10" }),
      body,
    });
    expect(blocked.status).toBe(429);

    const other = await hono.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders({ "X-Forwarded-For": "203.0.113.11" }),
      body: JSON.stringify({ username: "other", password: "x" }),
    });
    expect(other.status).toBe(401);
  });

  it("caps login stuffing against one username across IPs", async () => {
    const hono = app({ auth: { max: 2, windowMs: 60_000 } });
    const body = JSON.stringify({ username: "alice", password: "wrong" });

    expect(
      (
        await hono.request("/auth/login", {
          method: "POST",
          headers: jsonHeaders({ "X-Forwarded-For": "198.51.100.1" }),
          body,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await hono.request("/auth/login", {
          method: "POST",
          headers: jsonHeaders({ "X-Forwarded-For": "198.51.100.2" }),
          body,
        })
      ).status,
    ).toBe(401);

    const blocked = await hono.request("/auth/login", {
      method: "POST",
      headers: jsonHeaders({ "X-Forwarded-For": "198.51.100.3" }),
      body,
    });
    expect(blocked.status).toBe(429);
  });

  it("returns 429 after too many register attempts", async () => {
    const hono = app({ auth: { max: 2, windowMs: 60_000 } });
    const headers = jsonHeaders({ "X-Forwarded-For": "203.0.113.20" });

    const first = await hono.request("/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "bob", password: "secret1" }),
    });
    expect(first.status).toBe(201);

    const second = await hono.request("/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "carol", password: "secret1" }),
    });
    expect(second.status).toBe(201);

    const blocked = await hono.request("/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "dave", password: "secret1" }),
    });
    expect(blocked.status).toBe(429);
  });

  it("returns 429 after too many live say posts", async () => {
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: publicSceneId,
    });
    const hono = app({ liveChat: { max: 2, windowMs: 60_000 } });
    const headers = jsonHeaders({ Authorization: `Bearer ${token}` });
    const body = JSON.stringify({ text: "hi" });

    expect((await hono.request("/live/say", { method: "POST", headers, body })).status).toBe(200);
    expect((await hono.request("/live/say", { method: "POST", headers, body })).status).toBe(200);

    const blocked = await hono.request("/live/say", { method: "POST", headers, body });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Too many requests. Try again later." });
  });

  it("limits guest chat by IP so cookie rotation does not bypass", async () => {
    const hono = app({ liveChat: { max: 1, windowMs: 60_000 } });
    const headers = jsonHeaders({ "X-Forwarded-For": "203.0.113.30" });
    const first = await hono.request("/live/say", {
      method: "POST",
      headers: { ...headers, Cookie: "proseden_guest=aaaaaaaaaaaaaaaa" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(first.status).toBe(400);

    const rotated = await hono.request("/live/say", {
      method: "POST",
      headers: { ...headers, Cookie: "proseden_guest=bbbbbbbbbbbbbbbb" },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(rotated.status).toBe(429);

    const otherIp = await hono.request("/live/say", {
      method: "POST",
      headers: jsonHeaders({ "X-Forwarded-For": "203.0.113.31" }),
      body: JSON.stringify({ text: "hi" }),
    });
    expect(otherIp.status).toBe(400);
  });

  it("does not rate-limit ordinary GET reads or logout", async () => {
    const hono = app({
      writes: { max: 0, windowMs: 60_000 },
      auth: { max: 0, windowMs: 60_000 },
    });
    expect((await hono.request("/health")).status).toBe(200);
    expect((await hono.request(`/s/${publicSceneId}`)).status).toBe(200);

    const created = await hono.request("/s", {
      method: "POST",
      headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
      body: JSON.stringify({ title: "Nope", body: "x", visibility: "private" }),
    });
    expect(created.status).toBe(429);

    const logout = await hono.request("/auth/logout", {
      method: "POST",
      headers: jsonHeaders({ Authorization: `Bearer ${token}` }),
    });
    expect(logout.status).toBe(200);
  });

  it("does not rate-limit managers", async () => {
    await world.setStaffRoles("alice", ["manager"]);
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: publicSceneId,
    });
    const hono = app({
      liveChat: { max: 1, windowMs: 60_000 },
      writes: { max: 0, windowMs: 60_000 },
    });
    const headers = jsonHeaders({ Authorization: `Bearer ${token}` });

    expect(
      (await hono.request("/live/say", { method: "POST", headers, body: JSON.stringify({ text: "one" }) }))
        .status,
    ).toBe(200);
    expect(
      (await hono.request("/live/say", { method: "POST", headers, body: JSON.stringify({ text: "two" }) }))
        .status,
    ).toBe(200);

    const created = await hono.request("/s", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Manager nook", body: "ok", visibility: "private" }),
    });
    expect(created.status).toBe(201);
  });

  it("still rate-limits login attempts at a manager username when not signed in", async () => {
    await world.setStaffRoles("alice", ["manager"]);
    const hono = app({ auth: { max: 1, windowMs: 60_000 } });
    const body = JSON.stringify({ username: "alice", password: "wrong" });
    const headers = jsonHeaders({ "X-Forwarded-For": "203.0.113.40" });

    expect((await hono.request("/auth/login", { method: "POST", headers, body })).status).toBe(401);
    const blocked = await hono.request("/auth/login", { method: "POST", headers, body });
    expect(blocked.status).toBe(429);
  });
});
