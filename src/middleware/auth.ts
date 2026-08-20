import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

const DEFAULT_COOKIE = "proseden_session";

export function sessionCookieNameForBase(assetBase: string): string {
  if (!assetBase) return DEFAULT_COOKIE;
  const slug = assetBase.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "_");
  return `proseden_${slug}_session`;
}

/** Bearer token or session cookie — same resolution as `loadUser`. */
export function requestSessionToken(c: Context): string | undefined {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    const token = header.slice(7).trim();
    return token || undefined;
  }
  const cookieName = c.get("sessionCookieName") || DEFAULT_COOKIE;
  return getCookie(c, cookieName) || undefined;
}

export const loadUser = createMiddleware(async (c, next) => {
  const sessions = c.get("sessions");
  const world = c.get("world");
  const token = requestSessionToken(c);

  const session = sessions.get(token);
  if (session) {
    const user = world.getUser(session.username);
    if (user) c.set("user", user);
  }

  await next();
});
