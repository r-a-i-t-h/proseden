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
      rules: [{ id: "z", when: { holds: 1 }, then: [{ setFlag: "zebra.a" }] }],
    });
    await world.saveUserQuest("bob", {
      name: "user.bob",
      rules: [{ id: "b", when: { holds: 1 }, then: [{ setFlag: "user.bob.a" }] }],
    });

    expect(world.masterQuests.map((q) => q.name)).toEqual(["zebra"]);
    expect(world.quests.map((q) => q.name)).toEqual(["zebra", "user.bob"]);
    expect(world.quests[1]?.author).toBe("bob");
  });

  it("forces user.<username> namespace and isolates under quests/users/", async () => {
    await world.saveUserQuest("bob", {
      name: "user.bob",
      rules: [],
      badges: [{ id: "user.bob.starter", title: "Starter" }],
    });

    const masterList = await app().request("/data/quests", {
      headers: { Accept: "application/json", Authorization: `Bearer ${aliceToken}` },
    });
    expect(masterList.status).toBe(200);
    const masterBody = (await masterList.json()) as { quests: string[] };
    expect(masterBody.quests).not.toContain("bob");
    expect(masterBody.quests).not.toContain("user.bob");

    const raw = await readFile(join(dataDir, "quests", "users", "bob.json"), "utf8");
    expect(JSON.parse(raw).name).toBe("user.bob");
    expect(world.getUserQuest("bob")?.badges?.[0]?.id).toBe("user.bob.starter");
  });

  it("rejects user save when name is not user.<username>", async () => {
    await expect(
      world.saveUserQuest("bob", {
        name: "sunset",
        rules: [],
      }),
    ).rejects.toThrow(/must be "user\.bob"/);
  });

  it("rejects manager quest named user", async () => {
    await expect(world.saveQuest({ name: "user", rules: [] })).rejects.toThrow(/simple identifier|reserved/);
  });

  it("rejects user save that giveArtefacts outside manage", async () => {
    await expect(
      world.saveUserQuest("bob", {
        name: "user.bob",
        rules: [
          {
            id: "r",
            when: { holds: 1 },
            then: [{ setFlag: "user.bob.x" }, { giveArtefact: aliceArt }],
          },
        ],
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

  it("allows manager bob and personal user.bob side by side", async () => {
    await world.saveQuest({ name: "bob", rules: [] });
    await world.saveUserQuest("bob", {
      name: "user.bob",
      rules: [{ id: "r", when: { holds: 1 }, then: [{ setFlag: "user.bob.x" }] }],
    });
    expect(world.quests.map((q) => q.name)).toEqual(["bob", "user.bob"]);
    expect(world.quests.find((q) => q.name === "user.bob")?.author).toBe("bob");
    expect(world.getUserQuest("bob")?.rules).toHaveLength(1);
  });

  it("skips unauthorized giveArtefact on load but keeps file for editing", async () => {
    await mkdir(join(dataDir, "quests", "users"), { recursive: true });
    await writeFile(
      join(dataDir, "quests", "users", "bob.json"),
      JSON.stringify({
        name: "user.bob",
        rules: [
          {
            id: "r",
            when: { holds: 1 },
            then: [{ setFlag: "user.bob.x" }, { giveArtefact: aliceArt }],
          },
        ],
      }),
      "utf8",
    );
    await world.loadLogicFiles();
    expect(world.quests.some((q) => q.name === "user.bob")).toBe(false);
    expect(world.getUserQuest("bob")?.rules?.[0]?.then?.some((t) => "giveArtefact" in t)).toBe(
      true,
    );
  });

  it("cold-loads user quests with giveArtefact after restart", async () => {
    await world.saveUserQuest("bob", {
      name: "user.bob",
      rules: [
        {
          id: "r",
          when: { holds: 1 },
          then: [{ setFlag: "user.bob.x" }, { giveArtefact: bobArt }],
        },
      ],
    });
    expect(world.quests.some((q) => q.name === "user.bob" && q.author === "bob")).toBe(true);

    const reloaded = new WorldStore(dataDir);
    await reloaded.load();
    expect(reloaded.quests.some((q) => q.name === "user.bob" && q.author === "bob")).toBe(true);
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
    expect(html).toContain("user.bob.*");
    expect(html).toContain("Quests editor");
    expect(html).toContain("Flags editor");
    expect(html).toContain("Badges editor");
    expect(html).toContain('name="questJson"');
    expect(html).toContain('name="flagsJson"');
    expect(html).toContain('name="badgesJson"');
    expect(html).toContain('data-persist-open="proseden-quests-editor-open"');
    expect(html).toContain('action="quests/flags"');
    expect(html).toContain('action="quests/badges"');

    const post = await app().request("/quests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        questJson: JSON.stringify({
          name: "user.bob",
          rules: [],
          badges: [{ id: "user.bob.form", title: "From form" }],
        }),
      }),
    });
    expect(post.status).toBe(302);
    expect(world.getUserQuest("bob")?.badges?.[0]?.id).toBe("user.bob.form");
  });

  it("questor may GET/POST own flags and badges on /quests", async () => {
    await world.saveUserFlags("bob", { "user.bob.seed": true });
    await world.saveUserBadges("bob", [{ badge: "user.bob.old", grantTime: "2026-01-01T00:00:00.000Z" }]);

    const get = await app().request("/quests", {
      headers: { Accept: "text/html", Authorization: `Bearer ${bobToken}` },
    });
    expect(get.status).toBe(200);
    const html = await get.text();
    expect(html).toContain("user.bob.seed");
    expect(html).toContain("user.bob.old");

    const flagsPost = await app().request("/quests/flags", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        flagsJson: JSON.stringify({ "user.bob.cheat": true, "user.bob.noise": false }),
      }),
    });
    expect(flagsPost.status).toBe(302);
    expect(flagsPost.headers.get("location")).toContain("saved=flags");
    expect(world.getUserFlags("bob")).toEqual({ "user.bob.cheat": true });
    expect(JSON.parse(await readFile(join(dataDir, "users", "bob.flags.json"), "utf8"))).toEqual({
      "user.bob.cheat": true,
    });

    const badgesPost = await app().request("/quests/badges", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        badgesJson: JSON.stringify([
          { badge: "user.bob.trophy", grantTime: "2026-02-01T00:00:00.000Z" },
          { badge: "user.bob.trophy" },
          "skip-me",
        ]),
      }),
    });
    expect(badgesPost.status).toBe(302);
    expect(badgesPost.headers.get("location")).toContain("saved=badges");
    expect(world.getUserBadges("bob")).toEqual([
      { badge: "user.bob.trophy", grantTime: "2026-02-01T00:00:00.000Z" },
    ]);

    const denied = await app().request("/quests/flags", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${carolToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ flagsJson: "{}" }),
    });
    expect(denied.status).toBe(403);

    const badFlags = await app().request("/quests/flags", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ flagsJson: "[]" }),
    });
    expect(badFlags.status).toBe(400);

    const badBadges = await app().request("/quests/badges", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ badgesJson: "{}" }),
    });
    expect(badBadges.status).toBe(400);
  });

  it("preserves compact quest JSON formatting on save and reload", async () => {
    const compact = `{
  "name": "user.bob",
  "rules": [
    { "id": "r", "when": { "holds": 1 }, "then": [{ "setFlag": "user.bob.x" }] }
  ]
}
`;
    const post = await app().request("/quests", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bobToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ questJson: compact }),
    });
    expect(post.status).toBe(302);

    const onDisk = await readFile(join(dataDir, "quests", "users", "bob.json"), "utf8");
    expect(onDisk).toContain(
      `{ "id": "r", "when": { "holds": 1 }, "then": [{ "setFlag": "user.bob.x" }] }`,
    );
    expect(onDisk).not.toContain(`"when": {\n`);

    const get = await app().request("/quests", {
      headers: { Accept: "text/html", Authorization: `Bearer ${bobToken}` },
    });
    expect(get.status).toBe(200);
    const html = await get.text();
    expect(html).toContain(
      `{ &quot;id&quot;: &quot;r&quot;, &quot;when&quot;: { &quot;holds&quot;: 1 }, &quot;then&quot;: [{ &quot;setFlag&quot;: &quot;user.bob.x&quot; }] }`,
    );
  });

  it("manager may edit personal quests and lists them under /data/quests", async () => {
    await world.saveUserQuest("alice", {
      name: "user.alice",
      rules: [],
      badges: [{ id: "user.alice.m", title: "M" }],
    });
    await world.saveUserQuest("bob", {
      name: "user.bob",
      rules: [{ id: "r", when: { holds: bobArt }, then: [{ setFlag: "user.bob.x" }] }],
    });
    await world.saveQuest({ name: "official", rules: [] });

    const personal = await app().request("/quests", {
      headers: { Accept: "text/html", Authorization: `Bearer ${aliceToken}` },
    });
    expect(personal.status).toBe(200);
    expect(await personal.text()).toContain("user.alice.m");

    const data = await app().request("/data/quests", {
      headers: { Accept: "application/json", Authorization: `Bearer ${aliceToken}` },
    });
    const body = (await data.json()) as { quests: string[]; userQuests: string[] };
    expect(body.quests).toEqual(["official"]);
    expect(body.userQuests).toEqual(["alice", "bob"]);

    const bobFile = await app().request("/data/quests/users/bob", {
      headers: { Accept: "text/html", Authorization: `Bearer ${aliceToken}` },
    });
    expect(bobFile.status).toBe(200);
    expect(await bobFile.text()).toContain("user.bob.x");

    const save = await app().request("/data/quests/users/bob", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${aliceToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        json: JSON.stringify({
          name: "user.bob",
          rules: [{ id: "r2", when: { holds: bobArt }, then: [{ setFlag: "user.bob.y" }] }],
        }),
      }),
    });
    expect(save.status).toBe(200);
    expect(world.getUserQuest("bob")?.rules[0]?.id).toBe("r2");

    const asBob = await app().request("/data/quests/users/alice", {
      headers: { Accept: "application/json", Authorization: `Bearer ${bobToken}` },
    });
    expect(asBob.status).toBe(403);
  });

  it("evaluates manager rules before user rules in one pass", async () => {
    await world.saveQuest({
      name: "alpha",
      rules: [
        {
          id: "seed",
          when: { holds: bobArt },
          then: [{ setFlag: "alpha.go" }],
        },
      ],
    });
    await world.saveUserQuest("bob", {
      name: "user.bob",
      rules: [
        {
          id: "follow",
          when: { flag: "alpha.go" },
          then: [{ setFlag: "user.bob.seen" }],
        },
      ],
    });
    await world.collectArtefact("bob", bobArt);
    await world.evaluateQuestsForUser("bob");
    const flags = world.getUserFlags("bob");
    expect(flags["alpha.go"]).toBe(true);
    expect(flags["user.bob.seen"]).toBe(true);
  });
});
