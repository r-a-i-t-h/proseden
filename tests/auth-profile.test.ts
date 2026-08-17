import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("profile and password change", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-profile-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    sessions = new SessionStore();
    token = sessions.create("alice").token;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ world, sessions });
  }

  function auth(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  it("requires login to view the profile", async () => {
    const res = await app().request("/profile", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Log in to view your profile");
  });

  it("shows a password form to signed-in users and never leaks hashes", async () => {
    const res = await app().request("/profile", {
      headers: { Accept: "text/html", ...auth() },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<summary>Appearance</summary>");
    expect(html).toContain("<summary>Password</summary>");
    expect(html).toContain("<summary>Sharing</summary>");
    expect(html).toContain('action="profile"');
    expect(html).toContain('name="description"');
    expect(html).toContain('name="detailsJson"');
    expect(html).toContain('data-json-kind="details"');
    expect(html).toContain('data-json-kind="grants"');
    expect(html).toContain('data-json-kind="denies"');
    expect(html).toContain('action="auth/password"');
    expect(html).toContain('action="u/alice/access"');
    expect(html).toContain('href="profile"');
    expect(html).not.toContain("passwordHash");
    expect(html).not.toContain("passwordSalt");
    expect(html).toMatch(/<details class="profile-section" open>\s*<summary>Appearance<\/summary>/);
    expect(html).not.toMatch(/<details class="profile-section" open>\s*<summary>Password<\/summary>/);
    expect(html).not.toMatch(/<details class="profile-section" open>\s*<summary>Sharing<\/summary>/);
  });

  it("changes the password and keeps the current session", async () => {
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const stillIn = await app().request("/profile", {
      headers: { Accept: "application/json", ...auth() },
    });
    expect(stillIn.status).toBe(200);

    const oldLogin = await app().request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret1" }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await app().request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret2" }),
    });
    expect(newLogin.status).toBe(200);
  });

  it("invalidates other sessions for that user", async () => {
    const other = sessions.create("alice").token;
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
    });
    expect(res.status).toBe(200);

    const kicked = await app().request("/profile", {
      headers: { Authorization: `Bearer ${other}`, Accept: "text/html" },
    });
    expect(kicked.status).toBe(401);
  });

  it("rejects a wrong current password", async () => {
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "nope",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Current password is incorrect." });
  });

  it("rejects a confirmation mismatch and a short password", async () => {
    const mismatch = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret3",
      }),
    });
    expect(mismatch.status).toBe(400);

    const short = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "ab",
        confirmPassword: "ab",
      }),
    });
    expect(short.status).toBe(400);
  });

  it("saves share-all from the profile form and redirects back", async () => {
    const res = await app().request("/u/alice/access", {
      method: "POST",
      headers: auth({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({
        grantsJson: JSON.stringify([{ who: "bob", rights: ["read"] }]),
        deniesJson: "[]",
      }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/profile?shared=1");
    expect(world.getUser("alice")?.grants).toEqual([{ who: "bob", rights: ["read"] }]);

    const page = await app().request("/profile?shared=1", {
      headers: { Accept: "text/html", ...auth() },
    });
    const html = await page.text();
    expect(html).toContain("Share-all saved.");
    expect(html).toMatch(/<details class="profile-section" open>\s*<summary>Sharing<\/summary>/);
  });

  it("redirects HTML password changes back to the profile", async () => {
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/profile?updated=1");

    const page = await app().request("/profile?updated=1", {
      headers: { Accept: "text/html", ...auth() },
    });
    const html = await page.text();
    expect(html).toContain("Password updated.");
    expect(html).toMatch(/<details class="profile-section" open>\s*<summary>Password<\/summary>/);
  });

  it("saves appearance from the profile form and redirects back", async () => {
    const res = await app().request("/profile", {
      method: "POST",
      headers: auth({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({
        description: "A keeper of quiet gardens.",
        detailsJson: JSON.stringify({ hands: "Soil under the nails." }),
      }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/profile?appearance=1");
    expect(world.getUser("alice")?.description).toBe("A keeper of quiet gardens.");
    expect(world.getUser("alice")?.details).toEqual({ hands: "Soil under the nails." });

    const page = await app().request("/profile?appearance=1", {
      headers: { Accept: "text/html", ...auth() },
    });
    const html = await page.text();
    expect(html).toContain("Appearance saved.");
    expect(html).toContain("A keeper of quiet gardens.");
    expect(html).toContain("Soil under the nails.");
    expect(html).toMatch(/<details class="profile-section" open>\s*<summary>Appearance<\/summary>/);
    expect(html).not.toContain("passwordHash");
  });

  it("saves appearance via JSON without leaking credentials", async () => {
    const res = await app().request("/profile", {
      method: "PUT",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        description: "Soft-spoken.",
        details: { coat: "Patched at the elbow." },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      description: "Soft-spoken.",
      details: { coat: "Patched at the elbow." },
    });
  });

  it("rejects invalid appearance details JSON", async () => {
    const res = await app().request("/profile", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ detailsJson: "{not-json" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Details must be a JSON object" });
  });

  it("requires login to update appearance", async () => {
    const res = await app().request("/profile", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ description: "nope" }),
    });
    expect(res.status).toBe(401);
  });

  it("lets anyone view a user's public profile without leaking secrets", async () => {
    await world.updateUserAppearance("alice", {
      description: "A keeper of quiet gardens.",
      details: { hands: "Soil under the nails." },
    });

    const res = await app().request("/u/alice", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>alice</h1>");
    expect(html).toContain("0 scenes · 0 artefacts");
    expect(html).toContain("A keeper of quiet gardens.");
    expect(html).toContain('href="u/alice?hands"');
    expect(html).toContain(">hands</a>");
    expect(html).not.toContain("passwordHash");
    expect(html).not.toContain("passwordSalt");
    expect(html).not.toContain("Change password");
    expect(html).not.toContain("<summary>Password</summary>");
    expect(html).not.toContain("<summary>Sharing</summary>");
    expect(html).toContain("← Back");
    expect(html).toContain('data-nav="back"');
  });

  it("shows directly owned scene and artefact counts and last seen", async () => {
    const scene = await world.createScene({
      owner: "alice",
      title: "Garden",
      body: "Quiet.",
      visibility: "public",
    });
    await world.createArtefact({
      owner: "alice",
      homeSceneId: scene.id,
      title: "Trowel",
      body: "Worn.",
    });
    await world.createArtefact({
      owner: "alice",
      homeSceneId: scene.id,
      title: "Seed packet",
      body: "Empty.",
    });
    // Bob owns a scene alice can access via grant — must not count toward alice.
    const password = await hashPassword("secret1");
    await world.createUser("bob", password.hash, password.salt);
    const bobScene = await world.createScene({
      owner: "bob",
      title: "Bob's shed",
      body: "Tools.",
      visibility: "private",
    });
    await world.updateSceneAccess(bobScene.id, {
      grants: [{ who: "alice", rights: ["read", "edit"] }],
    });
    await world.createArtefact({
      owner: "bob",
      homeSceneId: bobScene.id,
      title: "Bob's rake",
      body: "Not alice's.",
    });

    const alice = world.getUser("alice")!;
    await world.saveUser({
      ...alice,
      lastSeenAt: new Date(Date.now() - 90_000).toISOString(),
    });

    const res = await app().request("/u/alice", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("1 scene · 2 artefacts · last seen ");
    expect(html).toMatch(/last seen <time datetime="[^"]+" title="[^"]+">1m ago<\/time>/);
    expect(html).not.toContain("Bob's rake");
  });

  it("shows a named user detail", async () => {
    await world.updateUserAppearance("alice", {
      description: "A keeper of quiet gardens.",
      details: { hands: "Soil under the nails." },
    });
    const res = await app().request("/u/alice?hands", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("detail: hands");
    expect(html).toContain("Soil under the nails.");
    expect(html).toContain('href="u/alice"');
    expect(html).not.toContain("A keeper of quiet gardens.");
  });

  it("returns a public JSON profile without credentials", async () => {
    await world.updateUserAppearance("alice", {
      description: "Soft-spoken.",
      details: { coat: "Patched at the elbow." },
    });
    const scene = await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Quiet.",
      visibility: "public",
    });
    await world.createArtefact({
      owner: "alice",
      homeSceneId: scene.id,
      body: "A pen.",
    });
    const alice = world.getUser("alice")!;
    const lastSeenAt = "2026-01-02T03:04:05.000Z";
    await world.saveUser({ ...alice, lastSeenAt });

    const res = await app().request("/u/alice", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      username: "alice",
      description: "Soft-spoken.",
      details: { coat: "Patched at the elbow." },
      ownedScenes: 1,
      ownedArtefacts: 1,
      badges: [],
      lastSeenAt,
    });
  });

  it("shows badge grantTime and unknown when missing", async () => {
    await world.saveQuest({
      name: "demo",
      rules: [],
      badges: [{ id: "demo.winner", title: "Winner" }],
    });
    await world.saveUserBadges("alice", [
      { badge: "demo.winner", grantTime: "2026-01-02T03:04:05.000Z" },
      { badge: "demo.bare" },
    ]);

    const json = await app().request("/u/alice", {
      headers: { Accept: "application/json" },
    });
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({
      badges: [
        { id: "demo.winner", title: "Winner", grantTime: "2026-01-02T03:04:05.000Z" },
        { id: "demo.bare", title: "demo.bare", grantTime: null },
      ],
    });

    const html = await (await app().request("/u/alice", { headers: { Accept: "text/html" } })).text();
    expect(html).toContain("Winner");
    expect(html).toContain("unknown");
    expect(html).toMatch(/<time datetime="2026-01-02T03:04:05\.000Z"/);

    const own = await app().request("/profile", {
      headers: { Accept: "text/html", ...auth() },
    });
    expect(own.status).toBe(200);
    const ownHtml = await own.text();
    expect(ownHtml).toContain("Winner (demo.winner) · ");
    expect(ownHtml).toContain("demo.bare (demo.bare) · unknown");
  });

  it("returns 404 for an unknown user", async () => {
    const res = await app().request("/u/nobody", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(404);
  });

  it("does not move the viewer when opening a user profile", async () => {
    const scene = await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Quiet.",
      visibility: "public",
    });
    await app().request(`/s/${scene.id}`, {
      headers: { Accept: "text/html", ...auth() },
    });
    expect(world.getUser("alice")?.lastSceneId).toBe(scene.id);

    const res = await app().request("/u/alice", {
      headers: { Accept: "text/html", ...auth() },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(world.getUser("alice")?.lastSceneId).toBe(scene.id);
    expect(html).toContain(`← Scene ${scene.id}`);
    expect(html).toContain(`href="s/${scene.id}"`);
    expect(html).not.toContain('data-nav="back"');
    expect(html).toContain(`"liveSceneId":${scene.id}`);
  });
});

describe("user profile fields on disk", () => {
  let dataDir: string | undefined;

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("defaults missing description and details, then writes them on save", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-user-fields-"));
    await mkdir(join(dataDir, "users"), { recursive: true });
    await writeFile(
      join(dataDir, "meta.json"),
      JSON.stringify({ nextSceneId: 1, nextArtefactId: 1 }),
    );
    const path = join(dataDir, "users", "alice.json");
    await writeFile(
      path,
      JSON.stringify({
        username: "alice",
        passwordHash: "x",
        passwordSalt: "y",
        createdAt: "2020-01-01T00:00:00.000Z",
        inventory: [],
      }),
    );

    const world = new WorldStore(dataDir);
    await world.load();
    const loaded = world.getUser("alice");
    expect(loaded?.description).toBe("");
    expect(loaded?.details).toEqual({});

    const onDiskBefore = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(onDiskBefore).not.toHaveProperty("description");
    expect(onDiskBefore).not.toHaveProperty("details");

    await world.saveUser(loaded!);
    const onDiskAfter = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    expect(onDiskAfter.description).toBe("");
    expect(onDiskAfter.details).toEqual({});
  });
});
