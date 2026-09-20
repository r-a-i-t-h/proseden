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
  ids: { publicHall: number; privateStudy: number; bobGarden: number };
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-inbox-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol"]) {
    await world.createUser(name, password.hash, password.salt);
  }

  // alice owns public hall and private study; bob owns a garden
  const publicHall = await world.createScene({
    owner: "alice",
    title: "Public Hall",
    body: "A public hall.",
    visibility: "public",
  });
  const privateStudy = await world.createScene({
    owner: "alice",
    title: "Private Study",
    body: "Alice's study.",
    visibility: "private",
  });
  const bobGarden = await world.createScene({
    owner: "bob",
    title: "Bob Garden",
    body: "Bob's garden.",
    visibility: "public",
  });

  await world.updateSceneAccess(publicHall.id, {
    grants: [{ who: "carol", rights: ["manage"] }],
  });

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol"]) {
    tokens[name] = sessions.create(name).token;
  }

  const app = createApp({ world, sessions });
  const ids = {
    publicHall: publicHall.id,
    privateStudy: privateStudy.id,
    bobGarden: bobGarden.id,
  };
  return { world, app, dataDir, tokens, ids };
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
  let ids: { publicHall: number; privateStudy: number; bobGarden: number };

  beforeEach(async () => {
    ({ world, app, dataDir, tokens, ids } = await createTestWorld());
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("rejects unauthenticated create and inbox", async () => {
    const create = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "garden", toSceneId: ids.bobGarden }),
    });
    expect(create.status).toBe(401);

    const inbox = await app.request("/inbox", { headers: { Accept: "application/json" } });
    expect(inbox.status).toBe(401);
  });

  it("forbids request when caller can already add exits", async () => {
    // carol has manage on hall
    const res = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.carol),
      body: JSON.stringify({ nickname: "garden", toSceneId: ids.bobGarden }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/directly/i);
  });

  it("creates an owner-only exit request", async () => {
    const res = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: ids.bobGarden, note: "Please link us." }),
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
    const res = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "study", toSceneId: ids.privateStudy }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects duplicate pending requests", async () => {
    const first = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "Garden", toSceneId: ids.bobGarden }),
    });
    expect(first.status).toBe(201);

    const second = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: ids.bobGarden }),
    });
    expect(second.status).toBe(400);
  });

  it("confirm adds exit, removes request, and notifies requester", async () => {
    const created = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: ids.bobGarden }),
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
    expect(result.exit.toSceneId).toBe(ids.bobGarden);
    expect(result.notice.type).toBe("notice");
    expect(result.notice.toUser).toBe("bob");

    expect(world.findExit(ids.publicHall, "garden")?.toSceneId).toBe(ids.bobGarden);
    expect(world.getInboxMessage(msg.id)).toBeUndefined();
    expect(world.listInboxFor("bob")).toHaveLength(1);
    expect(world.listInboxFor("alice")).toHaveLength(0);
  });

  it("delete removes without creating an exit", async () => {
    const created = await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: ids.bobGarden }),
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
    await app.request(`/s/${ids.publicHall}/exit-requests`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ nickname: "garden", toSceneId: ids.bobGarden }),
    });

    const page = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Messages (1)");
    expect(html).toContain("<h1>Messages</h1>");
    expect(html).toContain("Exit request: garden");
    expect(html).toContain("Confirm");
  });
});

