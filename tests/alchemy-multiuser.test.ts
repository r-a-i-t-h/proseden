import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("multi-user alchemy", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let aliceToken: string;
  let bobToken: string;
  let aliceArt: number;
  let bobArt: number;
  let ingredientA: number;
  let ingredientB: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-alchemy-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    await world.createUser("recipes", password.hash, password.salt);
    await world.setStaffRoles("alice", ["manager"]);

    const aliceScene = await world.createScene({
      owner: "alice",
      title: "Alice lab",
      body: "Bubbling.",
      visibility: "public",
    });
    const bobScene = await world.createScene({
      owner: "bob",
      title: "Bob lab",
      body: "Also bubbling.",
      visibility: "public",
    });

    const a = await world.createArtefact({
      owner: "alice",
      homeSceneId: aliceScene.id,
      title: "Alice potion",
      body: "A.",
      tags: ["spirit"],
    });
    const b = await world.createArtefact({
      owner: "bob",
      homeSceneId: bobScene.id,
      title: "Bob potion",
      body: "B.",
      tags: ["citrus"],
    });
    const i1 = await world.createArtefact({
      owner: "alice",
      homeSceneId: aliceScene.id,
      title: "Herb",
      body: "H.",
    });
    const i2 = await world.createArtefact({
      owner: "alice",
      homeSceneId: aliceScene.id,
      title: "Oil",
      body: "O.",
    });
    aliceArt = a.id;
    bobArt = b.id;
    ingredientA = i1.id;
    ingredientB = i2.id;

    sessions = new SessionStore();
    aliceToken = sessions.create("alice").token;
    bobToken = sessions.create("bob").token;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ world, sessions });
  }

  it("merges master before user files and namespaces user recipe ids", async () => {
    await world.saveAlchemyRecipes([
      { id: "master-mix", inputs: [ingredientA, ingredientB], gives: aliceArt },
    ]);
    await world.saveUserAlchemy("bob", [
      { id: "bob-mix", inputs: [ingredientA, ingredientB], gives: bobArt },
    ]);
    await world.saveUserAlchemy("alice", [
      { id: "alice-mix", inputs: [ingredientA, ingredientB], gives: aliceArt },
    ]);

    expect(world.masterAlchemyRecipes.map((r) => r.id)).toEqual(["master-mix"]);
    expect(world.alchemyRecipes.map((r) => r.id)).toEqual([
      "master-mix",
      "alice/alice-mix",
      "bob/bob-mix",
    ]);
    expect(world.alchemyRecipes[1]?.author).toBe("alice");
    expect(world.alchemyRecipes[2]?.author).toBe("bob");
  });

  it("isolates username recipes under alchemy/users/", async () => {
    const recipesUserScene = await world.createScene({
      owner: "recipes",
      title: "Recipes den",
      body: "Ironic.",
      visibility: "public",
    });
    const ownArt = await world.createArtefact({
      owner: "recipes",
      homeSceneId: recipesUserScene.id,
      title: "Irony",
      body: "I.",
    });
    await world.saveUserAlchemy("recipes", [
      { id: "own", inputs: [ingredientA, ingredientB], gives: ownArt.id },
    ]);

    const masterRaw = await readFile(join(dataDir, "alchemy", "recipes.json"), "utf8");
    expect(JSON.parse(masterRaw)).toEqual([]);
    const userRaw = await readFile(join(dataDir, "alchemy", "users", "recipes.json"), "utf8");
    expect(JSON.parse(userRaw)[0].id).toBe("own");
    expect(world.alchemyRecipes.some((r) => r.id === "recipes/own")).toBe(true);
  });

  it("rejects user save that grants an artefact outside manage", async () => {
    await expect(
      world.saveUserAlchemy("bob", [
        { id: "steal", inputs: [ingredientA, ingredientB], gives: aliceArt },
      ]),
    ).rejects.toThrow(/own or manage its home scene/);
  });

  it("skips malformed user files and keeps master", async () => {
    await world.saveAlchemyRecipes([
      { id: "ok", inputs: [ingredientA, ingredientB], gives: aliceArt },
    ]);
    await mkdir(join(dataDir, "alchemy", "users"), { recursive: true });
    await writeFile(join(dataDir, "alchemy", "users", "bob.json"), "{not-json", "utf8");
    await world.loadAlchemyFiles();
    expect(world.alchemyRecipes.map((r) => r.id)).toEqual(["ok"]);
    expect(world.getUserAlchemyRecipes("bob")).toEqual([]);
  });

  it("rebuilds merge after save so combine sees new rules", async () => {
    await world.collectArtefact("bob", ingredientA);
    await world.collectArtefact("bob", ingredientB);

    const before = await app().request("/alchemy/combine", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ artefactIds: [ingredientA, ingredientB] }),
    });
    expect(before.status).toBe(400);

    await world.saveUserAlchemy("bob", [
      { id: "brew", inputs: [ingredientA, ingredientB], gives: bobArt },
    ]);

    const after = await app().request("/alchemy/combine", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ artefactIds: [ingredientA, ingredientB] }),
    });
    expect(after.status).toBe(200);
    const body = (await after.json()) as { recipeId: string; gives: number[] };
    expect(body.recipeId).toBe("bob/brew");
    expect(body.gives).toEqual([bobArt]);
  });

  it("user alchemy editor shows file content and data-json-kind alchemy", async () => {
    await world.saveUserAlchemy("bob", [
      { id: "brew", inputs: [ingredientA, ingredientB], gives: bobArt },
    ]);
    const res = await app().request("/alchemy", {
      headers: { Accept: "text/html", Authorization: `Bearer ${bobToken}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-json-kind="alchemy"');
    expect(html).toContain("brew");
    expect(html).not.toContain("alice/");
    expect(html).toContain('name="recipesJson"');
  });

  it("manager data alchemy edits master only, with enhanced editor", async () => {
    await world.saveUserAlchemy("bob", [
      { id: "brew", inputs: [ingredientA, ingredientB], gives: bobArt },
    ]);
    await world.saveAlchemyRecipes([
      { id: "master-only", inputs: [ingredientA, ingredientB], gives: aliceArt },
    ]);

    const res = await app().request("/data/alchemy", {
      headers: { Accept: "text/html", Authorization: `Bearer ${aliceToken}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-json-kind="alchemy"');
    expect(html).toContain("master-only");
    expect(html).not.toContain("bob/brew");
    expect(html).not.toContain('"brew"');
  });

  it("skips unauthorized user recipes on load but keeps file for editing", async () => {
    await mkdir(join(dataDir, "alchemy", "users"), { recursive: true });
    await writeFile(
      join(dataDir, "alchemy", "users", "bob.json"),
      JSON.stringify([
        { id: "bad", inputs: [ingredientA, ingredientB], gives: aliceArt },
        { id: "good", inputs: [ingredientA, ingredientB], gives: bobArt },
      ]),
      "utf8",
    );
    await world.loadAlchemyFiles();
    expect(world.alchemyRecipes.map((r) => r.id)).toEqual(["bob/good"]);
    expect(world.getUserAlchemyRecipes("bob").map((r) => r.id)).toEqual(["bad", "good"]);
  });

  it("POST /alchemy saves only the signed-in user's file", async () => {
    const res = await app().request("/alchemy", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        recipesJson: JSON.stringify([
          { id: "from-form", inputs: [ingredientA, ingredientB], gives: bobArt },
        ]),
      }),
    });
    expect(res.status).toBe(302);
    expect(world.getUserAlchemyRecipes("bob")[0]?.id).toBe("from-form");
    expect(world.masterAlchemyRecipes).toEqual([]);
  });
});
