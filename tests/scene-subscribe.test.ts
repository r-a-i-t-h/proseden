import { access, mkdtemp, rm } from "node:fs/promises";
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
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-subs-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol"]) {
    await world.createUser(name, password.hash, password.salt);
  }

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

describe("scene subscriptions", () => {
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

  it("toggles subscription and persists sidecars", async () => {
    const sub = await app.request("/s/1/subscribe", {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(sub.status).toBe(200);
    const body = await sub.json();
    expect(body.subscribed).toBe(true);
    expect(body.subscribers).toContain("bob");
    expect(world.isSubscribed(1, "bob")).toBe(true);

    const drop = await app.request("/s/1/subscribe/drop", {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(drop.status).toBe(200);
    expect((await drop.json()).subscribed).toBe(false);
    expect(world.isSubscribed(1, "bob")).toBe(false);
  });

  it("rejects unauthenticated and unreachable subscribe", async () => {
    const anon = await app.request("/s/1/subscribe", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    expect(anon.status).toBe(401);

    const privateScene = await app.request("/s/2/subscribe", {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(privateScene.status).toBe(403);
  });

  it("notifies on title/description/details and merges kinds", async () => {
    await world.subscribeScene(1, "bob");

    await app.request("/s/1", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ title: "Hall Renamed", body: "A public hall." }),
    });
    let inbox = world.listInboxFor("bob");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("scene_update");
    if (inbox[0].type === "scene_update") {
      expect(inbox[0].sceneId).toBe(1);
      expect(inbox[0].changeKinds).toEqual(["title"]);
      expect(inbox[0].subject).toBe("Subscribed scene change: Hall Renamed");
      expect(inbox[0].body).toBe("Changed: title");
    }

    await app.request("/s/1", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({
        title: "Hall Renamed",
        body: "Rewritten prose.",
        detailsJson: JSON.stringify({ plaque: "brass" }),
      }),
    });
    inbox = world.listInboxFor("bob");
    expect(inbox).toHaveLength(1);
    if (inbox[0].type === "scene_update") {
      expect(inbox[0].changeKinds).toEqual(["title", "description", "details"]);
      expect(inbox[0].body).toBe("Changed: title, description, details");
    }
  });

  it("skips the editor and does not notify on visibility/exits/ACL", async () => {
    await world.subscribeScene(1, "alice");
    await world.subscribeScene(1, "bob");

    await app.request("/s/1", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ title: "Public Hall", body: "Edited by alice.", visibility: "public" }),
    });
    expect(world.listInboxFor("alice")).toHaveLength(0);
    expect(world.listInboxFor("bob")).toHaveLength(1);

    const before = world.listInboxFor("bob").length;
    await app.request("/s/1", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({
        title: "Public Hall",
        body: "Edited by alice.",
        visibility: "private",
      }),
    });
    // Visibility-only: body/title unchanged → no new kinds beyond coalesce of prior notice.
    // Re-save with same prose after visibility flip: if only visibility changed, no notify.
    expect(world.listInboxFor("bob").length).toBe(before);

    await world.updateScene(1, { visibility: "public" }, { by: "alice" });
    expect(world.listInboxFor("bob").length).toBe(before);

    await app.request("/s/1/exits", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ nickname: "study", toSceneId: 2 }),
    });
    expect(world.listInboxFor("bob").length).toBe(before);

    await app.request("/s/1/access", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ grants: [{ who: "carol", rights: ["read"] }] }),
    });
    expect(world.listInboxFor("bob").length).toBe(before);
  });

  it("notifies on artefact create/update/delete", async () => {
    await world.subscribeScene(1, "bob");

    const created = await app.request("/a", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({
        homeSceneId: 1,
        title: "Lamp",
        body: "A brass lamp.",
      }),
    });
    expect(created.status).toBe(201);
    const art = await created.json();
    let inbox = world.listInboxFor("bob");
    expect(inbox).toHaveLength(1);
    if (inbox[0].type === "scene_update") {
      expect(inbox[0].changeKinds).toEqual(["artefacts"]);
    }

    await app.request(`/a/${art.id}`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ title: "Lamp", body: "Polished." }),
    });
    inbox = world.listInboxFor("bob");
    expect(inbox).toHaveLength(1);
    if (inbox[0].type === "scene_update") {
      expect(inbox[0].changeKinds).toEqual(["artefacts"]);
    }

    await app.request(`/a/${art.id}/delete`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    inbox = world.listInboxFor("bob");
    expect(inbox).toHaveLength(1);
  });

  it("prunes subscribers who lost read access", async () => {
    await world.updateSceneAccess(1, {
      grants: [{ who: "bob", rights: ["read"] }],
    });
    await world.updateScene(1, { visibility: "private" }, { by: "alice" });
    await world.subscribeScene(1, "bob");

    await world.updateSceneAccess(1, { grants: [] });
    await world.updateScene(1, { body: "Still private." }, { by: "alice" });

    expect(world.listInboxFor("bob")).toHaveLength(0);
    expect(world.isSubscribed(1, "bob")).toBe(false);
  });

  it("removes subs file when scene is deleted", async () => {
    await world.subscribeScene(1, "bob");
    const scene = await world.createScene({
      owner: "alice",
      title: "Temp",
      body: "Temp.",
      visibility: "public",
    });
    await world.subscribeScene(scene.id, "bob");
    const subsPath = join(dataDir, "scenes", `${scene.id}.subs.json`);
    await access(subsPath);

    await world.deleteScene(scene.id);
    await expect(access(subsPath)).rejects.toThrow();
    expect(world.getSubscribers(scene.id)).toEqual([]);
  });

  it("shows subscribe control when signed in", async () => {
    const res = await app.request("/s/1", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain(">Subscribe</button>");
    expect(html).toContain(`action="s/1/subscribe"`);

    await world.subscribeScene(1, "bob");
    const again = await app.request("/s/1", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html2 = await again.text();
    expect(html2).toContain(">Unsubscribe</button>");
    expect(html2).toContain(`action="s/1/subscribe/drop"`);
  });

  it("renders scene_update in the inbox", async () => {
    await world.subscribeScene(1, "bob");
    await world.updateScene(1, { title: "Ping" }, { by: "alice" });

    const res = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("Subscribed scene change: Ping");
    expect(html).toContain("Changed: title");
    expect(html).toContain('href="s/1">View scene</a>');
  });
});
