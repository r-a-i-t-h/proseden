import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { SessionStore } from "./auth/sessions.js";
import { loadUser, sessionCookieNameForBase } from "./middleware/auth.js";
import { authRoutes } from "./routes/auth.js";
import { worldRoutes } from "./routes/world.js";
import type { WorldStore } from "./store/world.js";
import "./context.js";

export function createApp(opts: {
  world: WorldStore;
  sessions: SessionStore;
  /** URL prefix with no trailing slash, e.g. "" or "/proseden" */
  assetBase?: string;
  staticRoot?: string;
}) {
  const assetBase = normalizeBase(opts.assetBase ?? "");
  // strict:false so /proseden and /proseden/ both hit the app root under a base path
  const app = assetBase
    ? new Hono({ strict: false }).basePath(assetBase)
    : new Hono({ strict: false });
  const sessionCookieName = sessionCookieNameForBase(assetBase);

  app.use("*", async (c, next) => {
    c.set("world", opts.world);
    c.set("sessions", opts.sessions);
    c.set("assetBase", assetBase);
    c.set("sessionCookieName", sessionCookieName);
    await next();
  });

  app.use("*", loadUser);

  app.get("/health", (c) => c.json({ ok: true, name: "proseden" }));

  app.route("/auth", authRoutes);
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
