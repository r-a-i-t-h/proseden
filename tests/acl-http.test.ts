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
  sessions: SessionStore;
  app: App;
  dataDir: string;
  tokens: Record<string, string>;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-acl-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol", "dave"]) {
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
    body: "A private study.",
    visibility: "private",
  });
  await world.createScene({
    owner: "alice",
    title: "Junction",
    body: "A public junction.",
    visibility: "public",
  });
  await world.updateScene(3, { isJunction: true }, { by: "alice" });

  await world.updateSceneAccess(2, {
    grants: [{ who: "bob", rights: ["read"] }],
  });

  const art = await world.createArtefact({
    owner: "alice",
    homeSceneId: 2,
    title: "Hidden note",
    body: "secret",
  });
  expect(art.id).toBe(1);

  await world.createArtefact({
    owner: "carol",
    homeSceneId: 1,
    title: "Carol's postcard",
    body: "hello",
  });

  const group = await world.createGroup({ owner: "alice", title: "Alice Rooms" });
  await world.setSceneGroup(2, group.id);

  await world.setStaffRoles("dave", ["moderator"]);

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol", "dave"]) {
    tokens[name] = sessions.create(name).token;
  }

  const app = createApp({ world, sessions });
  return { world, sessions, app, dataDir, tokens };
}

