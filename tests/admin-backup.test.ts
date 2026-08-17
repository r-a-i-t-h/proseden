import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore, SESSION_HANDOFF_FILE } from "../src/auth/sessions.js";
import { BACKUP_NAME_RE } from "../src/store/backup.js";
import { WorldStore } from "../src/store/world.js";

const execFileAsync = promisify(execFile);

describe("admin backups", () => {
  let instanceDir: string;
  let dataDir: string;
  let backupDir: string;
  let world: WorldStore;
  let app: ReturnType<typeof createApp>;
  let managerToken: string;
  let userToken: string;

  beforeEach(async () => {
    instanceDir = await mkdtemp(join(tmpdir(), "proseden-bak-"));
    dataDir = join(instanceDir, "data");
    backupDir = join(instanceDir, "backup");
    world = new WorldStore(dataDir);
    await world.load();

    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "A stone hall.",
      visibility: "public",
    });
    await world.setStaffRoles("alice", ["manager"]);

    const sessions = new SessionStore();
    managerToken = sessions.create("alice").token;
    userToken = sessions.create("bob").token;
    app = createApp({ world, sessions, backupDir });
  });

  afterEach(async () => {
    await rm(instanceDir, { recursive: true, force: true });
  });

  function auth(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
  }

  it("requires a manager to create or list backups", async () => {
    const anon = await app.request("/data/backup", {
      method: "POST",
      headers: { Accept: "application/json" },
    });
    expect(anon.status).toBe(401);

    const user = await app.request("/data/backup", {
      method: "POST",
      headers: auth(userToken),
    });
    expect(user.status).toBe(403);

    const list = await app.request("/data", { headers: auth(userToken) });
    expect(list.status).toBe(403);
  });

  it("creates a data-only archive and lists it", async () => {
    const created = await app.request("/data/backup", {
      method: "POST",
      headers: auth(managerToken),
    });
    expect(created.status).toBe(200);
    const body = (await created.json()) as { ok: boolean; name: string; size: number };
    expect(body.ok).toBe(true);
    expect(body.name).toMatch(BACKUP_NAME_RE);
    expect(body.size).toBeGreaterThan(0);

    const listed = await app.request("/data", { headers: auth(managerToken) });
    expect(listed.status).toBe(200);
    const index = (await listed.json()) as {
      backups: Array<{ name: string; size: number }>;
      endpoints: Array<{ method: string; path: string }>;
    };
    expect(index.backups).toEqual([expect.objectContaining({ name: body.name, size: body.size })]);
    expect(index.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/data/backup" }),
      ]),
    );

    const extract = await mkdtemp(join(tmpdir(), "proseden-x-"));
    try {
      await execFileAsync("tar", ["-tzf", join(backupDir, body.name)]);
      await execFileAsync("tar", ["-xzf", join(backupDir, body.name), "-C", extract]);
      const meta = JSON.parse(await readFile(join(extract, "meta.json"), "utf8")) as {
        nextSceneId: number;
      };
      expect(meta.nextSceneId).toBeGreaterThan(1);
      const scene = await readFile(join(extract, "scenes", "1.md"), "utf8");
      expect(scene).toContain("A stone hall.");
      await expect(readFile(join(extract, "package.json"))).rejects.toThrow();
    } finally {
      await rm(extract, { recursive: true, force: true });
    }
  });

  it("omits the session handoff file from archives", async () => {
    await writeFile(
      join(dataDir, SESSION_HANDOFF_FILE),
      JSON.stringify({ sessions: [{ tokenHash: "abc", username: "alice" }] }),
    );
    const created = await app.request("/data/backup", {
      method: "POST",
      headers: auth(managerToken),
    });
    expect(created.status).toBe(200);
    const { name } = (await created.json()) as { name: string };
    const listed = await execFileAsync("tar", ["-tzf", join(backupDir, name)]);
    expect(listed.stdout).not.toMatch(/\.sessions\.json/);
  });

  it("downloads and deletes an archive", async () => {
    const created = await app.request("/data/backup", {
      method: "POST",
      headers: auth(managerToken),
    });
    const { name } = (await created.json()) as { name: string };

    const download = await app.request(`/data/backup/${name}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toContain("gzip");
    expect(download.headers.get("content-disposition")).toContain(name);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);

    const denied = await app.request(`/data/backup/${name}`, {
      headers: auth(userToken),
    });
    expect(denied.status).toBe(403);

    const removed = await app.request(`/data/backup/${name}/delete`, {
      method: "POST",
      headers: auth(managerToken),
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true, deleted: name });

    const missing = await app.request(`/data/backup/${name}`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(missing.status).toBe(404);
  });

  it("rejects path-like backup names", async () => {
    await mkdir(backupDir, { recursive: true });
    await writeFile(join(backupDir, "nope.tar.gz"), "x");
    const res = await app.request("/data/backup/../data/meta.json", {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect([400, 404]).toContain(res.status);

    const sneaky = await app.request("/data/backup/nope.tar.gz", {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    expect(sneaky.status).toBe(400);
  });
});
