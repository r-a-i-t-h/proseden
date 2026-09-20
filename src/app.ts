import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { SessionStore } from "./auth/sessions.js";
import { loadUser, sessionCookieNameForBase } from "./middleware/auth.js";
import { crisisLockdown } from "./middleware/crisis-lockdown.js";
import { pathWithinApp, writeRateLimit } from "./middleware/rate-limit.js";
import { SceneHub } from "./live/hub.js";
import { LocationTracker } from "./live/location.js";
import { PresenceStore } from "./live/presence.js";
import {
  healthFields,
  isLiveEventsPath,
  recordFinishedRequest,
  RequestTimer,
  runWithTimer,
  serverTimingHeader,
} from "./observe.js";
import { mergeRateLimits, type RateLimitConfig } from "./rate-limit/limits.js";
import { RateLimiter } from "./rate-limit/limiter.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { liveRoutes } from "./routes/live.js";
import { worldRoutes } from "./routes/world.js";
import { defaultBackupDir } from "./store/backup.js";
import type { WorldStore } from "./store/world.js";
import "./context.js";

export function createApp(opts: {
  world: WorldStore;
  sessions: SessionStore;
  /** URL prefix with no trailing slash, e.g. "" or "/proseden" */
  assetBase?: string;
  staticRoot?: string;
  /** Data archives directory (default: sibling `backup` of the world data dir). */
  backupDir?: string;
  presence?: PresenceStore;
  hub?: SceneHub;
  locations?: LocationTracker;
  rateLimiter?: RateLimiter;
  rateLimits?: Partial<RateLimitConfig>;
}) {
  const assetBase = normalizeBase(opts.assetBase ?? "");
  // strict:false so /proseden and /proseden/ both hit the app root under a base path
  const app = assetBase
    ? new Hono({ strict: false }).basePath(assetBase)
    : new Hono({ strict: false });
  const sessionCookieName = sessionCookieNameForBase(assetBase);
  const backupDir = opts.backupDir ?? defaultBackupDir(opts.world.dataDir);
  const presence = opts.presence ?? new PresenceStore();
  const hub = opts.hub ?? new SceneHub(presence);
  const locations = opts.locations ?? new LocationTracker(opts.world);
  const rateLimiter = opts.rateLimiter ?? new RateLimiter();
  const rateLimits = mergeRateLimits(opts.rateLimits);

  app.use("*", async (c, next) => {
    c.set("world", opts.world);
    c.set("sessions", opts.sessions);
    c.set("assetBase", assetBase);
    c.set("sessionCookieName", sessionCookieName);
    c.set("backupDir", backupDir);
    c.set("presence", presence);
    c.set("hub", hub);
    c.set("locations", locations);
    c.set("rateLimiter", rateLimiter);
    c.set("rateLimits", rateLimits);
    const timer = new RequestTimer();
    c.set("timer", timer);
    await runWithTimer(timer, async () => {
      await next();
    });
    const path = pathWithinApp(c);
    if (isLiveEventsPath(path)) return;
    c.header("Server-Timing", serverTimingHeader(timer));
    recordFinishedRequest({
      method: c.req.method,
      path,
      status: c.res.status,
      timer,
    });
  });

  app.use("*", loadUser);
  app.use("*", crisisLockdown);
  app.use("*", writeRateLimit);

  app.get("/health", (c) => c.json({ ok: true, name: "proseden", ...healthFields() }));

  app.route("/auth", authRoutes);
  app.route("/data", adminRoutes);
  app.route("/live", liveRoutes);
  app.route("/", worldRoutes);

  if (opts.staticRoot) {
    app.use(
      "/assets/*",
      serveStatic({
        root: opts.staticRoot,
        // c.req.path keeps the basePath prefix; map /{base}/assets/... → assets/...
        rewriteRequestPath: (requestPath) => stripBasePrefix(requestPath, assetBase),
      }),
    );
  }

  return app;
}

export function normalizeBase(base: string): string {
  if (!base || base === "/") return "";
  return `/${base.replace(/^\/+|\/+$/g, "")}`;
}

function stripBasePrefix(requestPath: string, assetBase: string): string {
  let path = requestPath;
  if (assetBase && (path === assetBase || path.startsWith(`${assetBase}/`))) {
    path = path.slice(assetBase.length) || "/";
  }
  return path.replace(/^\/+/, "");
}
