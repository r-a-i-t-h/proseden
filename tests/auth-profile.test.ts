import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/auth/password.js";
import { SessionStore } from "../src/auth/sessions.js";
import { WorldStore } from "../src/store/world.js";

describe("profile and password change", () => {
  let dataDir: string;
  let world: WorldStore;
  let sessions: SessionStore;
  let token: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "proseden-profile-"));
    world = new WorldStore(dataDir);
    await world.load();
    const password = await hashPassword("secret1");
    await world.createUser("alice", password.hash, password.salt);
    sessions = new SessionStore();
    token = sessions.create("alice").token;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ world, sessions });
  }

  function auth(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  it("requires login to view the profile", async () => {
    const res = await app().request("/profile", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Log in to view your profile");
  });

  it("shows a password form to signed-in users and never leaks hashes", async () => {
    const res = await app().request("/profile", {
      headers: { Accept: "text/html", ...auth() },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Change password");
    expect(html).toContain('action="auth/password"');
    expect(html).toContain('href="profile"');
    expect(html).not.toContain("passwordHash");
    expect(html).not.toContain("passwordSalt");
  });

  it("changes the password and keeps the current session", async () => {
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const stillIn = await app().request("/profile", {
      headers: { Accept: "application/json", ...auth() },
    });
    expect(stillIn.status).toBe(200);

    const oldLogin = await app().request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret1" }),
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await app().request("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "secret2" }),
    });
    expect(newLogin.status).toBe(200);
  });

  it("invalidates other sessions for that user", async () => {
    const other = sessions.create("alice").token;
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
    });
    expect(res.status).toBe(200);

    const kicked = await app().request("/profile", {
      headers: { Authorization: `Bearer ${other}`, Accept: "text/html" },
    });
    expect(kicked.status).toBe(401);
  });

  it("rejects a wrong current password", async () => {
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "nope",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Current password is incorrect." });
  });

  it("rejects a confirmation mismatch and a short password", async () => {
    const mismatch = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret3",
      }),
    });
    expect(mismatch.status).toBe(400);

    const short = await app().request("/auth/password", {
      method: "POST",
      headers: auth({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        currentPassword: "secret1",
        newPassword: "ab",
        confirmPassword: "ab",
      }),
    });
    expect(short.status).toBe(400);
  });

  it("redirects HTML password changes back to the profile", async () => {
    const res = await app().request("/auth/password", {
      method: "POST",
      headers: auth({ "Content-Type": "application/x-www-form-urlencoded" }),
      body: new URLSearchParams({
        currentPassword: "secret1",
        newPassword: "secret2",
        confirmPassword: "secret2",
      }),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/profile?updated=1");
  });
});
