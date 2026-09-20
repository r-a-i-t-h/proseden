import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { SSE_CONNECT_PADDING_BYTES } from "../src/live/types.js";
import { WorldStore } from "../src/store/world.js";

describe("request timing", () => {
  let dataDir: string;
  let world: WorldStore;
  let app: ReturnType<typeof createApp>;
  let sceneId: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-observe-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    const hall = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "A stone hall.",
      visibility: "public",
    });
    sceneId = hall.id;
    app = createApp({ world, sessions: new SessionStore() });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("GET /health stays ok and includes process fields", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.name).toBe("proseden");
    expect(typeof body.uptimeSec).toBe("number");
    expect(typeof body.rssMb).toBe("number");
    expect(typeof body.lagP99Ms).toBe("number");
    expect(typeof body.lagMaxMs).toBe("number");
  });

  it("sets Server-Timing on ordinary GET responses", async () => {
    const health = await app.request("/health");
    expect(health.headers.get("server-timing")).toMatch(/app;dur=/);

    const page = await app.request(`/s/${sceneId}`, {
      headers: { Accept: "text/html" },
    });
    expect(page.status).toBe(200);
    const timing = page.headers.get("server-timing") ?? "";
    expect(timing).toMatch(/app;dur=/);
    expect(timing).toContain("ownedScenes");
    expect(timing).toContain("render");
  });

  it("does not set Server-Timing on /live/events", async () => {
    const res = await app.request(`/live/events?scene=${sceneId}`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("server-timing")).toBeNull();

    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !buf.includes("presence.snapshot")) {
      const { value, done } = await reader!.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
    }
    await reader!.cancel();
    expect(buf.startsWith(`:${" ".repeat(SSE_CONNECT_PADDING_BYTES)}\n\n`)).toBe(true);
  });
});
