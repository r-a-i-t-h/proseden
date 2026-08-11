import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

type App = ReturnType<typeof createApp>;

/**
 * Fixture topology:
 *
 *   1 Public Hall (outside group)
 *   2 Wing Entrance (private; bob read)  ── entrance of group "1"
 *   3 Inner Chamber (private; bob read)  ── member
 *   4 Vault (private; alice only)        ── member
 *   5 Public Garden (outside group)
 *
 * Exits:
 *   1 → 3 "into wing"   (outsider path into an inner room)
 *   1 → 5 "garden"
 *   2 → 3 "deeper"
 *   2 → 4 "vault door"
 *   3 → 2 "back"
 */
async function createNavWorld(): Promise<{
  world: WorldStore;
  sessions: SessionStore;
  app: App;
  dataDir: string;
  tokens: Record<string, string>;
  ids: {
    hall: number;
    entrance: number;
    inner: number;
    vault: number;
    garden: number;
  };
  exits: {
    hallToInner: number;
    hallToGarden: number;
    entranceToInner: number;
    entranceToVault: number;
    innerToEntrance: number;
  };
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-nav-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol"]) {
    await world.createUser(name, password.hash, password.salt);
  }

  const hall = await world.createScene({
    owner: "alice",
    title: "Public Hall",
    body: "Outside the wing.",
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
  const vault = await world.createScene({
    owner: "alice",
    title: "Vault",
    body: "Alice only.",
    visibility: "private",
  });
  const garden = await world.createScene({
    owner: "alice",
    title: "Public Garden",
    body: "Open air.",
    visibility: "public",
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
    sceneIds: [entrance.id, inner.id, vault.id],
  });

  const hallToInner = await world.addExit(hall.id, "into wing", inner.id);
  const hallToGarden = await world.addExit(hall.id, "garden", garden.id);
  const entranceToInner = await world.addExit(entrance.id, "deeper", inner.id);
  const entranceToVault = await world.addExit(entrance.id, "vault door", vault.id);
  const innerToEntrance = await world.addExit(inner.id, "back", entrance.id);

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol"]) {
    tokens[name] = sessions.create(name).token;
  }

  const app = createApp({ world, sessions });
  return {
    world,
    sessions,
    app,
    dataDir,
    tokens,
    ids: {
      hall: hall.id,
      entrance: entrance.id,
      inner: inner.id,
      vault: vault.id,
      garden: garden.id,
    },
    exits: {
      hallToInner: hallToInner.exitId,
      hallToGarden: hallToGarden.exitId,
      entranceToInner: entranceToInner.exitId,
      entranceToVault: entranceToVault.exitId,
      innerToEntrance: innerToEntrance.exitId,
    },
  };
}

function auth(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "text/plain",
    ...extra,
  };
}

function location(res: Response): string {
  return res.headers.get("Location") ?? "";
}

