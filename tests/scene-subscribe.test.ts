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
  ids: { publicHall: number; privateStudy: number };
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-subs-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol"]) {
    await world.createUser(name, password.hash, password.salt);
  }

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

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol"]) {
    tokens[name] = sessions.create(name).token;
  }

  const app = createApp({ world, sessions });
  const ids = { publicHall: publicHall.id, privateStudy: privateStudy.id };
  return { world, app, dataDir, tokens, ids };
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
  let ids: { publicHall: number; privateStudy: number };

  beforeEach(async () => {
    ({ world, app, dataDir, tokens, ids } = await createTestWorld());
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("toggles subscription and persists sidecars", async () => {
    const sub = await app.request(`/s/${ids.publicHall}/subscribe`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(sub.status).toBe(200);
    const body = await sub.json();
    expect(body.subscribed).toBe(true);
    expect(body.subscribers).toContain("bob");
    expect(world.isSubscribed(ids.publicHall, "bob")).toBe(true);

    const drop = await app.request(`/s/${ids.publicHall}/subscribe/drop`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(drop.status).toBe(200);
    expect((await drop.json()).subscribed).toBe(false);
    expect(world.isSubscribed(ids.publicHall, "bob")).toBe(false);
  });

  it("rejects unauthenticated and unreachable subscribe", async () => {
    const anon = await app.request(`/s/${ids.publicHall}/subscribe`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
    });
    expect(anon.status).toBe(401);

    const privateScene = await app.request(`/s/${ids.privateStudy}/subscribe`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(privateScene.status).toBe(403);
  });

  it("notifies on title/description/details and merges kinds", async () => {
    await world.subscribeScene(ids.publicHall, "bob");

    await app.request(`/s/${ids.publicHall}`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ title: "Hall Renamed", body: "A public hall." }),
    });
    let inbox = world.listInboxFor("bob");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("scene_update");
    if (inbox[0].type === "scene_update") {
      expect(inbox[0].sceneId).toBe(ids.publicHall);
      expect(inbox[0].changeKinds).toEqual(["title"]);
      expect(inbox[0].subject).toBe("Subscribed scene change: Hall Renamed");
      expect(inbox[0].body).toBe("Changed: title");
    }

    await app.request(`/s/${ids.publicHall}`, {
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
    await world.subscribeScene(ids.publicHall, "alice");
    await world.subscribeScene(ids.publicHall, "bob");

    await app.request(`/s/${ids.publicHall}`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ title: "Public Hall", body: "Edited by alice.", visibility: "public" }),
    });
    expect(world.listInboxFor("alice")).toHaveLength(0);
    expect(world.listInboxFor("bob")).toHaveLength(1);

    const before = world.listInboxFor("bob").length;
    await app.request(`/s/${ids.publicHall}`, {
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

    await world.updateScene(ids.publicHall, { visibility: "public" }, { by: "alice" });
    expect(world.listInboxFor("bob").length).toBe(before);

    await app.request(`/s/${ids.publicHall}/exits`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ nickname: "study", toSceneId: ids.privateStudy }),
    });
    expect(world.listInboxFor("bob").length).toBe(before);

    await app.request(`/s/${ids.publicHall}/access`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ grants: [{ who: "carol", rights: ["read"] }] }),
    });
    expect(world.listInboxFor("bob").length).toBe(before);
  });

  it("notifies on artefact create/update/delete", async () => {
    await world.subscribeScene(ids.publicHall, "bob");

    const created = await app.request("/a", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({
        homeSceneId: ids.publicHall,
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
    await world.updateSceneAccess(ids.publicHall, {
      grants: [{ who: "bob", rights: ["read"] }],
    });
    await world.updateScene(ids.publicHall, { visibility: "private" }, { by: "alice" });
    await world.subscribeScene(ids.publicHall, "bob");

    await world.updateSceneAccess(ids.publicHall, { grants: [] });
    await world.updateScene(ids.publicHall, { body: "Still private." }, { by: "alice" });

    expect(world.listInboxFor("bob")).toHaveLength(0);
    expect(world.isSubscribed(ids.publicHall, "bob")).toBe(false);
  });

  it("removes subs file when scene is deleted", async () => {
    await world.subscribeScene(ids.publicHall, "bob");
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
    const res = await app.request(`/s/${ids.publicHall}`, {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain(">Subscribe</button>");
    expect(html).toContain(`action="s/${ids.publicHall}/subscribe"`);
    expect(html).toContain("0 subscribers");

    await world.subscribeScene(ids.publicHall, "bob");
    await world.subscribeScene(ids.publicHall, "carol");
    const again = await app.request(`/s/${ids.publicHall}`, {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html2 = await again.text();
    expect(html2).toContain(">Unsubscribe</button>");
    expect(html2).toContain(`action="s/${ids.publicHall}/subscribe/drop"`);
    expect(html2).toContain("2 subscribers");
  });

  it("renders scene_update in the inbox", async () => {
    await world.subscribeScene(ids.publicHall, "bob");
    await world.updateScene(ids.publicHall, { title: "Ping" }, { by: "alice" });

    const res = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("Subscribed scene change: Ping");
    expect(html).toContain("Changed: title");
    expect(html).toContain(`href="s/${ids.publicHall}">View scene</a>`);
  });
});
