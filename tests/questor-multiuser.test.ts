import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("questor / multi-user quests", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let aliceToken: string;
  let bobToken: string;
  let carolToken: string;
  let bobArt: number;
  let aliceArt: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-questor-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    await world.createUser("carol", password.hash, password.salt);
    await world.setStaffRoles("alice", ["manager"]);
    await world.setStaffRoles("bob", ["questor"]);

    const aliceScene = await world.createScene({
      owner: "alice",
      title: "Alice hall",
      body: "A.",
      visibility: "public",
    });
    const bobScene = await world.createScene({
      owner: "bob",
      title: "Bob hall",
      body: "B.",
      visibility: "public",
    });
    const a = await world.createArtefact({
      owner: "alice",
      homeSceneId: aliceScene.id,
      title: "Alice prize",
      body: "A.",
    });
    const b = await world.createArtefact({
      owner: "bob",
      homeSceneId: bobScene.id,
      title: "Bob prize",
      body: "B.",
    });
    aliceArt = a.id;
    bobArt = b.id;

    sessions = new SessionStore();
    aliceToken = sessions.create("alice").token;
    bobToken = sessions.create("bob").token;
    carolToken = sessions.create("carol").token;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ world, sessions });
  }

  it("merges manager quests before user quests", async () => {
    await world.saveQuest({
      name: "zebra",
      rules: [{ id: "z", when: { holds: 1 }, then: [{ setFlag: "zebra.a", to: true }] }],
    });
    await world.saveUserQuest("bob", {
      name: "bob",
      rules: [{ id: "b", when: { holds: 1 }, then: [{ setFlag: "bob.a", to: true }] }],
    });

    expect(world.masterQuests.map((q) => q.name)).toEqual(["zebra"]);
    expect(world.quests.map((q) => q.name)).toEqual(["zebra", "bob"]);
    expect(world.quests[1]?.author).toBe("bob");
  });

  it("forces username namespace and isolates under quests/users/", async () => {
    await world.saveUserQuest("bob", {
      name: "bob",
      rules: [],
      badges: [{ id: "bob.starter", title: "Starter" }],
    });

    const masterList = await app().request("/data/quests", {
      headers: { Accept: "application/json", Authorization: `Bearer ${aliceToken}` },
    });
    expect(masterList.status).toBe(200);
    const masterBody = (await masterList.json()) as { quests: string[] };
    expect(masterBody.quests).not.toContain("bob");

    const raw = await readFile(join(dataDir, "quests", "users", "bob.json"), "utf8");
    expect(JSON.parse(raw).name).toBe("bob");
    expect(world.getUserQuest("bob")?.badges?.[0]?.id).toBe("bob.starter");
  });

  it("rejects user save when name is not username", async () => {
    await expect(
      world.saveUserQuest("bob", {
        name: "sunset",
        rules: [],
      }),
    ).rejects.toThrow(/must be your username/);
  });

  it("rejects user save that giveArtefacts outside manage", async () => {
    await expect(
      world.saveUserQuest("bob", {
        name: "bob",
        rules: [{ id: "r", when: { holds: 1 }, then: [{ setFlag: "bob.x", to: true }] }],
        onFlag: {
          "bob.x": { onTrue: [{ giveArtefact: aliceArt }] },
        },
      }),
    ).rejects.toThrow(/own or manage its home scene/);
  });

  it("skips malformed user files and keeps manager quests", async () => {
    await world.saveQuest({ name: "ok", rules: [] });
    await mkdir(join(dataDir, "quests", "users"), { recursive: true });
    await writeFile(join(dataDir, "quests", "users", "bob.json"), "{not-json", "utf8");
    await world.loadLogicFiles();
    expect(world.masterQuests.map((q) => q.name)).toEqual(["ok"]);
    expect(world.quests.map((q) => q.name)).toEqual(["ok"]);
    expect(world.getUserQuest("bob")).toBeUndefined();
  });

  it("skips user quest when manager already owns the namespace", async () => {
    await world.saveQuest({ name: "bob", rules: [] });
    await mkdir(join(dataDir, "quests", "users"), { recursive: true });
    await writeFile(
      join(dataDir, "quests", "users", "bob.json"),
      JSON.stringify({
        name: "bob",
        rules: [{ id: "r", when: { holds: 1 }, then: [{ setFlag: "bob.x", to: true }] }],
      }),
      "utf8",
    );
    await world.loadLogicFiles();
    expect(world.quests.map((q) => q.name)).toEqual(["bob"]);
    expect(world.quests[0]?.author).toBeUndefined();
    expect(world.getUserQuest("bob")?.rules).toHaveLength(1);
    await expect(
      world.saveUserQuest("bob", { name: "bob", rules: [] }),
    ).rejects.toThrow(/owned by a manager quest/);
  });

  it("skips unauthorized giveArtefact on load but keeps file for editing", async () => {
    await mkdir(join(dataDir, "quests", "users"), { recursive: true });
    await writeFile(
      join(dataDir, "quests", "users", "bob.json"),
      JSON.stringify({
        name: "bob",
        rules: [{ id: "r", when: { holds: 1 }, then: [{ setFlag: "bob.x", to: true }] }],
        onFlag: {
          "bob.x": { onTrue: [{ giveArtefact: aliceArt }] },
        },
      }),
      "utf8",
    );
    await world.loadLogicFiles();
    expect(world.quests.some((q) => q.name === "bob")).toBe(false);
    expect(world.getUserQuest("bob")?.onFlag?.["bob.x"]).toBeTruthy();
  });

  it("questor may GET/POST /quests; non-questor is forbidden", async () => {
    const denied = await app().request("/quests", {
      headers: { Accept: "text/html", Authorization: `Bearer ${carolToken}` },
    });
    expect(denied.status).toBe(403);

    const get = await app().request("/quests", {
      headers: { Accept: "text/html", Authorization: `Bearer ${bobToken}` },
    });
    expect(get.status).toBe(200);
    const html = await get.text();
    expect(html).toContain("Your quests");
    expect(html).toContain("quests/users/bob.json");
    expect(html).toContain('name="questJson"');

    const post = await app().request("/quests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        questJson: JSON.stringify({
          name: "bob",
          rules: [],
          badges: [{ id: "bob.form", title: "From form" }],
          onFlag: {
            // no giveArtefact — ACL not needed
          },
        }),
      }),
    });
    expect(post.status).toBe(302);
    expect(world.getUserQuest("bob")?.badges?.[0]?.id).toBe("bob.form");
  });

  it("manager may edit personal quests and lists only master under /data/quests", async () => {
    await world.saveUserQuest("alice", {
      name: "alice",
      rules: [],
      badges: [{ id: "alice.m", title: "M" }],
    });
    await world.saveQuest({ name: "official", rules: [] });

    const personal = await app().request("/quests", {
      headers: { Accept: "text/html", Authorization: `Bearer ${aliceToken}` },
    });
    expect(personal.status).toBe(200);
    expect(await personal.text()).toContain("alice.m");

    const data = await app().request("/data/quests", {
      headers: { Accept: "application/json", Authorization: `Bearer ${aliceToken}` },
    });
    const body = (await data.json()) as { quests: string[] };
    expect(body.quests).toEqual(["official"]);
  });

  it("evaluates manager rules before user rules in one pass", async () => {
    await world.saveQuest({
      name: "alpha",
      rules: [
        {
          id: "seed",
          when: { holds: bobArt },
          then: [{ setFlag: "alpha.go", to: true }],
        },
      ],
    });
    await world.saveUserQuest("bob", {
      name: "bob",
      rules: [
        {
          id: "follow",
          when: { flag: "alpha.go" },
          then: [{ setFlag: "bob.seen", to: true }],
        },
      ],
    });
    await world.collectArtefact("bob", bobArt);
    await world.evaluateQuestsForUser("bob");
    const flags = world.getUserFlags("bob");
    expect(flags["alpha.go"]).toBe(true);
    expect(flags["bob.seen"]).toBe(true);
  });
});
