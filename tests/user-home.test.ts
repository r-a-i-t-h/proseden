import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upgradeDataDir } from "../deploy/migrations/006-user-home-scenes.mjs";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { userHomeSceneTitle } from "../src/user-home.js";
import { WorldStore } from "../src/store/world.js";

function auth(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

describe("user home scenes", () => {
  let dataDir: string;
  let world: WorldStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-user-home-"));
    world = new WorldStore(dataDir);
    await world.load();
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates a home scene on registration", async () => {
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    const alice = world.getUser("alice")!;
    expect(alice.homeSceneId).toBeDefined();
    const home = world.getScene(alice.homeSceneId!);
    expect(home?.owner).toBe("alice");
    expect(home?.title).toBe(userHomeSceneTitle("alice"));
    expect(home?.visibility).toBe("private");
  });

  it("rehomes guest artefacts when a scene is deleted", async () => {
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("carol", password.hash, password.salt);
    const carolHome = world.userHomeSceneId("carol")!;

    const scene = await world.createScene({
      owner: "alice",
      title: "Gallery",
      body: "Shared.",
      visibility: "public",
    });
    const own = await world.createArtefact({
      owner: "alice",
      homeSceneId: scene.id,
      body: "mine",
    });
    const guest = await world.createArtefact({
      owner: "carol",
      homeSceneId: scene.id,
      body: "theirs",
    });

    await world.deleteScene(scene.id);
    expect(world.getArtefact(own.id)).toBeUndefined();
    expect(world.getArtefact(guest.id)?.homeSceneId).toBe(carolHome);
  });

  it("blocks deleting a user home scene", async () => {
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    const homeId = world.userHomeSceneId("alice")!;
    await expect(world.deleteScene(homeId)).rejects.toThrow(/home scene/i);
  });

  it("ejects a guest artefact to the owner home", async () => {
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("carol", password.hash, password.salt);
    const carolHome = world.userHomeSceneId("carol")!;

    const scene = await world.createScene({
      owner: "alice",
      title: "Archive room",
      body: "Stuff.",
      visibility: "public",
    });
    await world.updateScene(scene.id, { isRepository: true }, { by: "alice" });
    const guest = await world.createArtefact({
      owner: "carol",
      homeSceneId: scene.id,
      body: "postcard",
    });

    const updated = await world.ejectArtefact(guest.id, "alice");
    expect(updated.homeSceneId).toBe(carolHome);
  });
});

describe("public repository placement", () => {
  let dataDir: string;
  let world: WorldStore;
  let app: ReturnType<typeof createApp>;
  let tokens: Record<string, string>;
  let repoId: number;
  let privateId: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-repo-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    const repo = await world.createScene({
      owner: "alice",
      title: "Town repository",
      body: "Leave things here.",
      visibility: "public",
    });
    await world.updateScene(repo.id, { isRepository: true }, { by: "alice" });
    repoId = repo.id;
    const privateScene = await world.createScene({
      owner: "alice",
      title: "Private",
      body: "No.",
      visibility: "private",
    });
    privateId = privateScene.id;
    const sessions = new SessionStore();
    tokens = { alice: sessions.create("alice").token, bob: sessions.create("bob").token };
    app = createApp({ world, sessions });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lets bob create an artefact in a public repository without scene edit", async () => {
    const res = await app.request("/a", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ homeSceneId: repoId, body: "Bob's note" }),
    });
    expect(res.status).toBe(201);
  });

  it("blocks re-home to a scene without placement rights", async () => {
    const art = await world.createArtefact({
      owner: "bob",
      homeSceneId: repoId,
      body: "note",
    });
    const denied = await app.request(`/a/${art.id}`, {
      method: "PUT",
      headers: auth(tokens.bob),
      body: JSON.stringify({ homeSceneId: privateId }),
    });
    expect(denied.status).toBe(403);
  });

  it("ejects via HTTP", async () => {
    const art = await world.createArtefact({
      owner: "bob",
      homeSceneId: repoId,
      body: "note",
    });
    const res = await app.request(`/a/${art.id}/eject`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    expect(res.status).toBe(200);
    expect(world.getArtefact(art.id)?.homeSceneId).toBe(world.userHomeSceneId("bob"));
  });
});

describe("006-user-home-scenes migration", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-mig-006-"));
    await mkdir(join(dataDir, "users"), { recursive: true });
    await writeFile(
      join(dataDir, "meta.json"),
      `${JSON.stringify({ nextSceneId: 1, nextArtefactId: 1, nextGroupId: 1, entranceSceneId: 1 }, null, 2)}\n`,
    );
    await writeFile(
      join(dataDir, "users", "alice.json"),
      `${JSON.stringify({
        username: "alice",
        passwordHash: "h",
        passwordSalt: "s",
        createdAt: "2020-01-01T00:00:00.000Z",
        inventory: [],
        description: "",
        details: {},
      }, null, 2)}\n`,
    );
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("creates a home scene per user and stamps schema 6", async () => {
    const { created } = upgradeDataDir(dataDir);
    expect(created).toBe(1);
    const meta = JSON.parse(await readFile(join(dataDir, "meta.json"), "utf8")) as {
      schemaVersion: number;
      nextSceneId: number;
    };
    expect(meta.schemaVersion).toBe(6);
    expect(meta.nextSceneId).toBe(2);
    const alice = JSON.parse(await readFile(join(dataDir, "users", "alice.json"), "utf8")) as {
      homeSceneId: number;
    };
    expect(alice.homeSceneId).toBe(1);
    expect(await readFile(join(dataDir, "scenes", "1.md"), "utf8")).toContain("alice home");
  });
});
