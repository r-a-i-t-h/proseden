import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { SessionStore } from "./auth/sessions.js";
import { loadUser } from "./middleware/auth.js";
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
  const app = assetBase ? new Hono().basePath(assetBase) : new Hono();

  app.use("*", async (c, next) => {
    c.set("world", opts.world);
    c.set("sessions", opts.sessions);
    c.set("assetBase", assetBase);
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
      }),
    );
  }

  return app;
}

function normalizeBase(base: string): string {
  if (!base || base === "/") return "";
  return `/${base.replace(/^\/+|\/+$/g, "")}`;
}
