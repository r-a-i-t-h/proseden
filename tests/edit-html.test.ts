import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/auth/sessions.js";
import { createApp } from "../src/app.js";
import { editModeHrefs } from "../src/render/html.js";
import { WorldStore } from "../src/store/world.js";

describe("editModeHrefs", () => {
  it("adds and removes the edit flag, keeping other query keys", () => {
    const hrefs = editModeHrefs("http://example.test/garden/s/1?card&from=2", "/garden");
    expect(hrefs.editHref).toBe("s/1?card&from=2&edit");
    expect(hrefs.readHref).toBe("s/1?card&from=2");
  });

  it("uses ./ on the mount root", () => {
    const hrefs = editModeHrefs("http://example.test/garden/", "/garden");
    expect(hrefs.editHref).toBe("./?edit");
    expect(hrefs.readHref).toBe("./");
  });
});

describe("read-only HTML vs edit bootstrap", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-edit-html-"));
    world = new WorldStore(dataDir);
    await world.load(join(process.cwd(), "seed"));
    sessions = new SessionStore();
    token = sessions.create("gardener").token;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ world, sessions });
  }

  it("serves hypertext without editor forms", async () => {
    const res = await app().request("/s/1", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('src="assets/panel.js"');
    expect(html).toContain('id="edit-root"');
    expect(html).toContain('id="edit-bootstrap"');
    expect(html).toContain("Moss softens the stone step");
    expect(html).toContain('href="u/gardener"');
    expect(html).toContain('<p class="byline">by <a href="u/gardener">gardener</a></p>');
    expect(html).not.toContain("data-method");
    expect(html).not.toContain("Create scene");
    expect(html).not.toContain("Save scene");
    expect(html).toContain('id="panel-edit"');
    expect(html).toMatch(/id="panel-edit"[^>]*\sdisabled/);
    expect(html).toContain('class="mode-switch"');
    expect(html).toContain('action="auth/login"');
    expect(html).toContain("<summary>Log in</summary>");
    expect(html).toContain("<summary>Register</summary>");
    expect(html).toContain('action="auth/register"');
    // Register is a sibling of Log in, not nested inside it.
    expect(html.indexOf("</details>")).toBeLessThan(html.indexOf('<details class="register">'));
    const version = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).version;
    expect(html).toContain(`<footer class="site-footer">`);
    expect(html).toContain("proseden");
    expect(html).toContain("by raith &amp; cursor");
    expect(html).toContain("&copy; 2026");
    expect(html).toContain(`v${version}`);
    expect(html).toContain("<h2>Actions</h2>");
    expect(html).toContain("Teleport to scene id:");
    expect(html).toContain("Invite to view, user:");
    expect(html).toContain('id="invite-form"');
    expect(html).toContain('name="userid"');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain("Invite");
  });

  it("badges the public junction entrance and omits ACL group membership", async () => {
    const entrance = await app().request("/s/1", { headers: { Accept: "text/html" } });
    const entranceHtml = await entrance.text();
    expect(entranceHtml).toContain('<p class="meta">public · junction · entrance</p>');
    expect(entranceHtml).not.toMatch(/class="meta">[^<]*group\s+\d/);

    // Scene 2 is in the same entrance group; arrive from the entrance so we are not redirected.
    const member = await app().request("/s/2?from=1", { headers: { Accept: "text/html" } });
    const memberHtml = await member.text();
    expect(memberHtml).toContain('<p class="meta">public</p>');
    expect(memberHtml).not.toMatch(/class="meta">[^<]*(junction|entrance|group\s+\d)/);
  });

  it("includes junction and entrance tags in the text view", async () => {
    const entrance = await app().request("/s/1", { headers: { Accept: "text/plain" } });
    expect(await entrance.text()).toContain("visibility: public · junction · entrance");

    const member = await app().request("/s/2?from=1", { headers: { Accept: "text/plain" } });
    const memberText = await member.text();
    expect(memberText).toContain("visibility: public\n");
    expect(memberText).not.toContain("junction");
    expect(memberText).not.toContain("entrance");
  });

  it("signed-in read view offers Edit but still no mutation forms", async () => {
    const res = await app().request("/s/1", {
      headers: { Accept: "text/html", Authorization: `Bearer ${token}` },
    });
    const html = await res.text();
    expect(html).toContain('id="panel-edit"');
    expect(html).not.toMatch(/id="panel-edit"[^>]*\sdisabled/);
    expect(html).toContain('class="mode-switch"');
    expect(html).toContain("s/1?edit");
    expect(html).toContain('href="profile"');
    expect(html).toContain('href="inv"');
    expect(html.indexOf('href="profile"')).toBeLessThan(html.indexOf('href="inv"'));
    expect(html.indexOf('href="inv"')).toBeLessThan(html.indexOf('id="panel-edit"'));
    expect(html).not.toContain("data-method");
    expect(html).not.toContain("Create scene");
    expect(html).toContain('"username":"gardener"');
    expect(html).toContain('href="u/gardener"');
    expect(html).not.toContain("passwordHash");
  });

  it("does not treat ?edit as a detail name", async () => {
    const res = await app().request("/s/1?edit", { headers: { Accept: "text/html" } });
    const html = await res.text();
    expect(html).toContain("Moss softens the stone step");
    expect(html).not.toContain("No detail named");
    expect(html).toContain("s/1?edit");
  });

  it("still opens a named detail when combined with ?edit", async () => {
    const res = await app().request("/s/1?card&edit", { headers: { Accept: "text/html" } });
    const html = await res.text();
    expect(html).toContain("detail: card");
    expect(html).toContain("deckle-edged");
  });

  it("shows collect on a signed-in artefact page", async () => {
    const res = await app().request("/a/1", {
      headers: { Accept: "text/html", Authorization: `Bearer ${token}` },
    });
    const html = await res.text();
    expect(html).toContain('action="a/1/collect"');
    expect(html).toContain("Collect");
    expect(html).not.toContain("Save artefact");
  });
});

describe("create scene then exit from a junction", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let bob: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-edit-link-"));
    world = new WorldStore(dataDir);
    await world.load(join(process.cwd(), "seed"));
    sessions = new SessionStore();
    bob = sessions.create("visitor").token;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("lets a visitor create a scene and attach it from the public junction", async () => {
    const app = createApp({ world, sessions });
    const created = await app.request("/s", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bob}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: "Visitor nook", body: "A quiet corner." }),
    });
    expect(created.status).toBe(201);
    const scene = (await created.json()) as { id: number };
    const linked = await app.request("/s/1/exits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bob}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nickname: "visitor nook", toSceneId: scene.id }),
    });
    expect(linked.status).toBe(201);
    const back = await app.request(`/s/${scene.id}/exits`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bob}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ nickname: "threshold", toSceneId: 1 }),
    });
    expect(back.status).toBe(201);
    const exits = world.getExits(1);
    expect(exits.some((e) => e.toSceneId === scene.id && e.nickname === "visitor nook")).toBe(true);
    const returnExits = world.getExits(scene.id);
    expect(returnExits.some((e) => e.toSceneId === 1 && e.nickname === "threshold")).toBe(true);
  });
});
