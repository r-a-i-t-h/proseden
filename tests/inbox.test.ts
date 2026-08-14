import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

type App = ReturnType<typeof createApp>;

async function createTestWorld(): Promise<{
  world: WorldStore;
  app: App;
  dataDir: string;
  tokens: Record<string, string>;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-inbox-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol"]) {
    await world.createUser(name, password.hash, password.salt);
  }

  // alice owns public hall (1) and private study (2)
  await world.createScene({
    owner: "alice",
    title: "Public Hall",
    body: "A public hall.",
    visibility: "public",
  });
  await world.createScene({
    owner: "alice",
    title: "Private Study",
    body: "Alice's study.",
    visibility: "private",
  });
  // bob owns a garden (3)
  await world.createScene({
    owner: "bob",
    title: "Bob Garden",
    body: "Bob's garden.",
    visibility: "public",
  });

  // carol may manage alice's hall (self-sufficient work), but not act on inbox
  await world.updateSceneAccess(1, {
    grants: [{ who: "carol", rights: ["manage"] }],
  });

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol"]) {
    tokens[name] = sessions.create(name).token;
  }

  const app = createApp({ world, sessions });
  return { world, app, dataDir, tokens };
}

function auth(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

describe("inbox / exit requests", () => {
  let world: WorldStore;
  let app: App;
  let dataDir: string;
  let tokens: Record<string, string>;

  beforeEach(async () => {
    ({ world, app, dataDir, tokens } = await createTestWorld());
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("rejects unauthenticated create and inbox", async () => {
    const create = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "garden", toSceneId: 3 }),
    });
    expect(create.status).toBe(401);

    const inbox = await app.request("/inbox", { headers: { Accept: "application/json" } });
    expect(inbox.status).toBe(401);
  });

  it("forbids request when caller can already add exits", async () => {
    // carol has manage on hall
    const res = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.carol),
      body: JSON.stringify({ nickname: "garden", toSceneId: 3 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/directly/i);
  });

  it("creates an owner-only exit request", async () => {
    const res = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: 3, note: "Please link us." }),
    });
    expect(res.status).toBe(201);
    const msg = await res.json();
    expect(msg.type).toBe("exit_request");
    expect(msg.toUser).toBe("alice");
    expect(msg.fromUser).toBe("bob");
    expect(msg.nickname).toBe("garden");
    expect(msg.body).toContain("Please link us.");

    const aliceInbox = await app.request("/inbox", { headers: auth(tokens.alice) });
    expect(aliceInbox.status).toBe(200);
    const alice = await aliceInbox.json();
    expect(alice.messages).toHaveLength(1);
    expect(alice.messages[0].id).toBe(msg.id);

    const carolInbox = await app.request("/inbox", { headers: auth(tokens.carol) });
    const carol = await carolInbox.json();
    expect(carol.messages).toHaveLength(0);

    const bobInbox = await app.request("/inbox", { headers: auth(tokens.bob) });
    const bob = await bobInbox.json();
    expect(bob.messages).toHaveLength(0);
  });

  it("rejects destination the requester does not own", async () => {
    const res = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "study", toSceneId: 2 }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects duplicate pending requests", async () => {
    const first = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "Garden", toSceneId: 3 }),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: 3 }),
    });
    expect(second.status).toBe(400);
  });

  it("confirm adds exit, removes request, and notifies requester", async () => {
    const created = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: 3 }),
    });
    const msg = await created.json();

    // manage grantee cannot confirm
    const carolTry = await app.request(`/inbox/${msg.id}/confirm`, {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(carolTry.status).toBe(404);

    const confirm = await app.request(`/inbox/${msg.id}/confirm`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    expect(confirm.status).toBe(200);
    const result = await confirm.json();
    expect(result.exit.nickname).toBe("garden");
    expect(result.exit.toSceneId).toBe(3);
    expect(result.notice.type).toBe("notice");
    expect(result.notice.toUser).toBe("bob");

    expect(world.findExit(1, "garden")?.toSceneId).toBe(3);
    expect(world.getInboxMessage(msg.id)).toBeUndefined();
    expect(world.listInboxFor("bob")).toHaveLength(1);
    expect(world.listInboxFor("alice")).toHaveLength(0);
  });

  it("delete removes without creating an exit", async () => {
    const created = await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: 3 }),
    });
    const msg = await created.json();

    const del = await app.request(`/inbox/${msg.id}/delete`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    expect(del.status).toBe(200);
    expect(world.findExit(1, "garden")).toBeUndefined();
    expect(world.listInboxFor("alice")).toHaveLength(0);
    expect(world.listInboxFor("bob")).toHaveLength(0);
  });

  it("shows inbox count in the header", async () => {
    await app.request("/s/1/exit-requests", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: 3 }),
    });

    const page = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Inbox (1)");
    expect(html).toContain("Exit request: garden");
    expect(html).toContain("Confirm");
  });
});
