import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

const DEFAULT_COOKIE = "proseden_session";

export function sessionCookieNameForBase(assetBase: string): string {
  if (!assetBase) return DEFAULT_COOKIE;
  const slug = assetBase.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "_");
  return `proseden_${slug}_session`;
}

export const loadUser = createMiddleware(async (c, next) => {
  const sessions = c.get("sessions");
  const world = c.get("world");
  const cookieName = c.get("sessionCookieName") || DEFAULT_COOKIE;

  const header = c.req.header("authorization");
  let token: string | undefined;
  if (header?.toLowerCase().startsWith("bearer ")) {
    token = header.slice(7).trim();
  } else {
    token = getCookie(c, cookieName);
  }

  const session = sessions.get(token);
  if (session) {
    const user = world.getUser(session.username);
    if (user) c.set("user", user);
  }

  await next();
});
