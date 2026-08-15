import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorldStore } from "../src/store/world.js";

describe("ACL persistence / bootstrap", () => {
  let dataDir: string | undefined;

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    delete process.env.PROSEDEN_MANAGERS;
  });

  it("migrates legacy scene invites to read grants on load", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-legacy-"));
    await mkdir(join(dataDir, "scenes"), { recursive: true });
    await writeFile(
      join(dataDir, "meta.json"),
      JSON.stringify({ nextSceneId: 2, nextArtefactId: 1 }),
    );
    await writeFile(
      join(dataDir, "scenes", "1.md"),
      [
        "---",
        "id: 1",
        "owner: alice",
        "visibility: private",
        "createdAt: 2020-01-01T00:00:00.000Z",
        "modifiedAt: []",
        "invites:",
        "  - bob",
        "---",
        "",
        "Legacy room.",
        "",
      ].join("\n"),
    );

    const world = new WorldStore(dataDir);
    await world.load();
    expect(world.getScene(1)?.grants).toEqual([{ who: "bob", rights: ["read"] }]);
  });

  it("applies PROSEDEN_MANAGERS bootstrap on load", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-mgr-"));
    process.env.PROSEDEN_MANAGERS = "alice, bob";
    await mkdir(join(dataDir, "users"), { recursive: true });
    await writeFile(
      join(dataDir, "meta.json"),
      JSON.stringify({ nextSceneId: 1, nextArtefactId: 1 }),
    );
    await writeFile(
      join(dataDir, "users", "alice.json"),
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
    expect(world.rolesFor("alice")).toEqual(["manager"]);
    expect(world.rolesFor("bob")).toEqual(["manager"]);
  });

  it("migrates legacy organiser staff role to topographer on load", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-organiser-"));
    await writeFile(
      join(dataDir, "meta.json"),
      JSON.stringify({ nextSceneId: 1, nextArtefactId: 1 }),
    );
    await writeFile(
      join(dataDir, "staff.json"),
      JSON.stringify({ roles: { bob: ["organiser", "moderator"] } }),
    );

    const world = new WorldStore(dataDir);
    await world.load();
    expect(world.rolesFor("bob")).toEqual(["topographer", "moderator"]);
  });

  it("strips legacy invites when saving scene access", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-strip-"));
    const world = new WorldStore(dataDir);
    await world.load();
    await world.createUser("alice", "h", "s");
    const scene = await world.createScene({
      owner: "alice",
      title: "Room",
      body: "room",
      visibility: "private",
    });
    (scene as { invites?: string[] }).invites = ["bob"];
    world.scenes.set(scene.id, scene);

    await world.updateSceneAccess(scene.id, {
      grants: [{ who: "carol", rights: ["edit"] }],
    });
    const reloaded = new WorldStore(dataDir);
    await reloaded.load();
    const saved = reloaded.getScene(scene.id)!;
    expect(saved.grants).toEqual([{ who: "carol", rights: ["edit"] }]);
    expect((saved as { invites?: string[] }).invites).toBeUndefined();
  });
});
