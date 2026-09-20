import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  remapPersonalPrefix,
  rewriteUserQuestFile,
  upgradeDataDir,
} from "../deploy/migrations/005-user-quest-namespace.mjs";

describe("005-user-quest-namespace", () => {
  let dataDir: string;

  afterEach(async () => {
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("remaps legacy prefix without double-prefixing", () => {
    expect(remapPersonalPrefix("bob.hasKey", "bob")).toBe("user.bob.hasKey");
    expect(remapPersonalPrefix("user.bob.hasKey", "bob")).toBe("user.bob.hasKey");
    expect(remapPersonalPrefix("flag:not.bob.x", "bob")).toBe("flag:not.user.bob.x");
    expect(remapPersonalPrefix("builders.bob.x", "bob")).toBe("builders.bob.x");
  });

  it("rewrites legacy personal quest name and ids", () => {
    const { quest, changed } = rewriteUserQuestFile(
      {
        name: "bob",
        rules: [{ id: "r", when: { flag: "bob.a" }, then: [{ setFlag: "bob.x" }] }],
        badges: [{ id: "bob.b", title: "B" }],
      },
      "bob",
    );
    expect(changed).toBe(true);
    expect(quest).toMatchObject({
      name: "user.bob",
      badges: [{ id: "user.bob.b", title: "B" }],
    });
  });

  it("upgrades a data dir and stamps schemaVersion 5", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-005-"));
    await writeFile(join(dataDir, "meta.json"), `${JSON.stringify({ schemaVersion: 4 }, null, 2)}\n`);
    await mkdir(join(dataDir, "quests", "users"), { recursive: true });
    await mkdir(join(dataDir, "users"), { recursive: true });
    await mkdir(join(dataDir, "scenes"), { recursive: true });
    await writeFile(
      join(dataDir, "quests", "users", "bob.json"),
      `${JSON.stringify({
        name: "bob",
        rules: [{ id: "r", when: { holds: 1 }, then: [{ setFlag: "bob.x" }] }],
      })}\n`,
    );
    await writeFile(
      join(dataDir, "users", "bob.flags.json"),
      `${JSON.stringify({ "bob.x": true, "builders.a": true })}\n`,
    );
    await writeFile(
      join(dataDir, "scenes", "1.json"),
      `${JSON.stringify({ id: 1, title: "Hall", when: "bob.gate" })}\n`,
    );

    const { rewritten } = upgradeDataDir(dataDir);
    expect(rewritten).toBeGreaterThanOrEqual(3);

    const quest = JSON.parse(await readFile(join(dataDir, "quests", "users", "bob.json"), "utf8"));
    expect(quest.name).toBe("user.bob");
    expect(quest.rules[0].then[0].setFlag).toBe("user.bob.x");

    const flags = JSON.parse(await readFile(join(dataDir, "users", "bob.flags.json"), "utf8"));
    expect(flags["user.bob.x"]).toBe(true);
    expect(flags["builders.a"]).toBe(true);

    const scene = JSON.parse(await readFile(join(dataDir, "scenes", "1.json"), "utf8"));
    expect(scene.when).toBe("user.bob.gate");

    const meta = JSON.parse(await readFile(join(dataDir, "meta.json"), "utf8"));
    expect(meta.schemaVersion).toBe(5);
  });

  it("fails when manager quests/user.json exists", async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-005-bad-"));
    await writeFile(join(dataDir, "meta.json"), `${JSON.stringify({ schemaVersion: 4 }, null, 2)}\n`);
    await mkdir(join(dataDir, "quests"), { recursive: true });
    await writeFile(join(dataDir, "quests", "user.json"), `${JSON.stringify({ name: "user", rules: [] })}\n`);
    expect(() => upgradeDataDir(dataDir)).toThrow(/reserved/);
  });
});
