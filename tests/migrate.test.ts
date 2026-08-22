import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProseDocument } from "../src/store/markdown.js";
import { WorldStore } from "../src/store/world.js";
import { rewriteLegacyLinkSchemes } from "../deploy/migrations/002-rewrite-link-schemes.mjs";
import {
  badgeListNeedsConvert,
  convertBadgeList,
} from "../deploy/migrations/004-badge-objects.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployDir = join(repoRoot, "deploy");
const migrateSh = join(deployDir, "migrate.sh");

type Meta = {
  nextSceneId: number;
  nextArtefactId: number;
  nextGroupId: number;
  entranceSceneId: number;
  schemaVersion?: number;
  extra?: string;
};

async function writeMeta(dir: string, meta: Record<string, unknown>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

async function readMeta(dir: string): Promise<Meta> {
  return JSON.parse(await readFile(join(dir, "meta.json"), "utf8")) as Meta;
}

async function runMigrate(
  dataDir: string,
  script = migrateSh,
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("sh", [script], {
      env: { ...process.env, PROSEDEN_DATA: dataDir },
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
      code: typeof failed.code === "number" ? failed.code : 1,
    };
  }
}

describe("rewriteLegacyLinkSchemes", () => {
  it("maps pedia, srch, and media destinations", () => {
    expect(rewriteLegacyLinkSchemes("[Moss](pedia:Moss)")).toBe("[Moss](wikipedia:Moss)");
    expect(rewriteLegacyLinkSchemes("[find](srch:proseden)")).toBe("[find](search:proseden)");
    expect(rewriteLegacyLinkSchemes("[look](media:stone lintel)")).toBe(
      "[look](search:stone lintel)",
    );
  });

  it("is case-insensitive and keeps dest whitespace", () => {
    expect(rewriteLegacyLinkSchemes("[n](PEDIA:Lintel)")).toBe("[n](wikipedia:Lintel)");
    expect(rewriteLegacyLinkSchemes("[n]( srch:x )")).toBe("[n]( search:x )");
  });

  it("leaves http(s), new prefixes, and code spans alone", () => {
    expect(rewriteLegacyLinkSchemes("[a](https://example.com)")).toBe("[a](https://example.com)");
    expect(rewriteLegacyLinkSchemes("[a](wikipedia:Moss)")).toBe("[a](wikipedia:Moss)");
    expect(rewriteLegacyLinkSchemes("`[x](pedia:y)`")).toBe("`[x](pedia:y)`");
  });
});

describe("convertBadgeList", () => {
  it("wraps string ids without inventing grantTime", () => {
    expect(convertBadgeList(["builders.hamlet", "  demo.winner  "])).toEqual([
      { badge: "builders.hamlet" },
      { badge: "demo.winner" },
    ]);
    expect(badgeListNeedsConvert(["builders.hamlet"])).toBe(true);
    expect(badgeListNeedsConvert([{ badge: "builders.hamlet" }])).toBe(false);
    expect(badgeListNeedsConvert([])).toBe(false);
  });

  it("keeps existing objects and grantTime, skips junk", () => {
    expect(
      convertBadgeList([
        { badge: "a.one", grantTime: "2020-01-01T00:00:00.000Z" },
        "a.one",
        "a.two",
        { badge: "  " },
        null,
      ]),
    ).toEqual([
      { badge: "a.one", grantTime: "2020-01-01T00:00:00.000Z" },
      { badge: "a.two" },
    ]);
  });
});

describe("schema migrate runner", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-migrate-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("001 through 006 stamp schemaVersion 6 and keep other meta keys", async () => {
    await writeMeta(dataDir, {
      nextSceneId: 4,
      nextArtefactId: 2,
      nextGroupId: 2,
      nextEntranceGroupId: 2,
      entranceSceneId: 1,
      extra: "keep-me",
    });

    const first = await runMigrate(dataDir);
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(/applying 001-schema-version\.sh/);
    expect(first.stdout).toMatch(/applying 002-rewrite-link-schemes\.sh/);
    expect(first.stdout).toMatch(/applying 003-default-quests\.sh/);
    expect(first.stdout).toMatch(/applying 004-badge-objects\.sh/);
    expect(first.stdout).toMatch(/applying 005-user-quest-namespace\.sh/);
    expect(first.stdout).toMatch(/applying 006-user-home-scenes\.sh/);

    const meta = await readMeta(dataDir);
    expect(meta.schemaVersion).toBe(6);
    expect(meta.nextSceneId).toBe(4);
    expect(meta.nextArtefactId).toBe(2);
    expect(meta.nextGroupId).toBe(2);
    expect(meta.entranceSceneId).toBe(1);
    expect(meta.extra).toBe("keep-me");

    expect(await readFile(join(dataDir, "quests", "builders.json"), "utf8")).toMatch(/"name": "builders"/);
    expect(await readFile(join(dataDir, "quests", "proseden.json"), "utf8")).toMatch(/"name": "proseden"/);
    expect(await readFile(join(dataDir, "alchemy", "recipes.json"), "utf8")).toMatch(/^\s*\[\s*\]\s*$/);
  });

  it("second run is a no-op", async () => {
    await writeMeta(dataDir, {
      nextSceneId: 4,
      nextArtefactId: 2,
      nextGroupId: 2,
      nextEntranceGroupId: 2,
      entranceSceneId: 1,
    });

    expect((await runMigrate(dataDir)).code).toBe(0);
    const afterFirst = await readFile(join(dataDir, "meta.json"), "utf8");

    const second = await runMigrate(dataDir);
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(/already at schema 6/);
    expect(second.stdout).not.toMatch(/applying/);
    expect(await readFile(join(dataDir, "meta.json"), "utf8")).toBe(afterFirst);
  });

  it("003 does not overwrite an existing builders quest", async () => {
    await writeMeta(dataDir, {
      nextSceneId: 4,
      nextArtefactId: 2,
      nextGroupId: 2,
      nextEntranceGroupId: 2,
      entranceSceneId: 1,
      schemaVersion: 2,
    });
    await mkdir(join(dataDir, "quests"), { recursive: true });
    await writeFile(
      join(dataDir, "quests", "builders.json"),
      `${JSON.stringify({ name: "builders", rules: [], description: "custom" }, null, 2)}\n`,
    );

    const result = await runMigrate(dataDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/applying 003-default-quests\.sh/);
    expect(result.stdout).toMatch(/applying 004-badge-objects\.sh/);
    expect(result.stdout).toMatch(/applying 005-user-quest-namespace\.sh/);
    expect(result.stdout).toMatch(/applying 006-user-home-scenes\.sh/);
    const builders = JSON.parse(
      await readFile(join(dataDir, "quests", "builders.json"), "utf8"),
    ) as { description?: string };
    expect(builders.description).toBe("custom");
    expect(await readMeta(dataDir)).toMatchObject({ schemaVersion: 6 });
  });

  it("004 converts string badge files and leaves object files and grantTime alone", async () => {
    await writeMeta(dataDir, {
      nextSceneId: 4,
      nextArtefactId: 2,
      nextGroupId: 2,
      nextEntranceGroupId: 2,
      entranceSceneId: 1,
      schemaVersion: 3,
    });
    await mkdir(join(dataDir, "users"), { recursive: true });
    await writeFile(
      join(dataDir, "users", "alice.badges.json"),
      `${JSON.stringify(["builders.hamlet", "demo.winner"], null, 2)}\n`,
    );
    await writeFile(
      join(dataDir, "users", "bob.badges.json"),
      `${JSON.stringify([{ badge: "builders.hamlet", grantTime: "2020-01-01T00:00:00.000Z" }], null, 2)}\n`,
    );
    await writeFile(join(dataDir, "users", "carol.badges.json"), "[]\n");
    const bobBefore = await readFile(join(dataDir, "users", "bob.badges.json"), "utf8");
    const carolBefore = await readFile(join(dataDir, "users", "carol.badges.json"), "utf8");

    const result = await runMigrate(dataDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/applying 004-badge-objects\.sh/);
    expect(result.stdout).toMatch(/applying 005-user-quest-namespace\.sh/);
    expect(result.stdout).toMatch(/applying 006-user-home-scenes\.sh/);
    expect(result.stdout).toMatch(/004-badge-objects: rewrote 1 file\(s\)/);
    expect(JSON.parse(await readFile(join(dataDir, "users", "alice.badges.json"), "utf8"))).toEqual([
      { badge: "builders.hamlet" },
      { badge: "demo.winner" },
    ]);
    expect(await readFile(join(dataDir, "users", "bob.badges.json"), "utf8")).toBe(bobBefore);
    expect(await readFile(join(dataDir, "users", "carol.badges.json"), "utf8")).toBe(carolBefore);
    expect(await readMeta(dataDir)).toMatchObject({ schemaVersion: 6 });
  });

  it("005 rewrites legacy personal quest namespaces", async () => {
    await writeMeta(dataDir, {
      nextSceneId: 4,
      nextArtefactId: 2,
      nextGroupId: 2,
      nextEntranceGroupId: 2,
      entranceSceneId: 1,
      schemaVersion: 4,
    });
    await mkdir(join(dataDir, "quests", "users"), { recursive: true });
    await mkdir(join(dataDir, "users"), { recursive: true });
    await writeFile(
      join(dataDir, "quests", "users", "bob.json"),
      `${JSON.stringify({
        name: "bob",
        rules: [{ id: "r", when: { holds: 1 }, then: [{ setFlag: "bob.x" }] }],
      })}\n`,
    );
    await writeFile(
      join(dataDir, "users", "bob.flags.json"),
      `${JSON.stringify({ "bob.x": true })}\n`,
    );

    const result = await runMigrate(dataDir);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/applying 005-user-quest-namespace\.sh/);
    expect(result.stdout).toMatch(/applying 006-user-home-scenes\.sh/);
    const quest = JSON.parse(
      await readFile(join(dataDir, "quests", "users", "bob.json"), "utf8"),
    ) as { name: string; rules: Array<{ then: Array<{ setFlag: string }> }> };
    expect(quest.name).toBe("user.bob");
    expect(quest.rules[0]?.then[0]?.setFlag).toBe("user.bob.x");
    expect(JSON.parse(await readFile(join(dataDir, "users", "bob.flags.json"), "utf8"))).toEqual({
      "user.bob.x": true,
    });
    expect(await readMeta(dataDir)).toMatchObject({ schemaVersion: 6 });
  });

  it("applies 001 then 002 in order from v0", async () => {
    const harness = await mkdtemp(join(tmpdir(), "proseden-mig-harness-"));
    try {
      await mkdir(join(harness, "migrations"));
      await cp(migrateSh, join(harness, "migrate.sh"));
      await cp(
        join(deployDir, "migrations", "001-schema-version.sh"),
        join(harness, "migrations", "001-schema-version.sh"),
      );
      await writeFile(
        join(harness, "migrations", "002-mark-v2.sh"),
        `#!/bin/sh
set -eu
node -e '
const fs = require("fs");
const path = require("path");
const metaPath = path.join(process.env.PROSEDEN_DATA, "meta.json");
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
meta.schemaVersion = 2;
meta.upgradedBy = "002";
fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\\n");
'
`,
      );
      await chmod(join(harness, "migrations", "002-mark-v2.sh"), 0o755);

      await writeMeta(dataDir, {
        nextSceneId: 3,
        nextArtefactId: 1,
        nextGroupId: 1,
        nextEntranceGroupId: 1,
        entranceSceneId: 1,
      });

      const result = await runMigrate(dataDir, join(harness, "migrate.sh"));
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/applying 001-schema-version\.sh/);
      expect(result.stdout).toMatch(/applying 002-mark-v2\.sh/);
      expect(result.stdout).toMatch(/now at schema 2/);

      const meta = await readMeta(dataDir);
      expect(meta.schemaVersion).toBe(2);
      expect(meta.nextSceneId).toBe(3);
      expect((meta as Meta & { upgradedBy?: string }).upgradedBy).toBe("002");
    } finally {
      await rm(harness, { recursive: true, force: true });
    }
  });

  it("rewrites legacy link prefixes in current prose and snapshots", async () => {
    await writeMeta(dataDir, {
      nextSceneId: 3,
      nextArtefactId: 2,
      nextGroupId: 1,
      nextEntranceGroupId: 1,
      entranceSceneId: 1,
      schemaVersion: 1,
    });

    await mkdir(join(dataDir, "scenes", "1.versions"), { recursive: true });
    await mkdir(join(dataDir, "artefacts"), { recursive: true });
    await writeFile(
      join(dataDir, "scenes", "1.md"),
      `---
id: 1
---
See [Moss](pedia:Moss) and [find](srch:proseden).
Also [look](media:stone lintel) and [keep](https://example.com/a).
Inline code \`[x](pedia:y)\` stays put.
`,
    );
    await writeFile(
      join(dataDir, "scenes", "1.versions", "2026-08-10T200000Z.md"),
      "Older [note](PEDIA:Lintel).\n",
    );
    await writeFile(
      join(dataDir, "artefacts", "1.md"),
      "A [clipping](srch:deckle edge).\n",
    );
    await writeFile(join(dataDir, "scenes", "1.exits.json"), "[]\n");

    const result = await runMigrate(dataDir);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toMatch(/001-schema-version/);
    expect(result.stdout).toMatch(/applying 002-rewrite-link-schemes\.sh/);
    expect(result.stdout).toMatch(/applying 003-default-quests\.sh/);
    expect(result.stdout).toMatch(/applying 004-badge-objects\.sh/);
    expect(result.stdout).toMatch(/applying 005-user-quest-namespace\.sh/);
    expect(result.stdout).toMatch(/applying 006-user-home-scenes\.sh/);
    expect(result.stdout).toMatch(/rewrote 3 file\(s\)/);

    expect(await readFile(join(dataDir, "scenes", "1.md"), "utf8")).toBe(`---
id: 1
---
See [Moss](wikipedia:Moss) and [find](search:proseden).
Also [look](search:stone lintel) and [keep](https://example.com/a).
Inline code \`[x](pedia:y)\` stays put.
`);
    expect(await readFile(join(dataDir, "scenes", "1.versions", "2026-08-10T200000Z.md"), "utf8")).toBe(
      "Older [note](wikipedia:Lintel).\n",
    );
    expect(await readFile(join(dataDir, "artefacts", "1.md"), "utf8")).toBe(
      "A [clipping](search:deckle edge).\n",
    );
    expect(await readFile(join(dataDir, "scenes", "1.exits.json"), "utf8")).toBe("[]\n");
    expect((await readMeta(dataDir)).schemaVersion).toBe(6);
  });

  it("upgrades a sample scene file without mangling the rest", async () => {
    const fixtureDir = join(repoRoot, "tests/fixtures/link-scheme-upgrade");
    const before = await readFile(join(fixtureDir, "scene.md"), "utf8");
    const expected = await readFile(join(fixtureDir, "scene.expected.md"), "utf8");

    await writeMeta(dataDir, {
      nextSceneId: 8,
      nextArtefactId: 1,
      nextGroupId: 2,
      nextEntranceGroupId: 1,
      entranceSceneId: 1,
      schemaVersion: 1,
    });
    await mkdir(join(dataDir, "scenes"), { recursive: true });
    const scenePath = join(dataDir, "scenes", "7.md");
    await writeFile(scenePath, before);

    const script = join(deployDir, "migrations", "002-rewrite-link-schemes.sh");
    const { stdout, stderr } = await execFileAsync("sh", [script], {
      env: { ...process.env, PROSEDEN_DATA: dataDir },
    });
    expect(stderr).toBe("");
    expect(stdout).toMatch(/rewrote 1 file\(s\)/);

    const after = await readFile(scenePath, "utf8");
    expect(after).toBe(expected);

    const parsedBefore = parseProseDocument(before);
    const parsedAfter = parseProseDocument(after);
    expect(parsedAfter.meta).toEqual(parsedBefore.meta);
    expect(Object.keys(parsedAfter.details)).toEqual(["card", "lintel"]);
    expect(Object.keys(parsedAfter.details)).toEqual(Object.keys(parsedBefore.details));
    expect(after.split("\n")).toHaveLength(before.split("\n").length);
  });

  it("fails when meta.json is missing and does not re-seed", async () => {
    const result = await runMigrate(dataDir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/meta\.json missing/);
    const listing = await readFile(join(dataDir, "meta.json"), "utf8").catch(() => null);
    expect(listing).toBeNull();
  });
});

