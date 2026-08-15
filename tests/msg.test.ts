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
  app: App;
  dataDir: string;
  tokens: Record<string, string>;
}> {
  const dataDir = await mkdtemp(join(tmpdir(), "proseden-msg-"));
  const world = new WorldStore(dataDir);
  await world.load();

  const password = await hashPassword("secret1");
  for (const name of ["alice", "bob", "carol"]) {
    await world.createUser(name, password.hash, password.salt);
  }
  await world.setStaffRoles("alice", ["manager"]);

  const sessions = new SessionStore();
  const tokens: Record<string, string> = {};
  for (const name of ["alice", "bob", "carol"]) {
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

describe("manager messages", () => {
  let world: WorldStore;
  let app: App;
  let dataDir: string;
  let tokens: Record<string, string>;

  beforeEach(async () => {
    ({ world, app, dataDir, tokens } = await createTestWorld());
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("restricts /msg to managers", async () => {
    const anon = await app.request("/msg", { headers: { Accept: "application/json" } });
    expect(anon.status).toBe(401);

    const user = await app.request("/msg", { headers: auth(tokens.bob) });
    expect(user.status).toBe(403);

    const manager = await app.request("/msg", { headers: auth(tokens.alice) });
    expect(manager.status).toBe(200);
    const body = await manager.json();
    expect(body.users).toEqual(["alice", "bob", "carol"]);
    expect(body.all).toBe("*");
    expect(body.peerMessagingEnabled).toBe(true);
  });

  it("lists usernames and ALL users on the HTML form", async () => {
    const res = await app.request("/msg", {
      headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<h1>Msg</h1>");
    expect(html).toContain("Peer messaging");
    expect(html).toContain("Disable peer messaging");
    expect(html).toContain("ALL users");
    expect(html).toContain('<option value="*">ALL users</option>');
    expect(html).toContain('<option value="alice">alice</option>');
    expect(html).toContain('<option value="bob">bob</option>');
    expect(html).toContain('<option value="carol">carol</option>');
    expect(html).toContain("_emphasis_");
    expect(html).toContain("*bold*");
    expect(html).toContain("~strike~");
  });

  it("sends a notice to one user", async () => {
    const res = await app.request("/msg", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({
        to: "bob",
        body: "Please *read* the ~old~ hall.\n\n---\n\n[door](https://example.com)",
      }),
    });
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
    expect(payload.to).toEqual(["bob"]);
    expect(payload.count).toBe(1);
    expect(payload.messages[0].type).toBe("notice");
    expect(payload.messages[0].fromUser).toBe("alice");
    expect(payload.messages[0].subject).toBe("Manager message from alice");

    expect(world.listInboxFor("bob")).toHaveLength(1);
    expect(world.listInboxFor("alice")).toHaveLength(0);
    expect(world.listInboxFor("carol")).toHaveLength(0);

    const inbox = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.bob}`, Accept: "text/html" },
    });
    const html = await inbox.text();
    expect(html).toContain("Manager message from alice");
    expect(html).toContain("<strong>read</strong>");
    expect(html).toContain("<s>old</s>");
    expect(html).toContain("<hr />");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("Messages (1)");
    expect(html).not.toContain("Reply");
  });

  it("sends a notice to ALL users", async () => {
    const res = await app.request("/msg", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "*", body: "_Hello_ everyone." }),
    });
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.to).toEqual(["alice", "bob", "carol"]);
    expect(payload.count).toBe(3);

    for (const name of ["alice", "bob", "carol"]) {
      const messages = world.listInboxFor(name);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toBe("_Hello_ everyone.");
    }

    const carolInbox = await app.request("/inbox", {
      headers: { Authorization: `Bearer ${tokens.carol}`, Accept: "text/html" },
    });
    expect(await carolInbox.text()).toContain("<em>Hello</em>");
  });

  it("accepts ALL as a recipient alias", async () => {
    const res = await app.request("/msg", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "ALL users", body: "Broadcast." }),
    });
    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.count).toBe(3);
  });

  it("rejects an empty body and unknown recipient", async () => {
    const empty = await app.request("/msg", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "bob", body: "   " }),
    });
    expect(empty.status).toBe(400);
    expect((await empty.json()).error).toMatch(/required/i);

    const unknown = await app.request("/msg", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "nobody", body: "Hi." }),
    });
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatch(/not found/i);
  });

  it("shows a success notice after an HTML send", async () => {
    const posted = await app.request("/msg", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "to=bob&body=Hello+bob.",
      redirect: "manual",
    });
    expect(posted.status).toBe(302);
    expect(posted.headers.get("location")).toMatch(/\/msg\?sent=bob$/);

    const page = await app.request("/msg?sent=bob", {
      headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
    });
    const html = await page.text();
    expect(html).toContain('role="status"');
    expect(html).toContain("Message sent to bob.");
  });

  it("shows a failure notice on the HTML form", async () => {
    const res = await app.request("/msg", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "to=nobody&body=Still+here.",
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('role="alert"');
    expect(html).toContain("notice-error");
    expect(html).toContain("User not found: nobody");
    expect(html).toContain("Still here.");
    expect(html).toContain('name="body"');
  });

  it("forbids a non-manager from sending", async () => {
    const res = await app.request("/msg", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ to: "carol", body: "Nope." }),
    });
    expect(res.status).toBe(403);
    expect(world.listInboxFor("carol")).toHaveLength(0);
  });

  it("toggles peer messaging and purges inbox from a user", async () => {
    await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "alice", body: "Spam one" }),
    });
    await app.request("/inbox/send", {
      method: "POST",
      headers: auth(tokens.bob),
      body: JSON.stringify({ uid: "carol", body: "Spam two" }),
    });
    await app.request("/msg", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ to: "carol", body: "Keep me" }),
    });
    expect(world.listInboxFor("alice")).toHaveLength(1);
    expect(world.listInboxFor("carol")).toHaveLength(2);

    const off = await app.request("/msg/peer-messaging", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    expect((await off.json()).peerMessagingEnabled).toBe(false);
    expect(world.isPeerMessagingEnabled()).toBe(false);

    const msgPage = await app.request("/msg", { headers: auth(tokens.alice) });
    expect((await msgPage.json()).peerMessagingEnabled).toBe(false);

    const html = await (
      await app.request("/msg", {
        headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/html" },
      })
    ).text();
    expect(html).toContain("Enable peer messaging");
    expect(html).toContain("Purge inbox from user");

    const purge = await app.request("/msg/purge-from", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ uid: "bob" }),
    });
    expect(purge.status).toBe(200);
    const purged = await purge.json();
    expect(purged.deleted).toBe(2);
    expect(purged.uid).toBe("bob");
    expect(world.listInboxFor("alice")).toHaveLength(0);
    expect(world.listInboxFor("carol")).toHaveLength(1);
    expect(world.listInboxFor("carol")[0]!.fromUser).toBe("alice");

    const on = await app.request("/msg/peer-messaging", {
      method: "POST",
      headers: auth(tokens.alice),
      body: JSON.stringify({ enabled: true }),
    });
    expect((await on.json()).peerMessagingEnabled).toBe(true);
  });

  it("serves text compose hints and a clear send result", async () => {
    const page = await app.request("/msg", {
      headers: { Authorization: `Bearer ${tokens.alice}`, Accept: "text/plain" },
    });
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(text).toContain("[Msg]");
    expect(text).toContain("to: username or * (ALL users)");
    expect(text).toContain("Peer messaging: enabled");
    expect(text).toContain("alice");

    const sent = await app.request("/msg", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.alice}`,
        Accept: "text/plain",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: "bob", body: "Ping." }),
    });
    expect(sent.status).toBe(201);
    expect(await sent.text()).toContain("Message sent to bob.");
  });
});