describe("resolveTeleportTarget", () => {
  let harness: Awaited<ReturnType<typeof createNavWorld>>;

  beforeEach(async () => {
    harness = await createNavWorld();
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("does not redirect scenes outside any entrance group", () => {
    const { world, ids } = harness;
    expect(world.resolveTeleportTarget(ids.hall, undefined)).toEqual({
      sceneId: ids.hall,
      redirected: false,
    });
    expect(world.resolveTeleportTarget(ids.garden, ids.hall)).toEqual({
      sceneId: ids.garden,
      redirected: false,
    });
  });

  it("redirects outsiders targeting an inner room to the entrance", () => {
    const { world, ids } = harness;
    expect(world.resolveTeleportTarget(ids.inner, undefined)).toEqual({
      sceneId: ids.entrance,
      redirected: true,
    });
    expect(world.resolveTeleportTarget(ids.inner, ids.hall)).toEqual({
      sceneId: ids.entrance,
      redirected: true,
    });
    expect(world.resolveTeleportTarget(ids.vault, ids.garden)).toEqual({
      sceneId: ids.entrance,
      redirected: true,
    });
  });

  it("does not redirect when already requesting the entrance", () => {
    const { world, ids } = harness;
    expect(world.resolveTeleportTarget(ids.entrance, undefined)).toEqual({
      sceneId: ids.entrance,
      redirected: false,
    });
    expect(world.resolveTeleportTarget(ids.entrance, ids.hall)).toEqual({
      sceneId: ids.entrance,
      redirected: false,
    });
  });

  it("allows direct landing when travelling from inside the same group", () => {
    const { world, ids } = harness;
    expect(world.resolveTeleportTarget(ids.inner, ids.entrance)).toEqual({
      sceneId: ids.inner,
      redirected: false,
    });
    expect(world.resolveTeleportTarget(ids.vault, ids.inner)).toEqual({
      sceneId: ids.vault,
      redirected: false,
    });
    expect(world.resolveTeleportTarget(ids.entrance, ids.inner)).toEqual({
      sceneId: ids.entrance,
      redirected: false,
    });
  });

  it("lets the destination owner skip entrance-group redirection", () => {
    const { world, ids } = harness;
    expect(
      world.resolveTeleportTarget(ids.inner, undefined, { asOwnerUsername: "alice" }),
    ).toEqual({
      sceneId: ids.inner,
      redirected: false,
    });
    expect(
      world.resolveTeleportTarget(ids.inner, undefined, { asOwnerUsername: "bob" }),
    ).toEqual({
      sceneId: ids.entrance,
      redirected: true,
    });
  });
});

describe("HTTP teleport vs rights", () => {
  let harness: Awaited<ReturnType<typeof createNavWorld>>;

  beforeEach(async () => {
    harness = await createNavWorld();
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("lets anyone teleport to a public scene", async () => {
    const { app, ids } = harness;
    const anon = await app.request(`/s/${ids.hall}`, {
      headers: { Accept: "text/plain" },
    });
    expect(anon.status).toBe(200);
    expect(await anon.text()).toContain("Public Hall");
  });

  it("blocks anonymous teleport to a private scene", async () => {
    const { app, ids } = harness;
    const res = await app.request(`/s/${ids.entrance}`, {
      headers: { Accept: "text/plain" },
    });
    expect(res.status).toBe(401);
  });

  it("allows granted readers to teleport to a private scene", async () => {
    const { app, tokens, ids } = harness;
    const bob = await app.request(`/s/${ids.entrance}`, {
      headers: auth(tokens.bob),
    });
    expect(bob.status).toBe(200);

    const carol = await app.request(`/s/${ids.entrance}`, {
      headers: auth(tokens.carol),
    });
    expect(carol.status).toBe(403);
  });

  it("redirects outsider teleport into an inner room to a readable entrance", async () => {
    const { app, tokens, ids } = harness;
    const res = await app.request(`/s/${ids.inner}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`/s/${ids.entrance}`);
  });

  it("lets the owner teleport straight into their inner room", async () => {
    const { app, tokens, ids } = harness;
    const res = await app.request(`/s/${ids.inner}`, {
      headers: auth(tokens.alice),
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Inner Chamber");
  });

  it("lists owned scenes in the edit bootstrap, not the reader HTML", async () => {
    const { app, tokens, ids } = harness;
    const res = await app.request(`/s/${ids.hall}`, {
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        Accept: "text/html",
      },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("My scenes");
    expect(html).toContain(`"id":${ids.inner}`);
    expect(html).toContain("Inner Chamber");
    const boot = html.match(/id="edit-bootstrap">([^<]+)</);
    expect(boot?.[1]).toBeTruthy();
    const data = JSON.parse(boot![1]!) as {
      ownedScenes: Array<{ id: number; title?: string }>;
      manage?: { scene?: { id: number } };
    };
    expect(data.ownedScenes.some((s) => s.id === ids.inner && s.title === "Inner Chamber")).toBe(
      true,
    );
    expect(data.manage?.scene?.id).toBe(ids.hall);
  });

  it("denies outsider teleport into a group when the entrance is unreadable", async () => {
    const { app, tokens, ids } = harness;
    const carol = await app.request(`/s/${ids.inner}`, {
      headers: auth(tokens.carol),
      redirect: "manual",
    });
    expect(carol.status).toBe(403);
    expect(await carol.text()).toMatch(/Entrance to this area is not reachable/i);

    const anon = await app.request(`/s/${ids.inner}`, {
      headers: { Accept: "text/plain" },
      redirect: "manual",
    });
    expect(anon.status).toBe(401);
  });

  it("allows intra-group teleport with ?from= when the destination is readable", async () => {
    const { app, tokens, ids } = harness;
    const bob = await app.request(`/s/${ids.inner}?from=${ids.entrance}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(bob.status).toBe(200);
    expect(await bob.text()).toContain("Inner Chamber");
  });

  it("allows intra-group teleport inferred from Referer", async () => {
    const { app, tokens, ids } = harness;
    const bob = await app.request(`/s/${ids.inner}`, {
      headers: auth(tokens.bob, {
        Referer: `http://example.test/s/${ids.entrance}`,
      }),
      redirect: "manual",
    });
    expect(bob.status).toBe(200);
  });

  it("still enforces destination ACL after intra-group resolution", async () => {
    const { app, tokens, ids } = harness;
    const bob = await app.request(`/s/${ids.vault}?from=${ids.entrance}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(bob.status).toBe(403);

    const alice = await app.request(`/s/${ids.vault}?from=${ids.entrance}`, {
      headers: auth(tokens.alice),
      redirect: "manual",
    });
    expect(alice.status).toBe(200);
  });

  it("does not treat an outside ?from= as being inside the group", async () => {
    const { app, tokens, ids } = harness;
    const res = await app.request(`/s/${ids.inner}?from=${ids.hall}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`/s/${ids.entrance}`);
  });
});

describe("HTTP navigate (go) vs rights", () => {
  let harness: Awaited<ReturnType<typeof createNavWorld>>;

  beforeEach(async () => {
    harness = await createNavWorld();
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("follows an exit to a readable public destination", async () => {
    const { app, ids, exits } = harness;
    const res = await app.request(`/s/${ids.hall}/go/${exits.hallToGarden}`, {
      headers: { Accept: "text/plain" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`/s/${ids.garden}?from=${ids.hall}`);
  });

  it("resolves exits by nickname", async () => {
    const { app, ids } = harness;
    const res = await app.request(`/s/${ids.hall}/go/${encodeURIComponent("garden")}`, {
      headers: { Accept: "text/plain" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(location(res)).toBe(`/s/${ids.garden}?from=${ids.hall}`);
  });

  it("returns 404 for an unknown exit", async () => {
    const { app, ids } = harness;
    const res = await app.request(`/s/${ids.hall}/go/no-such-exit`, {
      headers: { Accept: "text/plain" },
    });
    expect(res.status).toBe(404);
  });

  it("blocks leaving an unreadable scene", async () => {
    const { app, tokens, ids, exits } = harness;
    const carol = await app.request(`/s/${ids.entrance}/go/${exits.entranceToInner}`, {
      headers: auth(tokens.carol),
    });
    expect(carol.status).toBe(403);

    const anon = await app.request(`/s/${ids.entrance}/go/${exits.entranceToInner}`, {
      headers: { Accept: "text/plain" },
    });
    expect(anon.status).toBe(401);
  });

  it("snaps outsider go into an inner room to the entrance when readable", async () => {
    const { app, tokens, ids, exits } = harness;
    const bob = await app.request(`/s/${ids.hall}/go/${exits.hallToInner}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(bob.status).toBe(302);
    expect(location(bob)).toBe(`/s/${ids.entrance}?from=${ids.hall}`);
  });

  it("denies outsider go into a group when the entrance is unreadable", async () => {
    const { app, tokens, ids, exits } = harness;
    const carol = await app.request(`/s/${ids.hall}/go/${exits.hallToInner}`, {
      headers: auth(tokens.carol),
      redirect: "manual",
    });
    expect(carol.status).toBe(403);
  });

  it("allows go within a group to a readable inner room", async () => {
    const { app, tokens, ids, exits } = harness;
    const bob = await app.request(`/s/${ids.entrance}/go/${exits.entranceToInner}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(bob.status).toBe(302);
    expect(location(bob)).toBe(`/s/${ids.inner}?from=${ids.entrance}`);
  });

  it("denies go within a group to an unreadable destination", async () => {
    const { app, tokens, ids, exits } = harness;
    const bob = await app.request(`/s/${ids.entrance}/go/${exits.entranceToVault}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(bob.status).toBe(403);

    const alice = await app.request(`/s/${ids.entrance}/go/${exits.entranceToVault}`, {
      headers: auth(tokens.alice),
      redirect: "manual",
    });
    expect(alice.status).toBe(302);
    expect(location(alice)).toBe(`/s/${ids.vault}?from=${ids.entrance}`);
  });

  it("allows return go from inner to entrance for a granted reader", async () => {
    const { app, tokens, ids, exits } = harness;
    const bob = await app.request(`/s/${ids.inner}/go/${exits.innerToEntrance}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    expect(bob.status).toBe(302);
    expect(location(bob)).toBe(`/s/${ids.entrance}?from=${ids.inner}`);
  });
});
