import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("dashboard", () => {
  let dataDir: string;
  let world: WorldStore;
  let app: ReturnType<typeof createApp>;
  let managerToken: string;
  let userToken: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-dashboard-"));
    world = new WorldStore(dataDir);
    await world.load();

    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    const hall = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "A stone hall.",
      visibility: "public",
    });
    const study = await world.createScene({
      owner: "alice",
      title: "Study",
      body: "A quiet study.",
      visibility: "public",
    });
    await world.addExit(hall.id, "study", study.id);
    await world.createArtefact({
      owner: "alice",
      homeSceneId: hall.id,
      title: "Lamp",
      body: "A brass lamp.",
    });
    await world.createGroup({ owner: "alice", title: "Keepers" });
    await world.createEntranceGroup({
      title: "The Wing",
      entranceSceneId: hall.id,
      sceneIds: [hall.id, study.id],
    });
    await world.setStaffRoles("alice", ["manager"]);

    const sessions = new SessionStore();
    managerToken = sessions.create("alice").token;
    userToken = sessions.create("bob").token;
    app = createApp({ world, sessions });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function auth(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
  }

  it("requires a manager", async () => {
    const anon = await app.request("/dashboard", {
      headers: { Accept: "application/json" },
    });
    expect(anon.status).toBe(401);

    const user = await app.request("/dashboard", { headers: auth(userToken) });
    expect(user.status).toBe(403);
  });

  it("returns world counts for managers", async () => {
    const res = await app.request("/dashboard", { headers: auth(managerToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      users: 2,
      scenes: 4,
      artefacts: 1,
      exits: 1,
      groups: 1,
      entranceGroups: 1,
      staff: 1,
      online: 0,
      sseConnections: 0,
    });
    expect(typeof body.rssMb).toBe("number");
    expect(typeof body.lagP99Ms).toBe("number");
    expect(typeof body.lagMaxMs).toBe("number");
    expect(typeof body.uptimeSec).toBe("number");
    expect(Array.isArray(body.slowRequests)).toBe(true);
    expect(typeof body.slowMs).toBe("number");
  });

  it("renders HTML and text overviews", async () => {
    const htmlRes = await app.request("/dashboard", {
      headers: { Authorization: `Bearer ${managerToken}`, Accept: "text/html" },
    });
    expect(htmlRes.status).toBe(200);
    const html = await htmlRes.text();
    expect(html).toContain("<h1>Dashboard</h1>");
    expect(html).toContain("<dt>Users</dt><dd>2</dd>");
    expect(html).toContain("<dt>Scenes</dt><dd>4</dd>");
    expect(html).toContain("<dt>Artefacts</dt><dd>1</dd>");
    expect(html).toContain('href="staff">Staff</a>');
    expect(html).toContain("<h2>Process</h2>");
    expect(html).toContain("<dt>RSS (MB)</dt>");
    expect(html).toContain("<dt>Event-loop p99 (ms)</dt>");
    expect(html).toContain("<h2>Recent slow requests</h2>");

    const textRes = await app.request("/dashboard", {
      headers: { Authorization: `Bearer ${managerToken}`, Accept: "text/plain" },
    });
    expect(textRes.status).toBe(200);
    const text = await textRes.text();
    expect(text).toContain("[Dashboard]");
    expect(text).toContain("Users: 2");
    expect(text).toContain("Scenes: 4");
    expect(text).toContain("Artefacts: 1");
    expect(text).toContain("Staff: 1  /staff");
    expect(text).toContain("Process:");
    expect(text).toContain("RSS (MB):");
    expect(text).toContain("Recent slow requests:");
  });
});
