import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

type App = ReturnType<typeof createApp>;

type TestIds = {
  publicHall: number;
  privateStudy: number;
  junction: number;
  hiddenNote: number;
  postcard: number;
};

async function createTestWorld(): Promise<{
  world: WorldStore;
  sessions: SessionStore;
  app: App;
  dataDir: string;
  tokens: Record<string, string>;
  ids: TestIds;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-acl-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol", "dave"]) {
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
    body: "A private study.",
    visibility: "private",
  });
  const junction = await world.createScene({
    owner: "alice",
    title: "Junction",
    body: "A public junction.",
    visibility: "public",
  });
  await world.updateScene(junction.id, { isJunction: true }, { by: "alice" });

  await world.updateSceneAccess(privateStudy.id, {
    grants: [{ who: "bob", rights: ["read"] }],
  });

  const hiddenNote = await world.createArtefact({
    owner: "alice",
    homeSceneId: privateStudy.id,
    title: "Hidden note",
    body: "secret",
  });

  const postcard = await world.createArtefact({
    owner: "carol",
    homeSceneId: publicHall.id,
    title: "Carol's postcard",
    body: "hello",
  });

  const group = await world.createGroup({ owner: "alice", title: "Alice Rooms" });
  await world.setSceneGroup(privateStudy.id, group.id);

  await world.setStaffRoles("dave", ["moderator"]);

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol", "dave"]) {
    tokens[name] = sessions.create(name).token;
  }

  const app = createApp({ world, sessions });
  const ids: TestIds = {
    publicHall: publicHall.id,
    privateStudy: privateStudy.id,
    junction: junction.id,
    hiddenNote: hiddenNote.id,
    postcard: postcard.id,
  };
  return { world, sessions, app, dataDir, tokens, ids };
}

