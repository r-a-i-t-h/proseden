import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeJsonAtomic, writeTextAtomic } from "../src/store/fs.js";

describe("writeTextAtomic", () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("survives many concurrent writers to the same path", async () => {
    dir = await mkdtemp(join(tmpdir(), "proseden-fs-atomic-"));
    const path = join(dir, "users", "raith.json");
    const writers = Array.from({ length: 40 }, (_, i) =>
      writeJsonAtomic(path, { username: "raith", n: i }),
    );
    await expect(Promise.all(writers)).resolves.toBeDefined();
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { username: string; n: number };
    expect(parsed.username).toBe("raith");
    expect(parsed.n).toBeGreaterThanOrEqual(0);
    expect(parsed.n).toBeLessThan(40);
  });

  it("creates parent directories", async () => {
    dir = await mkdtemp(join(tmpdir(), "proseden-fs-mkdir-"));
    const path = join(dir, "a", "b", "c.txt");
    await writeTextAtomic(path, "ok\n");
    expect(await readFile(path, "utf8")).toBe("ok\n");
  });
});
