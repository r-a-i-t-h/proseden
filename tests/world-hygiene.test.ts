import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-polish-"));
  const world = new WorldStore(dataDir);
  await world.load();
  const password = await hashPassword("secret1");
  await world.createUser("alice", password.hash, password.salt);
  await world.createScene({
    owner: "alice",
    title: "Entrance",
    body: "Front door.",
    visibility: "public",
  });
  world.meta.entranceSceneId = 2;
  await world.saveMeta();
  await world.createScene({
    owner: "alice",
    title: "Study",
    body: "Quiet room.",
    visibility: "private",
  });
  const sessions = new SessionStore();
  const token = sessions.create("alice").token;
  const app = createApp({ world, sessions });
  return { world, app, dataDir, token };
}

function auth(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

describe("world hygiene", () => {
  let h: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    h = await harness();
  });

  afterEach(async () => {
    await rm(h.dataDir, { recursive: true, force: true });
  });

  it("refuses to delete the world entrance", async () => {
    const res = await h.app.request("/s/2/delete", {
      method: "POST",
      headers: auth(h.token),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/entrance/i);
    expect(h.world.getScene(2)).toBeTruthy();
  });

  it("cascades artefact and inbound exit cleanup on scene delete", async () => {
    const art = await h.world.createArtefact({
      owner: "alice",
      homeSceneId: 3,
      title: "Note",
      body: "scratch",
    });
    await h.world.addExit(1, "into study", 3);
    await h.world.updateScene(
      3,
      { body: "edited" },
      { by: "alice", retainSnapshot: true },
    );

    const res = await h.app.request("/s/3/delete", {
      method: "POST",
      headers: auth(h.token),
    });
    expect(res.status).toBe(200);
    expect(h.world.getScene(3)).toBeUndefined();
    expect(h.world.getArtefact(art.id)).toBeUndefined();
    expect(h.world.getExits(1).some((e) => e.toSceneId === 3)).toBe(false);

    await expect(access(join(h.dataDir, "scenes", "3.md"))).rejects.toThrow();
    await expect(access(join(h.dataDir, "artefacts", `${art.id}.md`))).rejects.toThrow();
  });

  it("blocks deleting an entrance-group entrance while members remain", async () => {
    await h.world.createScene({
      owner: "alice",
      title: "Inner",
      body: "deeper",
      visibility: "private",
    });
    const eg = await h.world.createEntranceGroup({
      title: "Wing",
      entranceSceneId: 2,
      sceneIds: [4],
    });
    expect(eg.id).toBeTruthy();

    const res = await h.app.request("/s/2/delete", {
      method: "POST",
      headers: auth(h.token),
    });
    expect(res.status).toBe(400);
    expect(h.world.getScene(2)).toBeTruthy();
  });

  it("removes exits via API", async () => {
    const exit = await h.world.addExit(1, "side door", 2);
    const res = await h.app.request(`/s/1/exits/${exit.exitId}/delete`, {
      method: "POST",
      headers: auth(h.token),
    });
    expect(res.status).toBe(200);
    expect(h.world.findExit(1, String(exit.exitId))).toBeUndefined();
  });

  it("reorders exits in place without changing ids or gates", async () => {
    const a = await h.world.addExit(1, "north", 2);
    const b = await h.world.addExit(1, "east", 2, {
      when: "quest.open",
      whenDenied: "Closed.",
      hidden: true,
    });
    const c = await h.world.addExit(1, "south", 2);
    const reordered = await h.world.reorderExits(1, [c.exitId, a.exitId, b.exitId]);
    expect(reordered.map((e) => e.exitId)).toEqual([c.exitId, a.exitId, b.exitId]);
    expect(h.world.getExits(1).map((e) => e.nickname)).toEqual(["south", "north", "east"]);
    expect(h.world.getExits(1)[2]).toMatchObject({
      nickname: "east",
      toSceneId: 2,
      when: "quest.open",
      whenDenied: "Closed.",
      hidden: true,
    });
    await expect(h.world.reorderExits(1, [c.exitId])).rejects.toThrow(/permutation/i);
  });

  it("rejects invalid details JSON with 400", async () => {
    const res = await h.app.request("/s/1", {
      method: "PUT",
      headers: {
        ...auth(h.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Entrance",
        body: "Front door.",
        detailsJson: "{not-json",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/details/i);
  });

  it("demotes public visibility when form sends hidden private", async () => {
    await h.world.updateScene(2, { visibility: "public" }, { by: "alice" });
    const res = await h.app.request("/s/2", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${h.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        title: "Study",
        body: "Quiet room.",
        visibility: "private",
      }),
      redirect: "manual",
    });
    expect([200, 302]).toContain(res.status);
    expect(h.world.getScene(2)?.visibility).toBe("private");
  });

  it("clears junction when isJunction=false is posted", async () => {
    await h.world.updateScene(2, { visibility: "public", isJunction: true }, { by: "alice" });
    const res = await h.app.request("/s/2", {
      method: "PUT",
      headers: {
        ...auth(h.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Study",
        body: "Quiet room.",
        visibility: "public",
        isJunction: false,
      }),
    });
    expect(res.status).toBe(200);
    expect(h.world.getScene(2)?.isJunction).toBe(false);
  });

  it("clears repository when isRepository=false is posted", async () => {
    await h.world.updateScene(2, { visibility: "public", isRepository: true }, { by: "alice" });
    const res = await h.app.request("/s/2", {
      method: "PUT",
      headers: {
        ...auth(h.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Entrance",
        body: "Front door.",
        visibility: "public",
        isRepository: false,
      }),
    });
    expect(res.status).toBe(200);
    expect(h.world.getScene(2)?.isRepository).toBe(false);
  });
});