describe("inbox / view invites", () => {
  let world: WorldStore;
  let app: App;
  let dataDir: string;
  let tokens: Record<string, string>;
  let ids: { publicHall: number; privateStudy: number; bobGarden: number };

  beforeEach(async () => {
    ({ world, app, dataDir, tokens, ids } = await createTestWorld());
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("rejects unauthenticated invites", async () => {
    const res = await app.request(`/s/${ids.publicHall}/view-invites`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "alice" }),
    });
    expect(res.status).toBe(401);
  });

  it("creates an invite from a scene you do not own", async () => {
    const res = await app.request(`/s/${ids.publicHall}/view-invites`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "carol" }),
    });
    expect(res.status).toBe(201);
    const msg = await res.json();
    expect(msg.type).toBe("invite_to_view");
    expect(msg.toUser).toBe("carol");
    expect(msg.fromUser).toBe("bob");
    expect(msg.sceneId).toBe(ids.publicHall);
    expect(msg.body).toBe(
      "bob has invited you to view the scene, Public Hall. It's either new or has been updated recently.",
    );

    const carolInbox = await app.request("/inbox", { headers: auth(tokens.carol) });
    const carol = await carolInbox.json();
    expect(carol.messages).toHaveLength(1);
    expect(carol.messages[0].id).toBe(msg.id);

    const aliceInbox = await app.request("/inbox", { headers: auth(tokens.alice) });
    expect((await aliceInbox.json()).messages).toHaveLength(0);
  });

  it("rejects inviting yourself, a missing user, or an unreachable scene", async () => {
    const self = await app.request(`/s/${ids.publicHall}/view-invites`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "bob" }),
    });
    expect(self.status).toBe(400);

    const missing = await app.request(`/s/${ids.publicHall}/view-invites`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "nobody" }),
    });
    expect(missing.status).toBe(404);

    const privateScene = await app.request(`/s/${ids.privateStudy}/view-invites`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "carol" }),
    });
    expect(privateScene.status).toBe(403);
  });

  it("refreshes a pending invite instead of stacking a duplicate", async () => {
    const first = await app.request(`/s/${ids.publicHall}/view-invites`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "carol" }),
    });
    expect(first.status).toBe(201);
    const original = await first.json();

    const second = await app.request(`/s/${ids.publicHall}/view-invites`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "carol" }),
    });
    expect(second.status).toBe(200);
    const refreshed = await second.json();
    expect(refreshed.id).toBe(original.id);
    expect(world.listInboxFor("carol")).toHaveLength(1);
  });

  it("shows the invite in the inbox HTML with a scene link", async () => {
    await app.request(`/s/${ids.bobGarden}/view-invites`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ uid: "bob" }),
    });

    const page = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Messages (1)");
    expect(html).toContain("Invite to view: Bob Garden");
    expect(html).toContain("alice has invited you to view the scene, Bob Garden.");
    expect(html).toContain(`href="s/${ids.bobGarden}"`);
    expect(html).toContain("View scene");
    expect(html).not.toContain("Confirm");
  });
});

describe("inbox / peer messages", () => {
  let world: WorldStore;
  let app: App;
  let dataDir: string;
  let tokens: Record<string, string>;
  let ids: { publicHall: number; privateStudy: number; bobGarden: number };

  beforeEach(async () => {
    ({ world, app, dataDir, tokens, ids } = await createTestWorld());
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("sends a peer message and shows compose on the Messages page", async () => {
    const page = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html = await page.text();
    expect(html).toContain("<h1>Messages</h1>");
    expect(html).toContain("<h2>Inbox</h2>");
    expect(html).toContain("Compose");
    expect(html).toContain('action="inbox/send"');
    expect(html).toContain("<details");
    expect(html).toContain('name="uid"');
    expect(html).not.toContain('name="subject"');
    expect(html).not.toContain('name="to"');

    const res = await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({
        uid: "alice",
        body: "Please *see* the hall.",
      }),
    });
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.message.type).toBe("message");
    expect(payload.message.toUser).toBe("alice");
    expect(payload.message.fromUser).toBe("bob");
    expect(payload.message.subject).toBe("Personal message from bob");

    const aliceInbox = await app.request("/inbox", { headers: auth(tokens.alice) });
    const alice = await aliceInbox.json();
    expect(alice.peerMessagingEnabled).toBe(true);
    expect(alice.messages).toHaveLength(1);
    expect(alice.messages[0].type).toBe("message");

    const aliceHtml = await (
      await app.request("/inbox", {
        headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
      })
    ).text();
    expect(aliceHtml).toContain("Personal message from bob");
    expect(aliceHtml).toContain("<strong>see</strong>");
    expect(aliceHtml).toContain('href="inbox?to=bob"');
    expect(aliceHtml).toContain("Reply");
  });

  it("sets a fixed subject and rejects self, missing user, empty body", async () => {
    const ok = await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "alice", body: "Hi" }),
    });
    expect(ok.status).toBe(201);
    expect((await ok.json()).message.subject).toBe("Personal message from bob");

    const self = await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "bob", body: "Nope" }),
    });
    expect(self.status).toBe(400);

    const missing = await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "nobody", body: "Nope" }),
    });
    expect(missing.status).toBe(404);

    const empty = await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "alice", body: "  " }),
    });
    expect(empty.status).toBe(400);
  });

  it("offers Reply only on peer messages, not manager notices", async () => {
    await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "alice", body: "Peer note" }),
    });
    await world.createInboxMessage({
      type: "notice",
      toUser: "alice",
      fromUser: "carol",
      subject: "Manager message from carol",
      body: "Staff note",
    });

    const html = await (
      await app.request("/inbox", {
        headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
      })
    ).text();
    expect(html).toContain('href="inbox?to=bob"');
    expect(html).not.toContain('href="inbox?to=carol"');
  });

  it("blocks peer send when messaging is disabled", async () => {
    await world.setPeerMessagingEnabled(false);
    const res = await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "alice", body: "Hi" }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/disabled/i);

    const page = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html = await page.text();
    expect(html).not.toContain('action="inbox/send"');
    expect(html).toContain("<h1>Messages</h1>");
  });
});
