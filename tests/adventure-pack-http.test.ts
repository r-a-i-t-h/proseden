import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("admin adventure packs", () => {
  let dataDir: string;
  let world: WorldStore;
  let app: ReturnType<typeof createApp>;
  let managerToken: string;
  let userToken: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-pack-http-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    await world.setStaffRoles("alice", ["manager"]);
    await world.createScene({
      owner: "alice",
      title: "Grove",
      body: "Trees.",
      visibility: "public",
    });
    const sessions = new SessionStore();
    managerToken = sessions.create("alice").token;
    userToken = sessions.create("bob").token;
    app = createApp({ world, sessions, backupDir: join(dataDir, "..", "backup") });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lets managers export and import packs over HTTP", async () => {
    const denied = await app.request("/data/pack/export", {
      headers: { Authorization: `Bearer ${userToken}`, Accept: "application/json" },
    });
    expect(denied.status).toBe(403);

    const exported = await app.request("/data/pack/export", {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toContain("gzip");
    const bytes = Buffer.from(await exported.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(20);

    const hostDir = await mkdtemp(join(tmpdir(), "proseden-pack-host-http-"));
    try {
      const host = new WorldStore(hostDir);
      await host.load();
      const password = await hashPassword("secret1");
      await host.createUser("alice", password.hash, password.salt);
      await host.setStaffRoles("alice", ["manager"]);
      const sessions = new SessionStore();
      const token = sessions.create("alice").token;
      const hostApp = createApp({ world: host, sessions });

      const imported = await hostApp.request("/data/pack/import", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ archiveBase64: bytes.toString("base64"), owner: "alice" }),
      });
      expect(imported.status).toBe(200);
      const body = (await imported.json()) as { ok: boolean; sceneIds: number[] };
      expect(body.ok).toBe(true);
      expect(body.sceneIds.length).toBe(1);
      expect(host.getScene(body.sceneIds[0]!)?.title).toBe("Grove");
    } finally {
      await rm(hostDir, { recursive: true, force: true });
    }
  });
});
