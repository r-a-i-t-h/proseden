import { createHash, randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hashSessionToken, SessionStore, SESSION_HANDOFF_FILE } from "../src/auth/sessions.js";

describe("session handoff", () => {
  let dir: string;
  let file: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function tmpFile(): Promise<string> {
    dir = await mkdtemp(join(tmpdir(), "proseden-sessions-"));
    file = join(dir, SESSION_HANDOFF_FILE);
    return file;
  }

  it("rehydrates a dumped token and wipes the handoff file", async () => {
    const path = await tmpFile();
    const live = new SessionStore(path);
    const session = live.create("alice");
    await live.dump();

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain(session.token);
    const parsed = JSON.parse(raw) as {
      sessions: Array<{ tokenHash: string; username: string }>;
    };
    expect(parsed.sessions).toEqual([
      expect.objectContaining({
        tokenHash: hashSessionToken(session.token),
        username: "alice",
      }),
    ]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);

    const restored = await SessionStore.load(path);
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(restored.get(session.token)?.username).toBe("alice");
    expect(restored.get(session.token)?.token).toBe(session.token);
  });

  it("drops a cookie that was never presented between two dumps", async () => {
    const path = await tmpFile();
    const first = new SessionStore(path);
    const session = first.create("alice");
    await first.dump();

    const second = await SessionStore.load(path);
    await second.dump();

    const third = await SessionStore.load(path);
    expect(third.get(session.token)).toBeUndefined();
  });

  it("destroy removes a not-yet-rehydrated fallback hit", async () => {
    const path = await tmpFile();
    const live = new SessionStore(path);
    const session = live.create("alice");
    await live.dump();

    const restored = await SessionStore.load(path);
    restored.destroy(session.token);
    expect(restored.get(session.token)).toBeUndefined();
  });

  it("ignores expired rows and a missing file", async () => {
    const path = await tmpFile();
    const token = randomBytes(32).toString("hex");
    await writeFile(
      path,
      JSON.stringify({
        sessions: [
          {
            tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
            username: "alice",
            createdAt: "2000-01-01T00:00:00.000Z",
            expiresAt: "2000-01-02T00:00:00.000Z",
          },
        ],
      }),
    );
    const expired = await SessionStore.load(path);
    expect(expired.get(token)).toBeUndefined();

    const missing = await SessionStore.load(join(dir, "nope.json"));
    expect(missing.get(token)).toBeUndefined();
  });

  it("treats a malformed handoff as empty and still deletes it", async () => {
    const path = await tmpFile();
    await writeFile(path, "not json");
    const store = await SessionStore.load(path);
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(store.get("anything")).toBeUndefined();
  });
});
