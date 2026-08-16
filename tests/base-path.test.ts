import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../src/auth/sessions.js";
import { createApp } from "../src/app.js";
import { WorldStore } from "../src/store/world.js";

describe("subdirectory base path", () => {
  let dataDir: string;
  let world: WorldStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-base-"));
    world = new WorldStore(dataDir);
    await world.load(join(process.cwd(), "seed"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function app(base: string) {
    return createApp({
      world,
      sessions: new SessionStore(),
      assetBase: base,
      staticRoot: join(process.cwd(), "public"),
    });
  }

  it("serves routes under the configured base path", async () => {
    const a = app("garden");
    const root = await a.request("/s/1", { headers: { Accept: "text/plain" } });
    expect(root.status).toBe(404);

    const nested = await a.request("/garden/s/1", { headers: { Accept: "text/plain" } });
    expect(nested.status).toBe(200);
    expect(await nested.text()).toContain("[Scene 1");
  });

  it("uses <base href> so assets and links resolve under the mount path", async () => {
    const a = app("garden");
    const res = await a.request("/garden/s/1", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<base href="/garden/" />');
    expect(html).toContain('href="assets/styles.css"');
    expect(html).toContain('src="assets/panel.js"');
    expect(html).toContain('action="auth/login"');
    expect(html).toContain('href="s/1?card"');
    expect(html).not.toContain('href="/assets/');
    expect(html).not.toContain('href="/s/1');
  });

  it("redirects stay inside the base path, with or without trailing slash", async () => {
    const a = app("garden");
    for (const path of ["/garden", "/garden/"]) {
      const res = await a.request(path, { redirect: "manual" });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/garden/s/1");
    }
  });

  it("serves static assets under the base path", async () => {
    const a = app("garden");
    const res = await a.request("/garden/assets/styles.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toMatch(/css/);
  });

  it("scopes session cookies to the base path and unique cookie name", async () => {
    const a = app("garden");
    const res = await a.request("/garden/auth/login", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username: "admin", password: "admin" }),
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.toLowerCase()).toContain("path=/garden");
    expect(setCookie).toMatch(/proseden_garden_session=/);
  });

  it("keeps root deploy working when base path is empty", async () => {
    const a = app("");
    const res = await a.request("/s/1", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<base href="/" />');
    expect(html).toContain('href="assets/styles.css"');
    expect(html).toContain('href="s/1?card"');
    const assets = await a.request("/assets/styles.css");
    expect(assets.status).toBe(200);
  });

  it("isolates two mounts on the same host via distinct data + base paths", async () => {
    const dataB = await mkdtemp(join(tmpdir(), "proseden-base-b-"));
    try {
      const worldB = new WorldStore(dataB);
      await worldB.load(join(process.cwd(), "seed"));
      const a = app("world-a");
      const b = createApp({
        world: worldB,
        sessions: new SessionStore(),
        assetBase: "world-b",
        staticRoot: join(process.cwd(), "public"),
      });

      const sceneA = await a.request("/world-a/s/1", { headers: { Accept: "text/html" } });
      const sceneB = await b.request("/world-b/s/1", { headers: { Accept: "text/html" } });
      expect(sceneA.status).toBe(200);
      expect(sceneB.status).toBe(200);
      expect(await sceneA.text()).toContain('<base href="/world-a/" />');
      expect(await sceneB.text()).toContain('<base href="/world-b/" />');

      const loginA = await a.request("/world-a/auth/login", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin" }),
      });
      const loginB = await b.request("/world-b/auth/login", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password: "admin" }),
      });
      const cookieA = loginA.headers.get("set-cookie") ?? "";
      const cookieB = loginB.headers.get("set-cookie") ?? "";
      expect(cookieA).toMatch(/proseden_world_a_session=/);
      expect(cookieB).toMatch(/proseden_world_b_session=/);
      expect(cookieA.toLowerCase()).toContain("path=/world-a");
      expect(cookieB.toLowerCase()).toContain("path=/world-b");
    } finally {
      await rm(dataB, { recursive: true, force: true });
    }
  });
});
