import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { SceneHub } from "../src/live/hub.js";
import { PresenceStore } from "../src/live/presence.js";
import { mergeChatTimeline, PRESENCE_IDLE_MS, PRESENCE_RECONNECT_GRACE_MS, SSE_CONNECT_PADDING_BYTES } from "../src/live/types.js";
import { guestCookieName } from "../src/live/guest.js";
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
    for (const name of ["alice", "bob", "mod", "mgr"]) {
      await world.createUser(name, password.hash, password.salt);
    }
    await world.setStaffRoles("mod", ["moderator"]);
    await world.setStaffRoles("mgr", ["manager"]);

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
      mgr: sessions.create("mgr").token,
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

  it("cancels consecutive arrive→leave from the linger buffer but still fans out leave", () => {
    vi.useFakeTimers();
    const systemTexts: string[] = [];
    const bob = presence.connect({
      userKey: "u:bob",
      displayName: "bob",
      sceneId: sceneIds.public,
    });
    presence.setSend(bob.connectionId, (e) => {
      if (e.kind === "chat.system" && e.message) systemTexts.push(e.message.text);
    });

    const alice = presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    expect(hub.snapshot(sceneIds.public).messages.map((m) => m.text)).toContain("alice arrives.");
    expect(systemTexts).toEqual(["alice arrives."]);

    presence.disconnect(alice.connectionId);
    vi.advanceTimersByTime(PRESENCE_RECONNECT_GRACE_MS);

    expect(systemTexts).toEqual(["alice arrives.", "alice leaves."]);
    expect(hub.snapshot(sceneIds.public).messages.some((m) => m.fromKey === "u:alice")).toBe(
      false,
    );
  });

  it("does not cancel arrive→leave when another message sits between them", () => {
    vi.useFakeTimers();
    const alice = presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    hub.say({
      sceneId: sceneIds.public,
      fromKey: "u:bob",
      fromName: "bob",
      text: "hi",
    });
    presence.disconnect(alice.connectionId);
    vi.advanceTimersByTime(PRESENCE_RECONNECT_GRACE_MS);

    const texts = hub.snapshot(sceneIds.public).messages.map((m) => m.text);
    expect(texts).toEqual(["alice arrives.", "hi", "alice leaves."]);
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
    vi.useFakeTimers();
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
    expect(leaves).toEqual([]);
    expect(presence.here(sceneIds.public).some((p) => p.userKey === "u:alice")).toBe(true);
    vi.advanceTimersByTime(PRESENCE_RECONNECT_GRACE_MS);
    expect(leaves).toEqual(["u:alice"]);
  });

  it("same-scene reconnect within grace is silent", () => {
    vi.useFakeTimers();
    const kinds: string[] = [];
    presence.onEvent((e) => kinds.push(e.kind));
    const a = presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    expect(kinds).toEqual(["presence.join"]);
    presence.disconnect(a.connectionId);
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    vi.advanceTimersByTime(PRESENCE_RECONNECT_GRACE_MS);
    expect(kinds).toEqual(["presence.join"]);
    expect(presence.here(sceneIds.public).map((p) => p.userKey)).toEqual(["u:alice"]);
  });

  it("reconnect to a different scene within grace emits move", () => {
    vi.useFakeTimers();
    const kinds: string[] = [];
    presence.onEvent((e) => {
      if (e.kind === "presence.join" || e.kind === "presence.leave" || e.kind === "presence.move") {
        kinds.push(e.kind);
      }
    });
    const a = presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    presence.disconnect(a.connectionId);
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.entrance,
    });
    vi.advanceTimersByTime(PRESENCE_RECONNECT_GRACE_MS);
    expect(kinds).toEqual(["presence.join", "presence.move"]);
    expect(presence.here(sceneIds.public)).toEqual([]);
    expect(presence.here(sceneIds.entrance).map((p) => p.userKey)).toEqual(["u:alice"]);
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

  it("SSE /live/events is 403 when the reader fails the scene when-gate", async () => {
    const gated = await world.createScene({
      owner: "alice",
      title: "Gated hall",
      body: "Shut.",
      visibility: "public",
    });
    await world.updateScene(
      gated.id,
      { when: "quest.open", whenDenied: "The study is shut." },
      { by: "alice" },
    );

    const owner = await app.request(`/live/events?scene=${gated.id}`, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${tokens.alice}`,
      },
    });
    expect(owner.status).toBe(200);
    await owner.body?.cancel();

    const reader = await app.request(`/live/events?scene=${gated.id}`, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${tokens.bob}`,
      },
    });
    expect(reader.status).toBe(403);
    expect(await reader.json()).toEqual({ error: "Forbidden" });
  });

  it("SSE /live/events disables proxy buffering and streams a snapshot", async () => {
    const res = await app.request(`/live/events?scene=${sceneIds.public}`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("cache-control")).toMatch(/no-transform/);

    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !buf.includes("presence.snapshot")) {
      const { value, done } = await reader!.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await reader!.cancel();
    expect(buf.startsWith(`:${" ".repeat(SSE_CONNECT_PADDING_BYTES)}\n\n`)).toBe(true);
    expect(buf).toContain("event: presence.snapshot");
    expect(buf).toContain(`"sceneId":${sceneIds.public}`);
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

  it("artefact HTML keeps liveSceneId at the home scene when not elsewhere", async () => {
    const art = await world.createArtefact({
      owner: "alice",
      homeSceneId: sceneIds.public,
      title: "Lamp",
      body: "Glows.",
    });
    const res = await app.request(`/a/${art.id}`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
  });

  it("examining an artefact keeps Live at lastSceneId and links back", async () => {
    const other = await world.createScene({
      owner: "alice",
      title: "Elsewhere",
      body: "Not the artefact's home.",
      visibility: "public",
    });
    const art = await world.createArtefact({
      owner: "alice",
      homeSceneId: sceneIds.public,
      title: "Pocket stone",
      body: "Smooth.",
    });
    await world.collectArtefact("alice", art.id);

    const visit = await app.request(`/s/${other.id}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(visit.status).toBe(200);
    expect(world.getUser("alice")?.lastSceneId).toBe(other.id);

    const res = await app.request(`/a/${art.id}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(world.getUser("alice")?.lastSceneId).toBe(other.id);
    expect(html).toContain(`"liveSceneId":${other.id}`);
    expect(html).toContain(`href="s/${other.id}"`);
    expect(html).toContain(`← Scene ${other.id}`);
    expect(html).not.toContain(`href="s/${sceneIds.public}?from=${sceneIds.public}"`);
  });

  it("inventory keeps Live at lastSceneId and links back", async () => {
    const visit = await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(visit.status).toBe(200);
    expect(world.getUser("alice")?.lastSceneId).toBe(sceneIds.public);

    const res = await app.request("/inv", {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
    expect(html).toContain(`href="s/${sceneIds.public}"`);
    expect(html).toContain(`← Scene ${sceneIds.public}`);
    expect(html).not.toContain('data-nav="back"');
  });

  it("inventory without lastSceneId offers a history back crumb", async () => {
    const res = await app.request("/inv", {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.bob}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('"liveSceneId"');
    expect(html).toContain('data-nav="back"');
    expect(html).toContain("← Back");
  });

  it("profile keeps Live at lastSceneId and links back", async () => {
    const visit = await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(visit.status).toBe(200);

    const res = await app.request("/profile", {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
    expect(html).toContain(`href="s/${sceneIds.public}"`);
    expect(html).toContain(`← Scene ${sceneIds.public}`);
    expect(html).not.toContain('data-nav="back"');
  });

  it("groups keeps Live at lastSceneId and links back", async () => {
    await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    const res = await app.request("/g", {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
    expect(html).toContain(`← Scene ${sceneIds.public}`);
  });

  it("staff keeps Live at lastSceneId and links back", async () => {
    await world.setStaffRoles("alice", ["manager"]);
    await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    const res = await app.request("/staff", {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
    expect(html).toContain(`← Scene ${sceneIds.public}`);
  });

  it("admin keeps Live at lastSceneId and links back", async () => {
    await world.setStaffRoles("alice", ["manager"]);
    await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    const res = await app.request("/data", {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
    expect(html).toContain(`← Scene ${sceneIds.public}`);
    expect(html).toContain('"isModerator":true');
  });

  it("live admin keeps Live at lastSceneId and links back", async () => {
    await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.mod}` },
    });
    const res = await app.request("/live/admin", {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.mod}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`"liveSceneId":${sceneIds.public}`);
    expect(html).toContain(`← Scene ${sceneIds.public}`);
  });

  it("idle sweep drops connections that have not heartbeated", () => {
    vi.useFakeTimers();
    const conn = presence.connect({
      userKey: "g:aaaaaaaaaaaaaaaa",
      displayName: "guest-aaaaaa",
      sceneId: sceneIds.public,
    });
    vi.advanceTimersByTime(PRESENCE_IDLE_MS + 1);
    presence.sweepIdle();
    expect(presence.getConnection(conn.connectionId)).toBeUndefined();
    vi.advanceTimersByTime(PRESENCE_RECONNECT_GRACE_MS);
    expect(presence.here(sceneIds.public).some((p) => p.userKey === "g:aaaaaaaaaaaaaaaa")).toBe(
      false,
    );
  });

  it("client heartbeat keeps a connection past idle", () => {
    vi.useFakeTimers();
    const conn = presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    vi.advanceTimersByTime(PRESENCE_IDLE_MS - 1000);
    expect(presence.heartbeatUser("u:alice")).toBe(true);
    vi.advanceTimersByTime(PRESENCE_IDLE_MS - 1000);
    presence.sweepIdle();
    expect(presence.getConnection(conn.connectionId)).toBeDefined();
  });

  it("kick drops presence immediately without reconnect grace", () => {
    vi.useFakeTimers();
    const leaves: string[] = [];
    presence.onEvent((e) => {
      if (e.kind === "presence.leave" && e.person) leaves.push(e.person.userKey);
    });
    presence.connect({
      userKey: "g:aaaaaaaaaaaaaaaa",
      displayName: "guest-aaaaaa",
      sceneId: sceneIds.public,
    });
    expect(presence.kick("g:aaaaaaaaaaaaaaaa")).toBe(true);
    expect(leaves).toEqual(["g:aaaaaaaaaaaaaaaa"]);
    expect(presence.here(sceneIds.public)).toEqual([]);
    vi.advanceTimersByTime(PRESENCE_RECONNECT_GRACE_MS);
    expect(leaves).toEqual(["g:aaaaaaaaaaaaaaaa"]);
  });

  it("login clears the guest cookie and kicks leftover guest presence", async () => {
    presence.connect({
      userKey: "g:aaaaaaaaaaaaaaaa",
      displayName: "guest-aaaaaa",
      sceneId: sceneIds.public,
    });
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: "proseden_guest=aaaaaaaaaaaaaaaa",
      },
      body: JSON.stringify({ username: "alice", password: "secret1" }),
    });
    expect(res.status).toBe(200);
    expect(presence.findByUserKey("g:aaaaaaaaaaaaaaaa")).toBeUndefined();
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => /proseden_guest=/i.test(c) && /max-age=0/i.test(c))).toBe(true);
  });

  it("failed login does not kick guest presence", async () => {
    presence.connect({
      userKey: "g:aaaaaaaaaaaaaaaa",
      displayName: "guest-aaaaaa",
      sceneId: sceneIds.public,
    });
    const res = await app.request("/auth/login", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: "proseden_guest=aaaaaaaaaaaaaaaa",
      },
      body: JSON.stringify({ username: "alice", password: "wrong-password" }),
    });
    expect(res.status).toBe(401);
    expect(presence.findByUserKey("g:aaaaaaaaaaaaaaaa")?.displayName).toBe("guest-aaaaaa");
  });

  it("register kicks leftover guest presence", async () => {
    presence.connect({
      userKey: "g:bbbbbbbbbbbbbbbb",
      displayName: "guest-bbbbbb",
      sceneId: sceneIds.public,
    });
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Cookie: "proseden_guest=bbbbbbbbbbbbbbbb",
      },
      body: JSON.stringify({ username: "carol", password: "secret1" }),
    });
    expect(res.status).toBe(201);
    expect(presence.findByUserKey("g:bbbbbbbbbbbbbbbb")).toBeUndefined();
  });

  it("logout kicks signed-in presence and posts logged out", async () => {
    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    // Separate connection so linger cancel does not drop the logout line.
    presence.connect({
      userKey: "u:bob",
      displayName: "bob",
      sceneId: sceneIds.public,
    });
    hub.say({
      sceneId: sceneIds.public,
      fromKey: "u:bob",
      fromName: "bob",
      text: "bye",
    });

    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokens.alice}`,
      },
    });
    expect(res.status).toBe(200);
    expect(presence.findByUserKey("u:alice")).toBeUndefined();
    const logoutLine = hub.snapshot(sceneIds.public).messages.find((m) => m.systemKind === "logout");
    expect(logoutLine?.text).toBe("alice logged out.");
  });

  it("POST /live/ping requires presence then heartbeats", async () => {
    const headers = {
      Authorization: `Bearer ${tokens.alice}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    const missing = await app.request("/live/ping", { method: "POST", headers, body: "{}" });
    expect(missing.status).toBe(400);

    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    const ok = await app.request("/live/ping", { method: "POST", headers, body: "{}" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
  });

  it("moderator can kick a live guest", async () => {
    presence.connect({
      userKey: "g:aaaaaaaaaaaaaaaa",
      displayName: "guest-aaaaaa",
      sceneId: sceneIds.public,
    });
    const denied = await app.request("/live/admin/kick", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ userKey: "g:aaaaaaaaaaaaaaaa" }),
    });
    expect(denied.status).toBe(403);

    const html = await app.request("/live/admin", {
      headers: { Authorization: `Bearer ${tokens.mod}`, Accept: "text/html" },
    });
    expect(await html.text()).toContain('action="live/admin/kick"');

    const kicked = await app.request("/live/admin/kick", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mod}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ userKey: "g:aaaaaaaaaaaaaaaa" }),
    });
    expect(kicked.status).toBe(200);
    expect(await kicked.json()).toEqual({ ok: true, userKey: "g:aaaaaaaaaaaaaaaa" });
    expect(presence.findByUserKey("g:aaaaaaaaaaaaaaaa")).toBeUndefined();
  });

  it("names guest cookies from the session cookie", () => {
    expect(guestCookieName("proseden_session")).toBe("proseden_guest");
    expect(guestCookieName("proseden_garden_session")).toBe("proseden_garden_guest");
  });

  it("manager can toggle guest live and live chat from live admin", async () => {
    const modAdmin = await app.request("/live/admin", {
      headers: { Authorization: `Bearer ${tokens.mod}`, Accept: "text/html" },
    });
    expect(await modAdmin.text()).not.toContain("Disable guest live");

    const mgrAdmin = await app.request("/live/admin", {
      headers: { Authorization: `Bearer ${tokens.mgr}`, Accept: "application/json" },
    });
    expect(mgrAdmin.status).toBe(200);
    expect(await mgrAdmin.json()).toMatchObject({
      guestLiveEnabled: true,
      liveChatEnabled: true,
    });

    const offGuest = await app.request("/live/admin/guest-live", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mgr}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(offGuest.status).toBe(200);
    expect(await offGuest.json()).toMatchObject({ ok: true, guestLiveEnabled: false });

    const modDenied = await app.request("/live/admin/guest-live", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mod}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: true }),
    });
    expect(modDenied.status).toBe(403);

    const guestEvents = await app.request(`/live/events?scene=${sceneIds.public}`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(guestEvents.status).toBe(403);

    const offChat = await app.request("/live/admin/live-chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mgr}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(offChat.status).toBe(200);
    expect(await offChat.json()).toMatchObject({ ok: true, liveChatEnabled: false });

    presence.connect({
      userKey: "u:alice",
      displayName: "alice",
      sceneId: sceneIds.public,
    });
    const say = await app.request("/live/say", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: "blocked" }),
    });
    expect(say.status).toBe(403);
    expect(await say.json()).toMatchObject({ error: "Live chat is disabled." });
  });

  it("scene HTML omits guest live when disabled", async () => {
    await world.setGuestLiveEnabled(false);
    const res = await app.request(`/s/${sceneIds.public}`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain('"allowGuestLive":false');
    expect(html).toContain('"liveChatEnabled":true');
  });
});
