import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { ownedSceneLinksFor, wantsJson } from "../http.js";
import { negotiateFormat } from "../render/format.js";
import { renderHtmlPage, renderMessageBodyHtml } from "../render/html.js";
import { renderMessageText } from "../render/text.js";

export const authRoutes = new Hono();

authRoutes.post("/register", async (c) => {
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
    return c.json({ ok: true, username: user.username, token: session.token }, 201);
  }
  return c.redirect(`${c.get("assetBase")}/`);
});

authRoutes.post("/login", async (c) => {
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
    return c.json({ ok: true, username: user.username, token: session.token });
  }
  return c.redirect(`${c.get("assetBase")}/`);
});

authRoutes.post("/logout", async (c) => {
  const sessions = c.get("sessions");
  const cookieName = c.get("sessionCookieName");
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const cookieHeader = c.req.header("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  sessions.destroy(bearer ?? match?.[1]);
  deleteCookie(c, cookieName, { path: c.get("assetBase") || "/" });

  if (wantsJson(c)) return c.json({ ok: true });
  return c.redirect(`${c.get("assetBase")}/`);
});

function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || process.env.PROSEDEN_SECURE_COOKIES === "1";
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
  const format = negotiateFormat(c);
  if (format === "text") {
    return c.text(renderMessageText(title, message), status);
  }
  return c.html(
    renderHtmlPage({
      title,
      bodyHtml: renderMessageBodyHtml(title, message),
      user: c.get("user"),
      assetBase: c.get("assetBase"),
      ownedScenes: ownedSceneLinksFor(c),
    }),
    status,
  );
}
