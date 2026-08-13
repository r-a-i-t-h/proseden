import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { SceneHub } from "../src/live/hub.js";
import { PresenceStore } from "../src/live/presence.js";
import { mergeChatTimeline } from "../src/live/types.js";
import { WorldStore } from "../src/store/world.js";

type App = ReturnType<typeof createApp>;

describe("live presence and chat", () => {
  let dataDir: string;
  let world: WorldStore;
  let app: App;
  let tokens: Record<string, string>;
  let presence: PresenceStore;
  let hub: SceneHub;
  let sceneIds: { public: number; privateInner: number; entrance: number };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-live-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    for (const name of ["alice", "bob", "mod"]) {
      await world.createUser(name, password.hash, password.salt);
    }
    await world.setStaffRoles("mod", ["moderator"]);

    const hall = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Public.",
      visibility: "public",
    });
    const entrance = await world.createScene({
      owner: "alice",
      title: "Entrance",
      body: "Private door.",
      visibility: "private",
    });
    const inner = await world.createScene({
      owner: "alice",
      title: "Inner",
      body: "Deep.",
      visibility: "private",
    });
    await world.updateSceneAccess(entrance.id, {
      grants: [{ who: "bob", rights: ["read"] }],
    });
    await world.updateSceneAccess(inner.id, {
      grants: [{ who: "bob", rights: ["read"] }],
    });
    await world.createEntranceGroup({
      title: "Wing",
      entranceSceneId: entrance.id,
      sceneIds: [entrance.id, inner.id],
    });

    sceneIds = { public: hall.id, privateInner: inner.id, entrance: entrance.id };
    presence = new PresenceStore();
    hub = new SceneHub(presence);
    const sessions = new SessionStore();
    tokens = {
      alice: sessions.create("alice").token,
      bob: sessions.create("bob").token,
      mod: sessions.create("mod").token,
    };
    app = createApp({ world, sessions, presence, hub });
  });

  afterEach(async () => {
    vi.useRealTimers();
    presence.destroy();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lingers say messages for a second client snapshot", () => {
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    hub.say({
      sceneId: sceneIds.public,
      fromKey: "u:alice",
      fromName: "alice",
      text: "Hello linger",
    });
    const snap = hub.snapshot(sceneIds.public);
    expect(snap.messages.some((m) => m.text === "Hello linger")).toBe(true);
  });

  it("merges shouts into scene chat by time for snapshot replay", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00.000Z"));
    hub.say({
      sceneId: sceneIds.public,
      fromKey: "u:alice",
      fromName: "alice",
      text: "first say",
    });
    vi.setSystemTime(new Date("2026-08-13T12:00:01.000Z"));
    hub.shout({
      fromKey: "u:bob",
      fromName: "bob",
      text: "middle shout",
      sceneId: sceneIds.entrance,
      sceneTitle: "Entrance",
    });
    vi.setSystemTime(new Date("2026-08-13T12:00:02.000Z"));
    hub.say({
      sceneId: sceneIds.public,
      fromKey: "u:alice",
      fromName: "alice",
      text: "last say",
    });
    const snap = hub.snapshot(sceneIds.public);
    const texts = mergeChatTimeline(snap.messages, snap.shouts).map((m) => m.text);
    expect(texts).toEqual(["first say", "middle shout", "last say"]);
  });

  it("FIFO drops oldest beyond 100", () => {
    for (let i = 0; i < 105; i++) {
      hub.say({
        sceneId: sceneIds.public,
        fromKey: "u:alice",
        fromName: "alice",
        text: `msg-${i}`,
      });
    }
    const snap = hub.snapshot(sceneIds.public);
    expect(snap.messages.length).toBeLessThanOrEqual(100);
    expect(snap.messages.some((m) => m.text === "msg-0")).toBe(false);
    expect(snap.messages.some((m) => m.text === "msg-104")).toBe(true);
  });

  it("coalesces leave until last connection drops", () => {
    const leaves: string[] = [];
    presence.onEvent((e) => {
      if (e.kind === "presence.leave" && e.person) leaves.push(e.person.userKey);
    });
    const a = presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    const b = presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    presence.disconnect(a.connectionId);
    expect(leaves).toEqual([]);
    presence.disconnect(b.connectionId);
    expect(leaves).toEqual(["u:alice"]);
  });

  it("POST /live/say requires presence", async () => {
    const res = await app.request("/live/say", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ text: "hi" }),
    });
    expect(res.status).toBe(400);
  });

  it("say works when present", async () => {
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    const res = await app.request("/live/say", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ text: "hi room" }),
    });
    expect(res.status).toBe(200);
    const snap = hub.snapshot(sceneIds.public);
    expect(snap.messages.some((m) => m.text === "hi room")).toBe(true);
  });

  it("join lands inside entrance group when readable", async () => {
    presence.connect({
      userKey: "u:bob",
      displayName: "bob",
      sceneId: sceneIds.privateInner,
    });
    const res = await app.request(`/live/join/${encodeURIComponent("u:bob")}`, {
      headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "application/json" },
      redirect: "manual",
    });
    // alice owns inner — can read; join should succeed
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sceneId: number };
    expect(body.sceneId).toBe(sceneIds.privateInner);

    // Ordinary teleport without from would redirect to entrance
    const ordinary = world.resolveTeleportTarget(sceneIds.privateInner, undefined, {
      asOwnerUsername: undefined,
    });
    // Wait - alice is owner so ordinary teleport as owner skips. Use bob... 
    const asOutsider = world.resolveTeleportTarget(sceneIds.privateInner, undefined);
    expect(asOutsider.redirected).toBe(true);
    expect(asOutsider.sceneId).toBe(sceneIds.entrance);

    const asJoin = world.resolveTeleportTarget(sceneIds.privateInner, undefined, { asJoin: true });
    expect(asJoin.redirected).toBe(false);
  });

  it("join forbids unreadable scenes", async () => {
    // carol has no access — create and put alice in vault-like private without bob grant
    const secret = await world.createScene({
      owner: "alice",
      title: "Secret",
      body: "No bob.",
      visibility: "private",
    });
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: secret.id,
    });
    const res = await app.request(`/live/join/${encodeURIComponent("u:alice")}`, {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "application/json" },
    });
    expect(res.status).toBe(403);
  });

  it("records lastSceneId and resumes on login", async () => {
    const visit = await app.request(`/s/${sceneIds.public}`, {
      headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
    });
    expect(visit.status).toBe(200);
    const user = world.getUser("alice");
    expect(user?.lastSceneId).toBe(sceneIds.public);

    // Flush by saving immediately for test reliability
    await world.saveUser({
      ...user!,
      lastSceneId: sceneIds.public,
      lastSeenAt: new Date().toISOString(),
    });

    const login = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret1" }),
      redirect: "manual",
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { lastSceneId: number };
    expect(body.lastSceneId).toBe(sceneIds.public);

    const formLogin = await app.request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=alice&password=secret1",
      redirect: "manual",
    });
    expect(formLogin.status).toBe(302);
    expect(formLogin.headers.get("location")).toContain(`/s/${sceneIds.public}`);
  });

  it("moderator can purge scene and admin lists buffers", async () => {
    hub.say({
      sceneId: sceneIds.public,
      fromKey: "u:alice",
      fromName: "alice",
      text: "fruity",
    });
    const purge = await app.request("/live/purge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mod}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ sceneId: sceneIds.public }),
    });
    expect(purge.status).toBe(200);
    expect(hub.snapshot(sceneIds.public).messages.length).toBe(0);

    hub.say({
      sceneId: sceneIds.public,
      fromKey: "u:alice",
      fromName: "alice",
      text: "again",
    });
    const admin = await app.request("/live/admin", {
      headers: { Authorization: `Bearer ${tokens.mod}`, Accept: "application/json" },
    });
    expect(admin.status).toBe(200);
    const data = (await admin.json()) as { buffers: Array<{ count: number }> };
    expect(data.buffers.some((b) => b.count >= 1)).toBe(true);

    const purgeAll = await app.request("/live/admin/purge", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mod}`,
        Accept: "application/json",
      },
    });
    expect(purgeAll.status).toBe(200);
    expect(hub.bufferStats().length).toBe(0);
  });

  it("scene HTML includes panel bootstrap liveSceneId", async () => {
    const res = await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("assets/panel.js");
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
  });
});