function auth(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

describe("HTTP ACL enforcement", () => {
  let harness: Awaited<ReturnType<typeof createTestWorld>>;

  beforeEach(async () => {
    harness = await createTestWorld();
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("allows anonymous public scene reads and blocks private ones", async () => {
    const { app } = harness;
    const pub = await app.request("/s/1", { headers: { Accept: "application/json" } });
    expect(pub.status).toBe(200);

    const priv = await app.request("/s/2", { headers: { Accept: "application/json" } });
    expect(priv.status).toBe(401);
  });

  it("allows invitees to read granted private scenes but not edit them", async () => {
    const { app, tokens } = harness;
    const read = await app.request("/s/2", { headers: auth(tokens.bob) });
    expect(read.status).toBe(200);

    const edit = await app.request("/s/2", {
      method: "PUT",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "hacked" }),
    });
    expect(edit.status).toBe(403);
  });

  it("returns 403 for authenticated users without access", async () => {
    const { app, tokens } = harness;
    const res = await app.request("/s/2", { headers: auth(tokens.carol) });
    expect(res.status).toBe(403);
  });

  it("lets owners manage scene access and blocks non-managers", async () => {
    const { app, tokens, world } = harness;

    const denied = await app.request("/s/2/access", { headers: auth(tokens.bob) });
    expect(denied.status).toBe(403);

    const get = await app.request("/s/2/access", { headers: auth(tokens.alice) });
    expect(get.status).toBe(200);

    const put = await app.request("/s/2/access", {
      method: "PUT",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({
        grants: [{ who: "carol", rights: ["edit"] }],
        denies: [],
      }),
    });
    expect(put.status).toBe(200);
    expect(world.getScene(2)?.grants).toEqual([{ who: "carol", rights: ["edit"] }]);

    const carolRead = await app.request("/s/2", { headers: auth(tokens.carol) });
    expect(carolRead.status).toBe(200);
  });

  it("lets users edit their own share-all ACL but not others unless manager", async () => {
    const { app, tokens, world } = harness;

    const self = await app.request("/u/bob/access", {
      method: "PUT",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({
        grants: [{ who: "carol", rights: ["read"] }],
      }),
    });
    expect(self.status).toBe(200);
    expect(world.getUser("bob")?.grants).toEqual([{ who: "carol", rights: ["read"] }]);

    const other = await app.request("/u/alice/access", {
      method: "PUT",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ grants: [] }),
    });
    expect(other.status).toBe(403);

    await world.setStaffRoles("bob", ["manager"]);
    const asManager = await app.request("/u/alice/access", {
      method: "PUT",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({
        denies: [{ who: "carol" }],
      }),
    });
    expect(asManager.status).toBe(200);
    expect(world.getUser("alice")?.denies).toEqual([{ who: "carol" }]);
  });

  it("enforces group read/manage and scene assignment rights", async () => {
    const { app, tokens, world } = harness;
    const groupId = world.listGroups()[0]!.id;

    const anon = await app.request(`/g/${groupId}`, {
      headers: { Accept: "application/json" },
    });
    expect(anon.status).toBe(401);

    const member = await app.request(`/g/${groupId}`, { headers: auth(tokens.bob) });
    expect(member.status).toBe(403);

    const owner = await app.request(`/g/${groupId}`, { headers: auth(tokens.alice) });
    expect(owner.status).toBe(200);

    const accessDenied = await app.request(`/g/${groupId}/access`, {
      headers: auth(tokens.bob),
    });
    expect(accessDenied.status).toBe(403);

    const grant = await app.request(`/g/${groupId}/access`, {
      method: "PUT",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({
        grants: [{ who: "bob", rights: ["read"] }],
      }),
    });
    expect(grant.status).toBe(200);

    const bobNow = await app.request(`/g/${groupId}`, { headers: auth(tokens.bob) });
    expect(bobNow.status).toBe(200);

    const addSceneDenied = await app.request(`/g/${groupId}/scenes`, {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ sceneId: 1 }),
    });
    expect(addSceneDenied.status).toBe(403);
  });

  it("requires manage or organise to add exits; public junctions allow outbound attaches", async () => {
    const { app, tokens, world } = harness;

    const bobExit = await app.request("/s/2/exits", {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "out", toSceneId: 1 }),
    });
    expect(bobExit.status).toBe(403);

    const aliceToPrivate = await app.request("/s/1/exits", {
      method: "POST",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "study", toSceneId: 2 }),
    });
    expect(aliceToPrivate.status).toBe(201);

    await world.createScene({
      owner: "carol",
      title: "Carol private",
      body: "nope",
      visibility: "private",
    });
    const unreadableDest = await app.request("/s/1/exits", {
      method: "POST",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "blocked", toSceneId: 4 }),
    });
    expect(unreadableDest.status).toBe(403);

    // Public destination does not require junction status.
    const toPublic = await app.request("/s/4/exits", {
      method: "POST",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "hall", toSceneId: 1 }),
    });
    expect(toPublic.status).toBe(201);

    // Non-manager may add an exit *from* a public junction.
    const fromJunction = await app.request("/s/3/exits", {
      method: "POST",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "carol-wing", toSceneId: 4 }),
    });
    expect(fromJunction.status).toBe(201);

    // Non-junction public origin still requires manage.
    const fromPublicHall = await app.request("/s/1/exits", {
      method: "POST",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "nope", toSceneId: 4 }),
    });
    expect(fromPublicHall.status).toBe(403);

    await world.setStaffRoles("bob", ["topographer"]);
    const organise = await app.request("/s/2/exits", {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "hall", toSceneId: 1 }),
    });
    expect(organise.status).toBe(201);
  });

  it("lets junction visitors remove only exits to their own scenes", async () => {
    const { app, tokens, world } = harness;

    const carolExit = await world.addExit(3, "carol-wing", 1);
    // Scene 1 is owned by alice; create a carol-owned target and exit to it.
    const carolScene = await world.createScene({
      owner: "carol",
      title: "Carol annex",
      body: "hers",
      visibility: "public",
    });
    const toCarol = await world.addExit(3, "to-carol", carolScene.id);
    const bobScene = await world.createScene({
      owner: "bob",
      title: "Bob annex",
      body: "his",
      visibility: "public",
    });
    const toBob = await world.addExit(3, "to-bob", bobScene.id);

    const carolOwn = await app.request(`/s/3/exits/${toCarol.exitId}/delete`, {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(carolOwn.status).toBe(200);
    expect(world.findExit(3, String(toCarol.exitId))).toBeUndefined();

    const carolOthers = await app.request(`/s/3/exits/${toBob.exitId}/delete`, {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(carolOthers.status).toBe(403);
    expect(world.findExit(3, String(toBob.exitId))).toBeTruthy();

    const ownerAny = await app.request(`/s/3/exits/${carolExit.exitId}/delete`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    expect(ownerAny.status).toBe(200);
    expect(world.findExit(3, String(carolExit.exitId))).toBeUndefined();

    const bobAgain = await world.addExit(3, "to-bob-again", bobScene.id);
    const bulk = await app.request("/s/3/exits/delete", {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [toBob.exitId, bobAgain.exitId] }),
    });
    expect(bulk.status).toBe(200);
    expect(world.findExit(3, String(toBob.exitId))).toBeUndefined();
    expect(world.findExit(3, String(bobAgain.exitId))).toBeUndefined();
  });

  it("blocks reading and collecting artefacts in unreadable homes", async () => {
    const { app, tokens } = harness;

    const anon = await app.request("/a/1", { headers: { Accept: "application/json" } });
    expect(anon.status).toBe(401);

    const bob = await app.request("/a/1", { headers: auth(tokens.bob) });
    expect(bob.status).toBe(200);

    const carol = await app.request("/a/1", { headers: auth(tokens.carol) });
    expect(carol.status).toBe(403);

    const collect = await app.request("/a/1/collect", {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(collect.status).toBe(403);

    const bobCollect = await app.request("/a/1/collect", {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(bobCollect.status).toBe(200);
  });

  it("lets artefact owners edit without scene edit rights", async () => {
    const { app, tokens } = harness;
    const denied = await app.request("/a/2", {
      method: "PUT",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "nope", homeSceneId: 1 }),
    });
    expect(denied.status).toBe(403);

    const res = await app.request("/a/2", {
      method: "PUT",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "updated postcard", homeSceneId: 1 }),
    });
    expect(res.status).toBe(200);
  });

  it("lets moderators delete scenes they cannot manage", async () => {
    const { app, tokens, world } = harness;
    await world.createScene({
      owner: "alice",
      title: "Disposable",
      body: "soon gone",
      visibility: "private",
    });
    const id = [...world.scenes.keys()].sort((a, b) => a - b).at(-1)!;

    const bob = await app.request(`/s/${id}/delete`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(bob.status).toBe(403);

    const mod = await app.request(`/s/${id}/delete`, {
      method: "POST",
      headers: auth(tokens.dave),
    });
    expect(mod.status).toBe(200);
    expect(world.getScene(id)).toBeUndefined();
  });

  it("restricts staff APIs to managers", async () => {
    const { app, tokens, world } = harness;

    const listDenied = await app.request("/staff", { headers: auth(tokens.dave) });
    expect(listDenied.status).toBe(403);

    await world.setStaffRoles("alice", ["manager"]);
    const list = await app.request("/staff", { headers: auth(tokens.alice) });
    expect(list.status).toBe(200);

    const set = await app.request("/staff/bob", {
      method: "PUT",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ roles: ["topographer", "not-a-role"] }),
    });
    expect(set.status).toBe(200);
    expect(world.rolesFor("bob")).toEqual(["topographer"]);
  });

  it("teleports into entrance groups only when the entrance is readable", async () => {
    const { app, tokens, world } = harness;
    await world.createScene({
      owner: "alice",
      title: "Inner room",
      body: "inside",
      visibility: "private",
    });
    const innerId = [...world.scenes.keys()].sort((a, b) => a - b).at(-1)!;
    await world.updateSceneAccess(innerId, {
      grants: [{ who: "bob", rights: ["read"] }],
    });
    await world.createEntranceGroup({
      title: "Wing",
      entranceSceneId: 2,
      sceneIds: [innerId],
    });

    const bob = await app.request(`/s/${innerId}`, {
      headers: auth(tokens.bob),
      redirect: "manual",
    });
    // Redirected to private entrance which bob can read
    expect([200, 302]).toContain(bob.status);

    const carol = await app.request(`/s/${innerId}`, { headers: auth(tokens.carol) });
    expect(carol.status).toBe(403);
  });

  it("requires manage to restore scene history", async () => {
    const { app, tokens, world } = harness;
    await world.updateScene(
      2,
      { body: "version one" },
      { by: "alice", retainSnapshot: true },
    );
    const log = await world.listEditLog("scenes", 2);
    const versionId = log.find((e) => e.versionId)?.versionId;
    expect(versionId).toBeTruthy();

    const denied = await app.request(`/s/2/history/${versionId}/restore`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(denied.status).toBe(403);

    const ok = await app.request(`/s/2/history/${versionId}/restore`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    expect(ok.status).toBe(200);
  });
});
