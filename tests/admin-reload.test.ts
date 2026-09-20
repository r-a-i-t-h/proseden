import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("admin reload", () => {
  let dataDir: string;
  let world: WorldStore;
  let app: ReturnType<typeof createApp>;
  let managerToken: string;
  let userToken: string;
  let hallId: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-admin-"));
    world = new WorldStore(dataDir);
    await world.load();

    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    const hall = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Original hall.",
      visibility: "public",
    });
    hallId = hall.id;
    await world.setStaffRoles("alice", ["manager"]);

    const sessions = new SessionStore();
    managerToken = sessions.create("alice").token;
    userToken = sessions.create("bob").token;
    app = createApp({ world, sessions, backupDir: join(dataDir, "_backups") });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function auth(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
  }

  it("requires a manager", async () => {
    const anon = await app.request("/data/reload", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(anon.status).toBe(401);

    const user = await app.request("/data/reload", {
      method: "POST",
      headers: auth(userToken),
    });
    expect(user.status).toBe(403);
  });

  it("reloads in-memory state after direct disk edits and deletes", async () => {
    expect(world.getScene(hallId)?.body).toBe("Original hall.");

    const scenePath = join(dataDir, "scenes", `${hallId}.md`);
    const raw = await readFile(scenePath, "utf8");
    await writeFile(scenePath, raw.replace("Original hall.", "Edited on disk."));

    const doomed = await world.createScene({
      owner: "alice",
      title: "Doomed",
      body: "Will be deleted on disk.",
      visibility: "public",
    });
    expect(world.getScene(doomed.id)).toBeTruthy();
    await rm(join(dataDir, "scenes", `${doomed.id}.md`));
    await rm(join(dataDir, "scenes", `${doomed.id}.exits.json`), { force: true });

    const res = await app.request("/data/reload", {
      method: "POST",
      headers: auth(managerToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; scenes: number; users: number };
    expect(body).toMatchObject({ ok: true, scenes: 3, users: 2 });

    expect(world.getScene(hallId)?.body).toBe("Edited on disk.");
    expect(world.getScene(doomed.id)).toBeUndefined();
  });

  it("lists admin endpoints for managers", async () => {
    const res = await app.request("/data", { headers: auth(managerToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      endpoints: Array<{ method: string; path: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/data/reload" }),
        expect.objectContaining({ method: "POST", path: "/data/backup" }),
      ]),
    );
  });
});
