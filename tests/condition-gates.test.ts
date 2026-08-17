import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

type App = ReturnType<typeof createApp>;

async function createConditionWorld(): Promise<{
  world: WorldStore;
  app: App;
  dataDir: string;
  tokens: Record<string, string>;
  hallId: number;
  cellarId: number;
  clubId: number;
  studyId: number;
  keyId: number;
  sigilId: number;
  cellarExitId: number;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-cond-"));
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
  const cellar = await world.createScene({
    owner: "alice",
    title: "Cellar",
    body: "Damp stone.",
    visibility: "public",
  });
  const club = await world.createScene({
    owner: "alice",
    title: "Club",
    body: "A quiet lounge.",
    visibility: "public",
  });
  const study = await world.createScene({
    owner: "alice",
    title: "Study",
    body: "Quiet.",
    visibility: "public",
  });

  await world.updateScene(
    club.id,
    { when: "badge:demo.x", whenDenied: "Members only." },
    { by: "alice" },
  );
  await world.updateScene(
    study.id,
    { when: "quest.open", whenDenied: "The study is shut." },
    { by: "alice" },
  );

  const key = await world.createArtefact({
    owner: "alice",
    homeSceneId: hall.id,
    title: "Cellar key",
    body: "Iron.",
  });
  const sigil = await world.createArtefact({
    owner: "alice",
    homeSceneId: hall.id,
    title: "Club sigil",
    body: "A badge of membership.",
    when: "badge:demo.x",
  });

  await world.updateScene(
    hall.id,
    {
      details: { plaque: "Welcome.", inscription: "A hidden line." },
      detailWhen: { inscription: `holds:${key.id}` },
    },
    { by: "alice" },
  );

  const cellarExit = await world.addExit(hall.id, "cellar", cellar.id, {
    when: `holds:${key.id}`,
    whenDenied: "You need the key.",
    hidden: true,
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
    cellarId: cellar.id,
    clubId: club.id,
    studyId: study.id,
    keyId: key.id,
    sigilId: sigil.id,
    cellarExitId: cellarExit.exitId,
  };
}

function auth(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "text/plain",
    ...extra,
  };
}

describe("HTTP world condition schemes", () => {
  let harness: Awaited<ReturnType<typeof createConditionWorld>>;

  beforeEach(async () => {
    harness = await createConditionWorld();
  });

  afterEach(async () => {
    await rm(harness.dataDir, { recursive: true, force: true });
  });

  it("unprefixed flag remains the default scene gate", async () => {
    const { app, tokens, world, studyId } = harness;
    const headers = auth(tokens.bob);

    const shut = await app.request(`/s/${studyId}`, { headers });
    expect(shut.status).toBe(403);
    expect(await shut.text()).toContain("The study is shut.");

    await world.saveUserFlags("bob", { "quest.open": true });
    const open = await app.request(`/s/${studyId}`, { headers });
    expect(open.status).toBe(200);
    expect(await open.text()).toContain("Quiet.");
  });

  it("exit holds: follows current inventory", async () => {
    const { app, tokens, world, hallId, cellarId, keyId, cellarExitId } = harness;
    const headers = auth(tokens.bob);

    const listed = await app.request(`/s/${hallId}`, { headers });
    expect(listed.status).toBe(200);
    const listedText = await listed.text();
    expect(listedText).not.toContain("- cellar");
    expect(listedText).not.toContain("inscription");

    const denied = await app.request(`/s/${hallId}/go/${cellarExitId}`, {
      headers,
      redirect: "manual",
    });
    expect(denied.status).toBe(403);
    expect(await denied.text()).toContain("You need the key.");

    await world.collectArtefact("bob", keyId);

    const withKey = await app.request(`/s/${hallId}`, { headers });
    const withKeyText = await withKey.text();
    expect(withKeyText).toContain("- cellar");
    expect(withKeyText).toContain("inscription");

    const allowed = await app.request(`/s/${hallId}/go/${cellarExitId}`, {
      headers,
      redirect: "manual",
    });
    expect(allowed.status).toBe(302);
    expect(allowed.headers.get("location")).toBe(`/s/${cellarId}?from=${hallId}`);

    await world.dropArtefact("bob", keyId);
    const afterDrop = await app.request(`/s/${hallId}/go/${cellarExitId}`, {
      headers,
      redirect: "manual",
    });
    expect(afterDrop.status).toBe(403);
  });

  it("scene and artefact badge: follow current badges", async () => {
    const { app, tokens, world, hallId, clubId, sigilId } = harness;
    const headers = auth(tokens.bob);

    const clubShut = await app.request(`/s/${clubId}`, { headers });
    expect(clubShut.status).toBe(403);
    expect(await clubShut.text()).toContain("Members only.");

    const hall = await app.request(`/s/${hallId}`, { headers });
    expect(await hall.text()).not.toContain("Club sigil");

    const collect = await app.request(`/a/${sigilId}/collect`, {
      method: "POST",
      headers,
      redirect: "manual",
    });
    expect(collect.status).toBe(403);

    await world.saveUserBadges("bob", [{ badge: "demo.x" }]);

    const clubOpen = await app.request(`/s/${clubId}`, { headers });
    expect(clubOpen.status).toBe(200);
    expect(await clubOpen.text()).toContain("A quiet lounge.");

    const hallWithBadge = await app.request(`/s/${hallId}`, { headers });
    expect(await hallWithBadge.text()).toContain("Club sigil");

    const collectOk = await app.request(`/a/${sigilId}/collect`, {
      method: "POST",
      headers,
      redirect: "manual",
    });
    expect(collectOk.status).toBe(302);
  });

  it("anonymous readers have empty inventory and badges", async () => {
    const { app, hallId, clubId } = harness;
    const headers = { Accept: "text/plain" };

    const hall = await app.request(`/s/${hallId}`, { headers });
    expect(hall.status).toBe(200);
    const text = await hall.text();
    expect(text).not.toContain("- cellar");
    expect(text).not.toContain("inscription");
    expect(text).not.toContain("Club sigil");

    const club = await app.request(`/s/${clubId}`, { headers });
    expect(club.status).toBe(401);
  });
});
