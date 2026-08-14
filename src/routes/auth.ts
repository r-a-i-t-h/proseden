import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { canRead } from "../access/permissions.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { page, wantsJson } from "../http.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { clientIp } from "../rate-limit/client-ip.js";
import { renderMessageBodyHtml } from "../render/html.js";
import { renderMessageText } from "../render/text.js";
import type { UserRecord } from "../model/types.js";
import type { WorldStore } from "../store/world.js";

export const authRoutes = new Hono();

const authAttemptLimit = rateLimit({
  name: "auth",
  bucket: (limits) => limits.auth,
  key: authAttemptKeys,
});

const authPasswordLimit = rateLimit({
  name: "auth",
  bucket: (limits) => limits.auth,
  key: (c) => {
    const ip = clientIp(c);
    const user = c.get("user");
    return user ? [`ip:${ip}`, `user:${user.username.toLowerCase()}`] : [`ip:${ip}`];
  },
});

authRoutes.post("/register", authAttemptLimit, async (c) => {
  const world = c.get("world");
  const sessions = c.get("sessions");
  const body = await readAuthBody(c);
  if (!body.username || !body.password) {
    return respond(c, 400, "Register", "Username and password required.");
  }
  if (!/^[a-zA-Z0-9_-]{2,32}$/.test(body.username)) {
    return respond(
      c,
      400,
      "Register",
      "Username must be 2–32 characters: letters, numbers, _ or -.",
    );
  }
  if (body.password.length < 6) {
    return respond(c, 400, "Register", "Password must be at least 6 characters.");
  }
  if (world.getUser(body.username)) {
    return respond(c, 409, "Register", "Username already taken.");
  }

  const { hash, salt } = await hashPassword(body.password);
  const user = await world.createUser(body.username, hash, salt);
  const session = sessions.create(user.username);
  const cookieName = c.get("sessionCookieName");
  setCookie(c, cookieName, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    path: c.get("assetBase") || "/",
    maxAge: 60 * 60 * 24 * 14,
    secure: cookieSecure(),
  });

  if (body.json) {
    return c.json(
      {
        ok: true,
        username: user.username,
        token: session.token,
        lastSceneId: resumeSceneId(world, user) ?? null,
      },
      201,
    );
  }
  return c.redirect(resumeRedirect(c, user));
});

authRoutes.post("/login", authAttemptLimit, async (c) => {
  const world = c.get("world");
  const sessions = c.get("sessions");
  const body = await readAuthBody(c);
  if (!body.username || !body.password) {
    return respond(c, 400, "Login", "Username and password required.");
  }
  const user = world.getUser(body.username);
  if (!user || !(await verifyPassword(body.password, user.passwordHash, user.passwordSalt))) {
    return respond(c, 401, "Login", "Invalid username or password.");
  }
  const session = sessions.create(user.username);
  const cookieName = c.get("sessionCookieName");
  setCookie(c, cookieName, session.token, {
    httpOnly: true,
    sameSite: "Lax",
    path: c.get("assetBase") || "/",
    maxAge: 60 * 60 * 24 * 14,
    secure: cookieSecure(),
  });
  if (body.json) {
    return c.json({
      ok: true,
      username: user.username,
      token: session.token,
      lastSceneId: resumeSceneId(world, user) ?? null,
    });
  }
  return c.redirect(resumeRedirect(c, user));
});

authRoutes.post("/password", authPasswordLimit, async (c) => {
  const world = c.get("world");
  const sessions = c.get("sessions");
  const user = c.get("user");
  if (!user) {
    return respond(c, 401, "Profile", "Log in to change your password.");
  }

  const body = await readPasswordChangeBody(c);
  if (!body.currentPassword || !body.newPassword || !body.confirmPassword) {
    return respond(
      c,
      400,
      "Profile",
      "Current password, new password, and confirmation are required.",
    );
  }
  if (!(await verifyPassword(body.currentPassword, user.passwordHash, user.passwordSalt))) {
    return respond(c, 401, "Profile", "Current password is incorrect.");
  }
  if (body.newPassword.length < 6) {
    return respond(c, 400, "Profile", "Password must be at least 6 characters.");
  }
  if (body.newPassword !== body.confirmPassword) {
    return respond(c, 400, "Profile", "New password and confirmation do not match.");
  }

  const { hash, salt } = await hashPassword(body.newPassword);
  await world.updatePassword(user.username, hash, salt);
  sessions.destroyAllForUser(user.username, requestToken(c));

  if (body.json) {
    return c.json({ ok: true });
  }
  return c.redirect(`${c.get("assetBase")}/profile?updated=1`);
});

authRoutes.post("/logout", async (c) => {
  const sessions = c.get("sessions");
  const user = c.get("user");
  if (user) await c.get("locations").flush(user.username);
  const cookieName = c.get("sessionCookieName");
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const cookieHeader = c.req.header("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  sessions.destroy(bearer ?? match?.[1]);
  deleteCookie(c, cookieName, { path: c.get("assetBase") || "/" });

  if (wantsJson(c)) return c.json({ ok: true });
  return c.redirect(`${c.get("assetBase")}/`);
});

function resumeSceneId(world: WorldStore, user: UserRecord): number | undefined {
  if (user.lastSceneId === undefined) return undefined;
  const scene = world.getScene(user.lastSceneId);
  if (!scene || !canRead(user, scene, world)) return undefined;
  return scene.id;
}

function resumeRedirect(c: Context, user: UserRecord): string {
  const world = c.get("world");
  const id = resumeSceneId(world, user);
  const base = c.get("assetBase");
  if (id !== undefined) return `${base}/s/${id}`;
  return `${base}/`;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.PROSEDEN_SECURE_COOKIES === "1";
}

function requestToken(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return getCookie(c, c.get("sessionCookieName"));
}

async function readPasswordChangeBody(c: Context): Promise<{
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
  json: boolean;
}> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await c.req.json<{
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    }>();
    return { ...json, json: true };
  }
  const form = await c.req.parseBody();
  return {
    currentPassword: String(form.currentPassword ?? ""),
    newPassword: String(form.newPassword ?? ""),
    confirmPassword: String(form.confirmPassword ?? ""),
    json: wantsJson(c),
  };
}

async function authAttemptKeys(c: Context): Promise<string[]> {
  const ip = clientIp(c);
  const username = await peekAuthUsername(c);
  const keys = [`ip:${ip}`];
  if (username) keys.push(`user:${username.toLowerCase()}`);
  return keys;
}

async function peekAuthUsername(c: Context): Promise<string | undefined> {
  try {
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = await c.req.json<{ username?: unknown }>();
      return typeof json?.username === "string" && json.username.trim()
        ? json.username.trim()
        : undefined;
    }
    const form = await c.req.parseBody();
    const username = form.username;
    return typeof username === "string" && username.trim() ? username.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function readAuthBody(c: Context): Promise<{
  username?: string;
  password?: string;
  json: boolean;
}> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = await c.req.json<{ username?: string; password?: string }>();
    return { ...json, json: true };
  }
  const form = await c.req.parseBody();
  return {
    username: String(form.username ?? ""),
    password: String(form.password ?? ""),
    json: wantsJson(c),
  };
}

function respond(c: Context, status: 400 | 401 | 409, title: string, message: string) {
  if (wantsJson(c)) {
    return c.json({ error: message }, status);
  }
  return page(
    c,
    status,
    title,
    renderMessageBodyHtml(title, message),
    renderMessageText(title, message),
  );
}
