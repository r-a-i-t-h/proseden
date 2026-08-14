import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * Client address as seen by the app. nginx appends `$remote_addr` to
 * `X-Forwarded-For`, so the last hop is the one we trust.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }

  const real = c.req.header("x-real-ip")?.trim();
  if (real) return real;

  try {
    const addr = getConnInfo(c).remote.address;
    if (addr) return addr;
  } catch {
    // `app.request()` and other in-process calls have no socket.
  }

  return "unknown";
}