function auth(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

describe("HTTP ACL enforcement", () => {
  let harness: Awaited<ReturnType<typeof createTestWorld>>;
  let ids: TestIds;

  beforeEach(async () => {
    harness = await createTestWorld();
    ids = harness.ids;
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("allows anonymous public scene reads and blocks private ones", async () => {
    const { app } = harness;
    const pub = await app.request(`/s/${ids.publicHall}`, { headers: { Accept: "application/json" } });
    expect(pub.status).toBe(200);

    const priv = await app.request(`/s/${ids.privateStudy}`, { headers: { Accept: "application/json" } });
    expect(priv.status).toBe(401);
  });

  it("allows invitees to read granted private scenes but not edit them", async () => {
    const { app, tokens } = harness;
    const read = await app.request(`/s/${ids.privateStudy}`, { headers: auth(tokens.bob) });
    expect(read.status).toBe(200);

    const edit = await app.request(`/s/${ids.privateStudy}`, {
      method: "PUT",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "hacked" }),
    });
    expect(edit.status).toBe(403);
  });

  it("returns 403 for authenticated users without access", async () => {
    const { app, tokens } = harness;
    const res = await app.request(`/s/${ids.privateStudy}`, { headers: auth(tokens.carol) });
    expect(res.status).toBe(403);
  });

  it("lets owners manage scene access and blocks non-managers", async () => {
    const { app, tokens, world } = harness;

    const denied = await app.request(`/s/${ids.privateStudy}/access`, { headers: auth(tokens.bob) });
    expect(denied.status).toBe(403);

    const get = await app.request(`/s/${ids.privateStudy}/access`, { headers: auth(tokens.alice) });
    expect(get.status).toBe(200);

    const put = await app.request(`/s/${ids.privateStudy}/access`, {
      method: "PUT",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({
        grants: [{ who: "carol", rights: ["edit"] }],
        denies: [],
      }),
    });
    expect(put.status).toBe(200);
    expect(world.getScene(ids.privateStudy)?.grants).toEqual([{ who: "carol", rights: ["edit"] }]);

    const carolRead = await app.request(`/s/${ids.privateStudy}`, { headers: auth(tokens.carol) });
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
      body: JSON.stringify({ sceneId: ids.publicHall }),
    });
    expect(addSceneDenied.status).toBe(403);
  });

  it("requires manage or organise to add exits; public junctions allow outbound attaches", async () => {
    const { app, tokens, world } = harness;

    const bobExit = await app.request(`/s/${ids.privateStudy}/exits`, {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "out", toSceneId: ids.publicHall }),
    });
    expect(bobExit.status).toBe(403);

    const aliceToPrivate = await app.request(`/s/${ids.publicHall}/exits`, {
      method: "POST",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "study", toSceneId: ids.privateStudy }),
    });
    expect(aliceToPrivate.status).toBe(201);

    const carolPrivate = await world.createScene({
      owner: "carol",
      title: "Carol private",
      body: "nope",
      visibility: "private",
    });
    const unreadableDest = await app.request(`/s/${ids.publicHall}/exits`, {
      method: "POST",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "blocked", toSceneId: carolPrivate.id }),
    });
    expect(unreadableDest.status).toBe(403);

    // Public destination does not require junction status.
    const toPublic = await app.request(`/s/${carolPrivate.id}/exits`, {
      method: "POST",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "hall", toSceneId: ids.publicHall }),
    });
    expect(toPublic.status).toBe(201);

    // Non-manager may add an exit *from* a public junction.
    const fromJunction = await app.request(`/s/${ids.junction}/exits`, {
      method: "POST",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "carol-wing", toSceneId: carolPrivate.id }),
    });
    expect(fromJunction.status).toBe(201);

    // Non-junction public origin still requires manage.
    const fromPublicHall = await app.request(`/s/${ids.publicHall}/exits`, {
      method: "POST",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "nope", toSceneId: carolPrivate.id }),
    });
    expect(fromPublicHall.status).toBe(403);

    await world.setStaffRoles("bob", ["topographer"]);
    const organise = await app.request(`/s/${ids.privateStudy}/exits`, {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "hall", toSceneId: ids.publicHall }),
    });
    expect(organise.status).toBe(201);
  });

  it("lets junction visitors remove only exits to their own scenes", async () => {
    const { app, tokens, world } = harness;

    const carolExit = await world.addExit(ids.junction, "carol-wing", ids.publicHall);
    const carolScene = await world.createScene({
      owner: "carol",
      title: "Carol annex",
      body: "hers",
      visibility: "public",
    });
    const toCarol = await world.addExit(ids.junction, "to-carol", carolScene.id);
    const bobScene = await world.createScene({
      owner: "bob",
      title: "Bob annex",
      body: "his",
      visibility: "public",
    });
    const toBob = await world.addExit(ids.junction, "to-bob", bobScene.id);

    const carolOwn = await app.request(`/s/${ids.junction}/exits/${toCarol.exitId}/delete`, {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(carolOwn.status).toBe(200);
    expect(world.findExit(ids.junction, String(toCarol.exitId))).toBeUndefined();

    const carolOthers = await app.request(`/s/${ids.junction}/exits/${toBob.exitId}/delete`, {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(carolOthers.status).toBe(403);
    expect(world.findExit(ids.junction, String(toBob.exitId))).toBeTruthy();

    const ownerAny = await app.request(`/s/${ids.junction}/exits/${carolExit.exitId}/delete`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    expect(ownerAny.status).toBe(200);
    expect(world.findExit(ids.junction, String(carolExit.exitId))).toBeUndefined();

    const bobAgain = await world.addExit(ids.junction, "to-bob-again", bobScene.id);
    const bulk = await app.request(`/s/${ids.junction}/exits/delete`, {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [toBob.exitId, bobAgain.exitId] }),
    });
    expect(bulk.status).toBe(200);
    expect(world.findExit(ids.junction, String(toBob.exitId))).toBeUndefined();
    expect(world.findExit(ids.junction, String(bobAgain.exitId))).toBeUndefined();
  });

  it("reorders exits for the owner and updates the reader list", async () => {
    const { app, tokens, world } = harness;
    const north = await world.addExit(ids.publicHall, "north", ids.junction);
    const east = await world.addExit(ids.publicHall, "east", ids.junction, {
      when: "quest.open",
      whenDenied: "Nope.",
      hidden: true,
    });
    const south = await world.addExit(ids.publicHall, "south", ids.junction);

    const ok = await app.request(`/s/${ids.publicHall}/exits/reorder`, {
      method: "POST",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [south.exitId, north.exitId, east.exitId] }),
    });
    expect(ok.status).toBe(200);
    const ordered = world.getExits(ids.publicHall);
    expect(ordered.map((e) => e.exitId)).toEqual([south.exitId, north.exitId, east.exitId]);
    expect(ordered[2]).toMatchObject({
      exitId: east.exitId,
      nickname: "east",
      when: "quest.open",
      whenDenied: "Nope.",
      hidden: true,
    });

    const listed = await app.request(`/s/${ids.publicHall}`, { headers: { Accept: "text/plain" } });
    expect(listed.status).toBe(200);
    const text = await listed.text();
    const southAt = text.indexOf("- south");
    const northAt = text.indexOf("- north");
    expect(southAt).toBeGreaterThan(-1);
    expect(northAt).toBeGreaterThan(-1);
    expect(southAt).toBeLessThan(northAt);
    expect(text).not.toContain("- east");

    const partial = await app.request(`/s/${ids.publicHall}/exits/reorder`, {
      method: "POST",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [south.exitId, north.exitId] }),
    });
    expect(partial.status).toBe(400);

    const dupes = await app.request(`/s/${ids.publicHall}/exits/reorder`, {
      method: "POST",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [south.exitId, south.exitId, north.exitId] }),
    });
    expect(dupes.status).toBe(400);
  });

  it("lets manage grantees and topographers reorder, not junction visitors", async () => {
    const { app, tokens, world } = harness;
    const first = await world.addExit(ids.privateStudy, "out", ids.publicHall);
    const second = await world.addExit(ids.privateStudy, "also", ids.publicHall);
    await world.updateSceneAccess(ids.privateStudy, {
      grants: [{ who: "bob", rights: ["manage"] }],
    });

    const grantee = await app.request(`/s/${ids.privateStudy}/exits/reorder`, {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [second.exitId, first.exitId] }),
    });
    expect(grantee.status).toBe(200);
    expect(world.getExits(ids.privateStudy).map((e) => e.exitId)).toEqual([second.exitId, first.exitId]);

    await world.setStaffRoles("carol", ["topographer"]);
    const topo = await app.request(`/s/${ids.privateStudy}/exits/reorder`, {
      method: "POST",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [first.exitId, second.exitId] }),
    });
    expect(topo.status).toBe(200);
    expect(world.getExits(ids.privateStudy).map((e) => e.exitId)).toEqual([first.exitId, second.exitId]);

    const j1 = await world.addExit(ids.junction, "one", ids.publicHall);
    const j2 = await world.addExit(ids.junction, "two", ids.publicHall);
    const visitor = await app.request(`/s/${ids.junction}/exits/reorder`, {
      method: "POST",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ exitIds: [j2.exitId, j1.exitId] }),
    });
    expect(visitor.status).toBe(403);
    expect(world.getExits(ids.junction).map((e) => e.exitId)).toEqual([j1.exitId, j2.exitId]);
  });

  it("blocks reading and collecting artefacts in unreadable homes", async () => {
    const { app, tokens } = harness;

    const anon = await app.request(`/a/${ids.hiddenNote}`, { headers: { Accept: "application/json" } });
    expect(anon.status).toBe(401);

    const bob = await app.request(`/a/${ids.hiddenNote}`, { headers: auth(tokens.bob) });
    expect(bob.status).toBe(200);

    const carol = await app.request(`/a/${ids.hiddenNote}`, { headers: auth(tokens.carol) });
    expect(carol.status).toBe(403);

    const collect = await app.request(`/a/${ids.hiddenNote}/collect`, {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(collect.status).toBe(403);

    const bobCollect = await app.request(`/a/${ids.hiddenNote}/collect`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(bobCollect.status).toBe(200);
  });

  it("lets holders read a private-home artefact without scene access", async () => {
    const { app, tokens, world } = harness;
    const headers = {
      Authorization: `Bearer ${tokens.carol}`,
      Accept: "text/plain",
    };

    await world.collectArtefact("carol", ids.hiddenNote);

    const page = await app.request(`/a/${ids.hiddenNote}`, { headers });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("secret");

    const scene = await app.request(`/s/${ids.privateStudy}`, { headers });
    expect(scene.status).toBe(403);

    const collect = await app.request(`/a/${ids.hiddenNote}/collect`, {
      method: "POST",
      headers: auth(tokens.carol),
    });
    expect(collect.status).toBe(403);

    const history = await app.request(`/a/${ids.hiddenNote}/history`, {
      headers: auth(tokens.carol),
    });
    expect(history.status).toBe(403);

    await world.dropArtefact("carol", ids.hiddenNote);
    const afterDrop = await app.request(`/a/${ids.hiddenNote}`, { headers });
    expect(afterDrop.status).toBe(403);
  });

  it("lets holders read an artefact whose home scene when-gate they fail", async () => {
    const { app, tokens, world } = harness;
    const vault = await world.createScene({
      owner: "alice",
      title: "Gated vault",
      body: "Locked hall.",
      visibility: "public",
    });
    await world.updateScene(
      vault.id,
      { when: "never.open", whenDenied: "The vault stays shut." },
      { by: "alice" },
    );
    const potion = await world.createArtefact({
      owner: "alice",
      homeSceneId: vault.id,
      title: "Vault draught",
      body: "Bitter.",
    });
    await world.collectArtefact("carol", potion.id);

    const headers = {
      Authorization: `Bearer ${tokens.carol}`,
      Accept: "text/plain",
    };
    const page = await app.request(`/a/${potion.id}`, { headers });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Bitter.");

    const scene = await app.request(`/s/${vault.id}`, { headers });
    expect(scene.status).toBe(403);
    expect(await scene.text()).toContain("The vault stays shut.");
  });

  it("lets artefact owners edit without scene edit rights", async () => {
    const { app, tokens } = harness;
    const denied = await app.request(`/a/${ids.postcard}`, {
      method: "PUT",
      headers: { ...auth(tokens.bob), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "nope", homeSceneId: ids.privateStudy }),
    });
    expect(denied.status).toBe(403);

    const res = await app.request(`/a/${ids.postcard}`, {
      method: "PUT",
      headers: { ...auth(tokens.carol), "Content-Type": "application/json" },
      body: JSON.stringify({ body: "updated postcard", homeSceneId: ids.publicHall }),
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

    const inbox = world.listInboxFor("bob");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.type).toBe("notice");
    expect(inbox[0]!.fromUser).toBe("alice");
    expect(inbox[0]!.subject).toBe("Role change from alice");
    expect(inbox[0]!.body).toBe("alice set your staff roles to: topographer.");

    const same = await app.request("/staff/bob", {
      method: "PUT",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ roles: ["topographer"] }),
    });
    expect(same.status).toBe(200);
    expect(world.listInboxFor("bob")).toHaveLength(1);

    const clear = await app.request("/staff/bob", {
      method: "PUT",
      headers: { ...auth(tokens.alice), "Content-Type": "application/json" },
      body: JSON.stringify({ roles: [] }),
    });
    expect(clear.status).toBe(200);
    expect(world.rolesFor("bob")).toEqual([]);
    const cleared = world.listInboxFor("bob");
    expect(cleared).toHaveLength(2);
    expect(cleared[0]!.subject).toBe("Role change from alice");
    expect(cleared[0]!.body).toBe("alice removed your staff roles.");
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
      entranceSceneId: ids.privateStudy,
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
      ids.privateStudy,
      { body: "version one" },
      { by: "alice", retainSnapshot: true },
    );
    const log = await world.listEditLog("scenes", ids.privateStudy);
    const versionId = log.find((e) => e.versionId)?.versionId;
    expect(versionId).toBeTruthy();

    const denied = await app.request(`/s/${ids.privateStudy}/history/${versionId}/restore`, {
      method: "POST",
      headers: auth(tokens.bob),
    });
    expect(denied.status).toBe(403);

    const ok = await app.request(`/s/${ids.privateStudy}/history/${versionId}/restore`, {
      method: "POST",
      headers: auth(tokens.alice),
    });
    expect(ok.status).toBe(200);
  });
});
