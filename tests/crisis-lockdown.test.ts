import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("crisis lockdown settings", () => {
  let dataDir: string;
  let world: WorldStore;
  let app: ReturnType<typeof createApp>;
  let tokens: Record<string, string>;
  let sceneId: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-crisis-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    for (const name of ["alice", "mgr"]) {
      await world.createUser(name, password.hash, password.salt);
    }
    await world.setStaffRoles("mgr", ["manager"]);
    const hall = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Public.",
      visibility: "public",
    });
    sceneId = hall.id;
    const sessions = new SessionStore();
    tokens = {
      alice: sessions.create("alice").token,
      mgr: sessions.create("mgr").token,
    };
    app = createApp({ world, sessions });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("blocks registration when disabled", async () => {
    await world.setRegistrationEnabled(false);
    const res = await app.request("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: "newbie", password: "secret1" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "New registrations are disabled." });
  });

  it("hides register form when registration is disabled", async () => {
    await world.setRegistrationEnabled(false);
    const res = await app.request(`/s/${sceneId}`, { headers: { Accept: "text/html" } });
    const html = await res.text();
    expect(html).not.toContain('action="auth/register"');
    expect(html).toContain('"registrationEnabled":false');
  });

  it("blocks non-manager edits when editing is disabled", async () => {
    await world.setNonManagerEditingEnabled(false);
    const res = await app.request("/profile", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: "nope" }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Editing is temporarily disabled." });

    const mgr = await app.request("/profile", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mgr}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ description: "ok" }),
    });
    expect(mgr.status).toBe(200);
  });

  it("closes the site to non-managers when view is disabled", async () => {
    await world.setNonManagerViewEnabled(false);
    const closed = await app.request(`/s/${sceneId}`, { headers: { Accept: "text/html" } });
    expect(closed.status).toBe(403);
    expect(await closed.text()).toContain("Proseden is closed");

    const manager = await app.request(`/s/${sceneId}`, {
      headers: { Authorization: `Bearer ${tokens.mgr}`, Accept: "text/html" },
    });
    expect(manager.status).toBe(200);
    expect(await manager.text()).toContain("Hall");
  });

  it("manager can toggle crisis settings from live admin", async () => {
    const off = await app.request("/live/admin/registration", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.mgr}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({
      ok: true,
      registrationEnabled: false,
      nonManagerEditingEnabled: true,
      nonManagerViewEnabled: true,
    });
  });
});
