import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { isManager } from "../access/permissions.js";
import { apiError } from "../http.js";
import { clientIp } from "../rate-limit/client-ip.js";
import type { RateLimitBucket, RateLimitConfig } from "../rate-limit/limits.js";
import type { RateLimitResult } from "../rate-limit/limiter.js";

export function rateLimit(opts: {
  name: string;
  bucket: (limits: RateLimitConfig) => RateLimitBucket;
  key: (c: Context) => string | string[] | Promise<string | string[]>;
}) {
  return createMiddleware(async (c, next) => {
    if (isManager(c.get("user"), c.get("world"))) {
      await next();
      return;
    }
    const limiter = c.get("rateLimiter");
    const bucket = opts.bucket(c.get("rateLimits"));
    const raw = await opts.key(c);
    const keys = (Array.isArray(raw) ? raw : [raw]).filter((k) => k.length > 0);

    let blocked: RateLimitResult | undefined;
    for (const key of keys) {
      const result = limiter.hit(`${opts.name}:${key}`, bucket.max, bucket.windowMs);
      if (!result.ok) blocked = result;
    }

    if (blocked) {
      const retryAfter = Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 1000));
      c.header("Retry-After", String(retryAfter));
      return apiError(c, 429, "Too many requests. Try again later.");
    }

    await next();
  });
}

const SKIP_WRITE_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/password",
  "/auth/logout",
  "/live/say",
  "/live/shout",
  "/live/ping",
]);

const writeRateLimitInner = rateLimit({
  name: "writes",
  bucket: (limits) => limits.writes,
  key: (ctx) => {
    const user = ctx.get("user");
    return user ? `user:${user.username}` : `ip:${clientIp(ctx)}`;
  },
});

/** Coarse cap on remaining POST/PUT mutations. Auth, chat, ping, and logout have their own rules. */
export const writeRateLimit = createMiddleware(async (c, next) => {
  const method = c.req.method;
  if (method !== "POST" && method !== "PUT") {
    await next();
    return;
  }
  const path = pathWithinApp(c);
  if (SKIP_WRITE_PATHS.has(path) || path.startsWith("/assets/")) {
    await next();
    return;
  }
  return writeRateLimitInner(c, next);
});

export function pathWithinApp(c: Context): string {
  const base = c.get("assetBase") ?? "";
  let path = new URL(c.req.url).pathname;
  if (base && (path === base || path.startsWith(`${base}/`))) {
    path = path.slice(base.length) || "/";
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}
