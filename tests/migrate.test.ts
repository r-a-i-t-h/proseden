import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorldStore } from "../src/store/world.js";

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

describe("schema migrate runner", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-migrate-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("001 stamps schemaVersion 1 and keeps other meta keys", async () => {
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

    const meta = await readMeta(dataDir);
    expect(meta.schemaVersion).toBe(1);
    expect(meta.nextSceneId).toBe(4);
    expect(meta.nextArtefactId).toBe(2);
    expect(meta.nextGroupId).toBe(2);
    expect(meta.entranceSceneId).toBe(1);
    expect(meta.extra).toBe("keep-me");
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
    expect(second.stdout).toMatch(/already at schema 1/);
    expect(second.stdout).not.toMatch(/applying/);
    expect(await readFile(join(dataDir, "meta.json"), "utf8")).toBe(afterFirst);
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
