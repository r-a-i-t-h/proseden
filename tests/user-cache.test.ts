import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { WorldStore } from "../src/store/world.js";

function recount(world: WorldStore, username: string): number {
  return [...world.scenes.values()].filter((s) => s.owner === username).length;
}

describe("user.cache.scenesOwned", () => {
  let dataDir: string;
  let world: WorldStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-user-cache-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("fills on first get and matches a full-map recount", async () => {
    await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "One.",
      visibility: "public",
    });
    await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Two.",
      visibility: "private",
    });
    await world.createScene({
      owner: "bob",
      title: "Shed",
      body: "Bob's.",
      visibility: "private",
    });

    expect(world.getUser("alice")?.cache?.scenesOwned).toBeUndefined();
    expect(world.scenesOwned("alice")).toBe(3);
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(3);
    expect(world.scenesOwned("alice")).toBe(recount(world, "alice"));
    expect(world.predContextFor("alice").scenesOwned).toBe(3);
  });

  it("bumps after a first get on create and delete", async () => {
    const hall = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Entrance.",
      visibility: "public",
    });
    expect(world.scenesOwned("alice")).toBe(2);

    const study = await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Quiet.",
      visibility: "private",
    });
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(3);

    await world.deleteScene(study.id);
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(2);
    expect(world.scenesOwned("alice")).toBe(recount(world, "alice"));
    expect(world.isUserHomeScene(hall.id)).toBe(false);
  });

  it("does not insert a cache entry for a never-asked owner", async () => {
    await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "One.",
      visibility: "public",
    });
    expect(world.getUser("alice")?.cache?.scenesOwned).toBeUndefined();
    expect(world.getUser("bob")?.cache).toBeUndefined();

    await world.createScene({
      owner: "bob",
      title: "Shed",
      body: "Tools.",
      visibility: "private",
    });
    expect(world.getUser("bob")?.cache?.scenesOwned).toBeUndefined();
    expect(world.scenesOwned("bob")).toBe(2);
    expect(world.getUser("bob")?.cache?.scenesOwned).toBe(2);
  });

  it("bumps from a cached zero when that user later creates a scene", async () => {
    expect(world.scenesOwned("bob")).toBe(1);
    expect(world.getUser("bob")?.cache?.scenesOwned).toBe(1);
    await world.createScene({
      owner: "bob",
      title: "Shed",
      body: "Tools.",
      visibility: "private",
    });
    expect(world.getUser("bob")?.cache?.scenesOwned).toBe(2);
  });

  it("moves a cached count on transfer and leaves an uncached recipient unset", async () => {
    const hall = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Entrance.",
      visibility: "public",
    });
    const study = await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Quiet.",
      visibility: "private",
    });
    expect(world.scenesOwned("alice")).toBe(3);
    expect(world.getUser("bob")?.cache?.scenesOwned).toBeUndefined();

    await world.transferSceneOwner(study.id, "bob");
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(2);
    expect(world.getUser("bob")?.cache?.scenesOwned).toBeUndefined();
    expect(world.scenesOwned("bob")).toBe(2);
    expect(world.getUser("bob")?.cache?.scenesOwned).toBe(2);

    expect(world.scenesOwned("alice")).toBe(2);
    await world.transferSceneOwner(study.id, "alice");
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(3);
    expect(world.getUser("bob")?.cache?.scenesOwned).toBe(1);
    expect(hall.owner).toBe("alice");
  });

  it("ignores ACL grants when counting and when bumping", async () => {
    await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Alice's.",
      visibility: "public",
    });
    const bobScene = await world.createScene({
      owner: "bob",
      title: "Shed",
      body: "Bob's.",
      visibility: "private",
    });
    expect(world.scenesOwned("alice")).toBe(2);

    await world.updateSceneAccess(bobScene.id, {
      grants: [{ who: "alice", rights: ["read", "edit", "manage"] }],
    });
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(2);
    expect(world.scenesOwned("alice")).toBe(2);
    expect(world.scenesOwned("alice")).toBe(recount(world, "alice"));
  });

  it("omits cache from disk and keeps it across saveUser", async () => {
    await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "One.",
      visibility: "public",
    });
    expect(world.scenesOwned("alice")).toBe(2);

    const alice = world.getUser("alice")!;
    await world.saveUser({ ...alice, lastSeenAt: "2026-01-02T03:04:05.000Z" });
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(2);
    expect(world.getUser("alice")?.lastSeenAt).toBe("2026-01-02T03:04:05.000Z");

    const raw = JSON.parse(
      await readFile(join(dataDir, "users", "alice.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(raw).not.toHaveProperty("cache");
  });

  it("drops cache on reload and recounts on next get", async () => {
    await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "One.",
      visibility: "public",
    });
    await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Two.",
      visibility: "private",
    });
    expect(world.scenesOwned("alice")).toBe(3);

    await world.reload();
    expect(world.getUser("alice")?.cache).toBeUndefined();
    expect(world.scenesOwned("alice")).toBe(3);
    expect(world.getUser("alice")?.cache?.scenesOwned).toBe(3);
  });
});
