import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

const COOKIE = "proseden_session";

export const sessionCookieName = COOKIE;

export const loadUser = createMiddleware(async (c, next) => {
  const sessions = c.get("sessions");
  const world = c.get("world");

  const header = c.req.header("authorization");
  let token: string | undefined;
  if (header?.toLowerCase().startsWith("bearer ")) {
    token = header.slice(7).trim();
  } else {
    token = getCookie(c, COOKIE);
  }

  const session = sessions.get(token);
  if (session) {
    const user = world.getUser(session.username);
    if (user) c.set("user", user);
  }

  await next();
});

export function requireUser() {
  return createMiddleware(async (c, next) => {
    if (!c.get("user")) {
      return c.json({ error: "Authentication required" }, 401);
    }
    await next();
  });
}