describe("schemaVersion round-trip", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-meta-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("preserves schemaVersion across saveMeta and does not invent it", async () => {
    await writeMeta(dataDir, {
      nextSceneId: 2,
      nextArtefactId: 1,
      nextGroupId: 1,
      nextEntranceGroupId: 1,
      entranceSceneId: 1,
      schemaVersion: 1,
    });

    const stamped = new WorldStore(dataDir);
    await stamped.load();
    expect(stamped.meta.schemaVersion).toBe(1);
    await stamped.createGroup({ owner: "alice", title: "Keepers" });
    expect((await readMeta(dataDir)).schemaVersion).toBe(1);

    const unmarkedDir = await mkdtemp(join(tmpdir(), "proseden-meta-v0-"));
    try {
      await writeMeta(unmarkedDir, {
        nextSceneId: 2,
        nextArtefactId: 1,
        nextGroupId: 1,
        nextEntranceGroupId: 1,
        entranceSceneId: 1,
      });
      const unmarked = new WorldStore(unmarkedDir);
      await unmarked.load();
      expect(unmarked.meta.schemaVersion).toBeUndefined();
      await unmarked.createGroup({ owner: "alice", title: "Keepers" });
      expect((await readMeta(unmarkedDir)).schemaVersion).toBeUndefined();
    } finally {
      await rm(unmarkedDir, { recursive: true, force: true });
    }
  });
});
