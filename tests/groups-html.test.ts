import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("group ACL pages", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let alice: string;
  let bob: string;
  let groupId: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-groups-html-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    await world.createUser("bob", password.hash, password.salt);
    const scene = await world.createScene({
      owner: "alice",
      title: "Study",
      body: "Quiet.",
      visibility: "private",
    });
    const group = await world.createGroup({ owner: "alice", title: "Alice Rooms" });
    groupId = group.id;
    await world.setSceneGroup(scene.id, group.id);
    sessions = new SessionStore();
    alice = sessions.create("alice").token;
    bob = sessions.create("bob").token;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ world, sessions });
  }

  it("requires login to list groups", async () => {
    const res = await app().request("/g", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(401);
  });

  it("lists groups the signed-in user can manage", async () => {
    const res = await app().request("/g", {
      headers: { Accept: "text/html", Authorization: `Bearer ${alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Alice Rooms");
    expect(html).toContain(`href="g/${groupId}"`);
    expect(html).toContain("Groups you manage");
    expect(html).toContain('action="g"');
  });

  it("lets the owner edit group ACL on the group page", async () => {
    const res = await app().request(`/g/${groupId}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${alice}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Save group access");
    expect(html).toContain(`action="g/${groupId}/access"`);
    expect(html).toContain("Study");
    expect(html).not.toContain("passwordHash");
  });

  it("hides the ACL form from readers without manage", async () => {
    await world.updateGroupAccess(groupId, {
      grants: [{ who: "bob", rights: ["read"] }],
    });
    const res = await app().request(`/g/${groupId}`, {
      headers: { Accept: "text/html", Authorization: `Bearer ${bob}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("Save group access");
    expect(html).toContain("bob [read]");
  });

  it("saves group ACL from the HTML form", async () => {
    const res = await app().request(`/g/${groupId}/access`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${alice}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grantsJson: JSON.stringify([{ who: "bob", rights: ["read"] }]),
        deniesJson: "[]",
      }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/g/${groupId}?updated=1`);
    expect(world.getGroup(groupId)?.grants).toEqual([{ who: "bob", rights: ["read"] }]);
  });
});
