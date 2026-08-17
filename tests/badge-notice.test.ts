import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import { WorldStore } from "../src/store/world.js";

describe("badge earn inbox notice", () => {
  let dataDir: string;
  let world: WorldStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-badge-notice-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.saveQuest({
      name: "demo",
      rules: [
        {
          id: "done",
          when: { holds: 1 },
          then: [{ setFlag: "demo.done", to: true }],
        },
      ],
      onFlag: {
        "demo.done": { onTrue: [{ grantBadge: "demo.winner" }] },
      },
      badges: [
        {
          id: "demo.winner",
          title: "Winner",
          description: "You held the token.",
        },
      ],
    });
    const scene = await world.createScene({
      owner: "alice",
      title: "Lab",
      body: "Quiet.",
      visibility: "public",
    });
    const art = await world.createArtefact({
      owner: "alice",
      homeSceneId: scene.id,
      body: "A token.",
    });
    await world.collectArtefact("alice", art.id);
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("sends a notice with title and description when a badge is first granted", async () => {
    await world.evaluateQuestsForUser("alice");

    expect(world.getUserBadges("alice")).toEqual([
      { badge: "demo.winner", grantTime: expect.any(String) },
    ]);
    const inbox = world.listInboxFor("alice");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      type: "notice",
      fromUser: "Proseden",
      toUser: "alice",
      subject: "You've earned a badge Winner",
      body: "You held the token.",
    });
  });

  it("does not send another notice while the badge is already held", async () => {
    await world.evaluateQuestsForUser("alice");
    await world.evaluateQuestsForUser("alice");

    expect(world.listInboxFor("alice")).toHaveLength(1);
  });

  it("writes badge objects with grantTime and preserves them on re-eval", async () => {
    await world.evaluateQuestsForUser("alice");
    const [first] = world.getUserBadges("alice");
    expect(first?.grantTime).toEqual(expect.any(String));
    expect(JSON.parse(await readFile(join(dataDir, "users", "alice.badges.json"), "utf8"))).toEqual([
      { badge: "demo.winner", grantTime: first!.grantTime },
    ]);

    await world.evaluateQuestsForUser("alice");
    expect(world.getUserBadges("alice")).toEqual([first]);
  });

  it("does not invent grantTime for a badge already held without one", async () => {
    await world.saveUserBadges("alice", [{ badge: "demo.winner" }]);
    await world.evaluateQuestsForUser("alice");
    expect(world.getUserBadges("alice")).toEqual([{ badge: "demo.winner" }]);
    expect(world.listInboxFor("alice")).toHaveLength(0);
  });
});
