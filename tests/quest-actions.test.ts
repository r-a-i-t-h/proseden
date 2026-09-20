import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

type App = ReturnType<typeof createApp>;

async function createActionWorld(): Promise<{
  world: WorldStore;
  app: App;
  dataDir: string;
  tokens: Record<string, string>;
  hallId: number;
  innerId: number;
  entranceId: number;
  lampId: number;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-qact-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob"]) {
    await world.createUser(name, password.hash, password.salt);
  }

  const hall = await world.createScene({
    owner: "alice",
    title: "Hall",
    body: "A public hall.",
    visibility: "public",
  });
  const entrance = await world.createScene({
    owner: "alice",
    title: "Wing Entrance",
    body: "You may enter here.",
    visibility: "private",
  });
  const inner = await world.createScene({
    owner: "alice",
    title: "Inner Chamber",
    body: "Deeper inside.",
    visibility: "private",
  });
  await world.updateSceneAccess(entrance.id, {
    grants: [{ who: "bob", rights: ["read"] }],
  });
  await world.updateSceneAccess(inner.id, {
    grants: [{ who: "bob", rights: ["read"] }],
  });
  await world.createEntranceGroup({
    title: "Wing",
    entranceSceneId: entrance.id,
    sceneIds: [entrance.id, inner.id],
  });

  const lamp = await world.createArtefact({
    owner: "alice",
    homeSceneId: hall.id,
    title: "Lamp",
    body: "Brass.",
  });

  await world.saveQuest({
    name: "demo",
    title: "Demo",
    rules: [
      {
        id: "use-lamp",
        on: "use",
        ok: "The lamp flares.",
        when: { all: [{ use: lamp.id }, { atScene: hall.id }] },
        then: [{ setFlag: "demo.lit" }],
      },
      {
        id: "riddle",
        on: "input",
        ok: "The wall slides.",
        when: { all: [{ input: "open sesame" }, { atScene: hall.id }] },
        then: [{ setFlag: "demo.spoke" }],
      },
    ],
  });

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob"]) {
    tokens[name] = sessions.create(name).token;
  }

  const app = createApp({ world, sessions });
  return {
    world,
    app,
    dataDir,
    tokens,
    hallId: hall.id,
    innerId: inner.id,
    entranceId: entrance.id,
    lampId: lamp.id,
  };
}

function auth(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...extra,
  };
}

describe("quest Use and Input", () => {
  let harness: Awaited<ReturnType<typeof createActionWorld>>;

  beforeEach(async () => {
    harness = await createActionWorld();
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("forbids Use when the artefact is not held", async () => {
    const { app, tokens, lampId } = harness;
    const res = await app.request(`/a/${lampId}/use`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(res.status).toBe(403);
  });

  it("Use sets a flag when held at the matching scene", async () => {
    const { app, tokens, world, lampId, hallId } = harness;
    await world.collectArtefact("bob", lampId);
    await app.request(`/s/${hallId}`, { headers: auth(tokens.bob) });

    const res = await app.request(`/a/${lampId}/use`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toBe("The lamp flares.");
    expect(world.getUserFlags("bob")["demo.lit"]).toBe(true);
    expect(world.getUser("bob")?.inventory.some((i) => i.artefactId === lampId)).toBe(true);
  });

  it("Use does not fire on collect", async () => {
    const { world, lampId } = harness;
    await world.collectArtefact("bob", lampId);
    await world.evaluateQuestsForUser("bob", harness.hallId);
    expect(world.getUserFlags("bob")["demo.lit"]).toBeUndefined();
  });

  it("Input matches a folded phrase at the scene", async () => {
    const { app, tokens, world, hallId } = harness;
    const res = await app.request(`/s/${hallId}/input`, {
      method: "POST",
      headers: auth(tokens.bob, { "Content-Type": "application/json" }),
      body: JSON.stringify({ phrase: "  Open   SESAME " }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toBe("The wall slides.");
    expect(world.getUserFlags("bob")["demo.spoke"]).toBe(true);
  });

  it("Input refuses an interior entrance-group scene from outside", async () => {
    const { app, tokens, hallId, innerId } = harness;
    await app.request(`/s/${hallId}`, { headers: auth(tokens.bob) });
    const res = await app.request(`/s/${innerId}/input`, {
      method: "POST",
      headers: auth(tokens.bob, { "Content-Type": "application/json" }),
      body: JSON.stringify({ phrase: "open sesame" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects anonymous Input", async () => {
    const { app, hallId } = harness;
    const res = await app.request(`/s/${hallId}/input`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ phrase: "open sesame" }),
    });
    expect(res.status).toBe(401);
  });

  it("HTML Input redirects cleanly and shows ok as a notice", async () => {
    const { app, tokens, hallId } = harness;
    const res = await app.request(`/s/${hallId}/input`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.bob}`,
        Accept: "text/html",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phrase: "open sesame" }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(new RegExp(`/s/${hallId}$`));
    expect(location).not.toMatch(/[?&](input|input-error|ok|_action_message_)=/);

    const follow = await app.request(`/s/${hallId}`, {
      headers: {
        Authorization: `Bearer ${tokens.bob}`,
        Accept: "text/html",
      },
    });
    expect(follow.status).toBe(200);
    const html = await follow.text();
    expect(html).toContain("The wall slides.");
    expect(html).toContain('class="notice"');
    expect(html).not.toContain("No detail named");
    expect(html).toContain("A public hall.");
  });

  it("HTML Input miss shows Nothing happens. without detail collision", async () => {
    const { app, tokens, hallId } = harness;
    const res = await app.request(`/s/${hallId}/input`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.bob}`,
        Accept: "text/html",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phrase: "wrong guess" }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(new RegExp(`/s/${hallId}$`));

    const follow = await app.request(`/s/${hallId}`, {
      headers: {
        Authorization: `Bearer ${tokens.bob}`,
        Accept: "text/html",
      },
    });
    const html = await follow.text();
    expect(html).toContain("Nothing happens.");
    expect(html).not.toContain("No detail named");
    expect(html).toContain("A public hall.");
  });

  it("HTML Use redirects cleanly and shows ok as a notice", async () => {
    const { app, tokens, world, lampId, hallId } = harness;
    await world.collectArtefact("bob", lampId);
    await app.request(`/s/${hallId}`, {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });

    const res = await app.request(`/a/${lampId}/use`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.bob}`,
        Accept: "text/html",
      },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toMatch(new RegExp(`/a/${lampId}$`));
    expect(location).not.toMatch(/[?&](use|use-error)=/);

    const follow = await app.request(`/a/${lampId}`, {
      headers: {
        Authorization: `Bearer ${tokens.bob}`,
        Accept: "text/html",
      },
    });
    const html = await follow.text();
    expect(html).toContain("The lamp flares.");
    expect(html).toContain('class="notice"');
    expect(html).not.toContain("No detail named");
    expect(html).toContain("Brass.");
  });

  it("scene details still open by query key", async () => {
    const { app, tokens, world, hallId } = harness;
    await world.updateScene(hallId, {
      details: { card: "A painted card." },
    });
    const res = await app.request(`/s/${hallId}?card`, {
      headers: {
        Authorization: `Bearer ${tokens.bob}`,
        Accept: "text/html",
      },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("A painted card.");
    expect(html).not.toContain("No detail named");
  });
});
