import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canRead } from "../src/access/permissions.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

async function createHarness() {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-xfer-"));
  const world = new WorldStore(dataDir);
  await world.load();
  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol", "erin"]) {
    await world.createUser(name, password.hash, password.salt);
  }
  await world.setStaffRoles("erin", ["manager"]);
  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol", "erin"]) {
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

describe("ownership transfer", () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("transfers an ungrouped scene and the owner's homed artefacts", async () => {
    const { world } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Quiet.",
      visibility: "private",
    });
    const kept = await world.createArtefact({
      owner: "alice",
      homeSceneId: scene.id,
      title: "Alice's key",
      body: "brass",
    });
    const guest = await world.createArtefact({
      owner: "carol",
      homeSceneId: scene.id,
      title: "Carol's cup",
      body: "tea",
    });

    const result = await world.transferSceneOwner(scene.id, "bob", {
      keepAccess: true,
      by: "alice",
    });
    expect(result.scene.owner).toBe("bob");
    expect(result.artefacts.map((a) => a.id)).toEqual([kept.id]);
    expect(world.getScene(scene.id)?.owner).toBe("bob");
    expect(world.getArtefact(kept.id)?.owner).toBe("bob");
    expect(world.getArtefact(guest.id)?.owner).toBe("carol");
    expect(world.getScene(scene.id)?.grants).toEqual([{ who: "alice", rights: ["manage"] }]);

    const log = await world.listEditLog("scenes", scene.id);
    expect(log.at(-1)?.fields).toEqual(expect.arrayContaining(["owner"]));
    const artLog = await world.listEditLog("artefacts", kept.id);
    expect(artLog.at(-1)?.fields).toEqual(["owner"]);
  });

  it("refuses to transfer a grouped scene", async () => {
    const { world } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Open.",
      visibility: "private",
    });
    const group = await world.createGroup({ owner: "alice", title: "House" });
    await world.setSceneGroup(scene.id, group.id);
    await expect(world.transferSceneOwner(scene.id, "bob")).rejects.toThrow(
      /transfer the group/i,
    );
    expect(world.getScene(scene.id)?.owner).toBe("alice");
  });

  it("transfers a group, member scenes, and matching artefacts", async () => {
    const { world } = harness;
    const a = await world.createScene({
      owner: "alice",
      title: "Kitchen",
      body: "Warm.",
      visibility: "private",
    });
    const b = await world.createScene({
      owner: "alice",
      title: "Pantry",
      body: "Dark.",
      visibility: "private",
    });
    const group = await world.createGroup({ owner: "alice", title: "House" });
    await world.setSceneGroup(a.id, group.id);
    await world.setSceneGroup(b.id, group.id);
    const spoon = await world.createArtefact({
      owner: "alice",
      homeSceneId: a.id,
      title: "Spoon",
      body: "wood",
    });
    const guest = await world.createArtefact({
      owner: "carol",
      homeSceneId: a.id,
      title: "Jar",
      body: "jam",
    });

    const result = await world.transferGroupOwner(group.id, "bob", { keepAccess: true });
    expect(result.group.owner).toBe("bob");
    expect(world.getGroup(group.id)?.owner).toBe("bob");
    expect(world.getScene(a.id)?.owner).toBe("bob");
    expect(world.getScene(b.id)?.owner).toBe("bob");
    expect(world.getArtefact(spoon.id)?.owner).toBe("bob");
    expect(world.getArtefact(guest.id)?.owner).toBe("carol");
    expect(world.getGroup(group.id)?.grants).toEqual([{ who: "alice", rights: ["manage"] }]);
    expect(world.getScene(a.id)?.grants ?? []).toEqual([]);
  });

  it("rejects assigning a scene whose owner differs from the group owner", async () => {
    const { world } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Shed",
      body: "Tools.",
      visibility: "private",
    });
    const group = await world.createGroup({ owner: "bob", title: "Bob House" });
    await expect(world.setSceneGroup(scene.id, group.id)).rejects.toThrow(
      /owner must match/i,
    );
    expect(world.getScene(scene.id)?.groupId ?? null).toBeNull();
  });

  it("makes share-all follow the new owner", async () => {
    const { world } = harness;
    await world.updateUserAccess("bob", {
      grants: [{ who: "carol", rights: ["read"] }],
    });
    const scene = await world.createScene({
      owner: "alice",
      title: "Attic",
      body: "Dust.",
      visibility: "private",
    });
    expect(canRead(world.getUser("carol"), scene, world)).toBe(false);
    await world.transferSceneOwner(scene.id, "bob", { keepAccess: false });
    const moved = world.getScene(scene.id)!;
    expect(canRead(world.getUser("carol"), moved, world)).toBe(true);
    expect(canRead(world.getUser("alice"), moved, world)).toBe(false);
  });

  it("lets the owner transfer an ungrouped scene over HTTP", async () => {
    const { app, world, tokens } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Porch",
      body: "Boards.",
      visibility: "private",
    });
    const res = await app.request(`/s/${scene.id}/transfer`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "bob", keepAccess: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scene: { owner: string } };
    expect(body.scene.owner).toBe("bob");
    expect(world.getScene(scene.id)?.owner).toBe("bob");
  });

  it("returns 400 when transferring a grouped scene over HTTP", async () => {
    const { app, world, tokens } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Hall",
      body: "Open.",
      visibility: "private",
    });
    const group = await world.createGroup({ owner: "alice", title: "House" });
    await world.setSceneGroup(scene.id, group.id);
    const res = await app.request(`/s/${scene.id}/transfer`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "bob" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/transfer the group/i);
  });

  it("forbids a manage grantee from transferring", async () => {
    const { app, world, tokens } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Loft",
      body: "Beams.",
      visibility: "private",
    });
    await world.updateSceneAccess(scene.id, {
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const res = await app.request(`/s/${scene.id}/transfer`, {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ to: "carol" }),
    });
    expect(res.status).toBe(403);
    expect(world.getScene(scene.id)?.owner).toBe("alice");
  });

  it("lets a staff manager transfer a group over HTTP", async () => {
    const { app, world, tokens } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Cellar",
      body: "Cool.",
      visibility: "private",
    });
    const group = await world.createGroup({ owner: "alice", title: "House" });
    await world.setSceneGroup(scene.id, group.id);
    const res = await app.request(`/g/${group.id}/transfer`, {
      method: "POST",
      headers: auth(tokens.erin),
      body: JSON.stringify({ to: "bob", keepAccess: false }),
    });
    expect(res.status).toBe(200);
    expect(world.getGroup(group.id)?.owner).toBe("bob");
    expect(world.getScene(scene.id)?.owner).toBe("bob");
    expect(world.getGroup(group.id)?.grants).toEqual([]);
  });

  it("rejects an unknown recipient and self-transfer", async () => {
    const { app, world, tokens } = harness;
    const scene = await world.createScene({
      owner: "alice",
      title: "Roof",
      body: "Tiles.",
      visibility: "private",
    });
    const missing = await app.request(`/s/${scene.id}/transfer`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "nobody" }),
    });
    expect(missing.status).toBe(400);

    const self = await app.request(`/s/${scene.id}/transfer`, {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "alice" }),
    });
    expect(self.status).toBe(400);
    expect(world.getScene(scene.id)?.owner).toBe("alice");
  });

  it("shows transfer on the group page for the owner only", async () => {
    const { app, world, tokens } = harness;
    const group = await world.createGroup({ owner: "alice", title: "House" });
    await world.updateGroupAccess(group.id, {
      grants: [{ who: "bob", rights: ["manage"] }],
    });
    const owner = await app.request(`/g/${group.id}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.alice}` },
    });
    const ownerHtml = await owner.text();
    expect(ownerHtml).toContain("Transfer ownership");
    expect(ownerHtml).toContain(`action="g/${group.id}/transfer"`);
    expect(ownerHtml).toContain("Keep my access");

    const grantee = await app.request(`/g/${group.id}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${tokens.bob}` },
    });
    const granteeHtml = await grantee.text();
    expect(granteeHtml).not.toContain("Transfer ownership");
    expect(granteeHtml).toContain("Save group access");
  });
});
