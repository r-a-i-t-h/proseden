import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import {
  exportAdventurePack,
  importAdventurePack,
  PackRemapError,
} from "../src/store/adventure-pack.js";
import { WorldStore } from "../src/store/world.js";

describe("adventure pack export/import", () => {
  let sourceDir: string;
  let hostDir: string;
  let source: WorldStore;
  let host: WorldStore;

  beforeEach(async () => {
    sourceDir = await mkdtemp(join(tmpdir(), "proseden-pack-src-"));
    hostDir = await mkdtemp(join(tmpdir(), "proseden-pack-host-"));
    source = new WorldStore(sourceDir);
    await source.load();
    host = new WorldStore(hostDir);
    await host.load();

    const password = await hashPassword("secret1");
    await source.createUser("alice", password.hash, password.salt);
    await host.createUser("alice", password.hash, password.salt);
    await host.createUser("bob", password.hash, password.salt);
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(hostDir, { recursive: true, force: true });
  });

  async function buildSourceAdventure(): Promise<{
    sceneA: number;
    sceneB: number;
    keyId: number;
    doorId: number;
    tonicId: number;
  }> {
    const a = await source.createScene({
      owner: "alice",
      title: "Cave mouth",
      body: "Dark.",
      visibility: "public",
    });
    const b = await source.createScene({
      owner: "alice",
      title: "Inner chamber",
      body: "Cooler.",
      visibility: "public",
    });
    // Hole: create and delete a scene so next ids are sparse-ish relative to content.
    const hole = await source.createScene({
      owner: "alice",
      title: "Hole",
      body: "Gone.",
      visibility: "private",
    });
    await source.deleteScene(hole.id);

    const key = await source.createArtefact({
      owner: "alice",
      homeSceneId: a.id,
      title: "Iron key",
      body: "Cold.",
      tags: ["key"],
    });
    const door = await source.createArtefact({
      owner: "alice",
      homeSceneId: b.id,
      title: "Locked door",
      body: "Oak.",
    });
    const tonic = await source.createArtefact({
      owner: "alice",
      homeSceneId: b.id,
      title: "Tonic",
      body: "Clear.",
    });

    await source.addExit(a.id, "inward", b.id, { when: `holds:${key.id}` });
    await source.updateScene(b.id, { when: `holds:${key.id}` });

    await source.saveQuest({
      name: "cave",
      title: "Cave",
      rules: [
        {
          id: "entered",
          when: { all: [{ atScene: b.id }, { holds: key.id }] },
          then: [{ setFlag: "cave.deep" }, { grantBadge: "cave.explorer" }],
        },
      ],
      badges: [{ id: "cave.explorer", title: "Explorer" }],
      alchemy: [{ id: "brew", inputs: [key.id, door.id], gives: tonic.id, ok: "Brewed." }],
    });

    return { sceneA: a.id, sceneB: b.id, keyId: key.id, doorId: door.id, tonicId: tonic.id };
  }

  it("densifies on export and offsets on import with quest rename", async () => {
    const built = await buildSourceAdventure();
    expect(built.sceneA).toBeGreaterThan(0);
    // Source has a hole from deleted scene → scene B id > 2 likely
    expect(built.sceneB).toBeGreaterThan(built.sceneA);

    const first = await exportAdventurePack(source, { title: "Cave quest" });
    expect(first.manifest.scenes).toBe(2);
    expect(first.manifest.artefacts).toBe(3);
    expect(first.manifest.quests).toEqual(["cave"]);
    expect(first.manifest.alchemyRecipes).toBe(0);

    await source.saveAlchemyRecipes([
      {
        id: "master-brew",
        inputs: [built.keyId, built.doorId],
        gives: built.tonicId,
      },
    ]);
    const { buffer, manifest } = await exportAdventurePack(source, { title: "Cave quest" });
    expect(manifest.alchemyRecipes).toBe(1);
    expect(manifest.quests).toEqual(["cave"]);

    // Host already has a conflicting quest name and some content.
    const hostHall = await host.createScene({
      owner: "bob",
      title: "Hall",
      body: "Busy.",
      visibility: "public",
    });
    await host.saveQuest({
      name: "cave",
      rules: [{ id: "x", when: { scenesOwned: 1 }, then: [{ setFlag: "cave.busy" }] }],
    });
    const beforeNextScene = host.meta.nextSceneId;
    const beforeNextArt = host.meta.nextArtefactId;

    const result = await importAdventurePack(host, buffer, { owner: "bob" });
    expect(result.questRenames).toEqual({ cave: "cave_2" });
    expect(result.questNames).toEqual(["cave_2"]);
    expect(result.sceneIds).toEqual([beforeNextScene, beforeNextScene + 1]);
    expect(result.artefactIds[0]).toBe(beforeNextArt);

    const importedA = host.getScene(result.sceneIds[0]!);
    const importedB = host.getScene(result.sceneIds[1]!);
    expect(importedA?.title).toBe("Cave mouth");
    expect(importedA?.owner).toBe("bob");
    expect(importedB?.owner).toBe("bob");

    const key = host.getArtefact(result.artefactIds[0]!);
    const tonic = host.getArtefact(result.artefactIds[2]!);
    expect(key?.title).toBe("Iron key");
    expect(importedB?.when).toBe(`holds:${key!.id}`);

    const exits = host.exits.get(importedA!.id) ?? [];
    expect(exits[0]?.toSceneId).toBe(importedB!.id);
    expect(exits[0]?.when).toBe(`holds:${key!.id}`);

    const quest = host.getMasterQuest("cave_2");
    expect(quest?.rules[0]?.when).toEqual({
      all: [{ atScene: importedB!.id }, { holds: key!.id }],
    });
    expect(quest?.rules[0]?.then).toEqual([
      { setFlag: "cave_2.deep" },
      { grantBadge: "cave_2.explorer" },
    ]);
    expect(quest?.badges?.[0]?.id).toBe("cave_2.explorer");
    expect(quest?.alchemy?.[0]?.gives).toBe(tonic!.id);

    expect(host.alchemyRecipes.some((r) => r.id === "cave_2/brew")).toBe(true);
    expect(host.masterAlchemyRecipes.some((r) => r.id === "master-brew")).toBe(true);

    // Original host content intact
    expect(host.getScene(hostHall.id)?.title).toBe("Hall");
    expect(host.getMasterQuest("cave")?.name).toBe("cave");
  });

  it("rejects import when auto-rename is disabled and names collide", async () => {
    await buildSourceAdventure();
    const { buffer } = await exportAdventurePack(source);
    await host.saveQuest({ name: "cave", rules: [] });
    await expect(
      importAdventurePack(host, buffer, { autoRenameQuests: false }),
    ).rejects.toThrow(/Quest name conflict/);
  });

  it("rejects a non-pack archive", async () => {
    const junk = join(hostDir, "junk.tar.gz");
    // Minimal invalid gzip-ish file — extract will fail or miss pack.json
    await writeFile(junk, "not a tar", "utf8");
    await expect(importAdventurePack(host, junk)).rejects.toThrow();
  });

  it("round-trips combine via quest alchemy after import", async () => {
    await buildSourceAdventure();
    const { buffer } = await exportAdventurePack(source);
    const result = await importAdventurePack(host, buffer, { owner: "alice" });
    const [keyId, doorId, tonicId] = result.artefactIds;
    await host.collectArtefact("alice", keyId!);
    await host.collectArtefact("alice", doorId!);

    const { matchAlchemyRecipe } = await import("../src/logic/quests.js");
    const tags = new Map<number, readonly string[]>();
    for (const id of [keyId!, doorId!, tonicId!]) {
      tags.set(id, host.getArtefact(id)?.tags ?? []);
    }
    const recipe = matchAlchemyRecipe(host.alchemyRecipes, [keyId!, doorId!], tags);
    expect(recipe?.id).toBe("cave/brew");
    expect(recipe?.gives).toBe(tonicId);
  });

  it("fails export of a world with no scenes", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "proseden-pack-empty-"));
    try {
      const empty = new WorldStore(emptyDir);
      await empty.load();
      await expect(exportAdventurePack(empty)).rejects.toThrow(PackRemapError);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});
