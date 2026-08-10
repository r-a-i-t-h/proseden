import { Hono } from "hono";
import type { Context } from "hono";
import { isManager } from "../access/permissions.js";
import { negotiateFormat } from "../render/format.js";
import { renderHtmlPage, renderMessageBodyHtml } from "../render/html.js";
import { renderMessageText } from "../render/text.js";

export const adminRoutes = new Hono();

adminRoutes.get("/", (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  const endpoints = [
    {
      method: "POST",
      path: "/admin/reload",
      description: "Reload the in-memory world cache from disk",
    },
  ];

  if (wantsJson(c)) return c.json({ ok: true, endpoints });
  const lines = endpoints.map((e) => `${e.method} ${e.path} — ${e.description}`).join("\n");
  if (negotiateFormat(c) === "text") {
    return c.text(renderMessageText("Admin", lines));
  }
  const list = endpoints
    .map((e) => `<li><code>${e.method} ${e.path}</code> — ${e.description}</li>`)
    .join("");
  return c.html(
    renderHtmlPage({
      title: "Admin",
      bodyHtml: `<h1>Admin</h1>
        <ul class="link-list">${list}</ul>
        <form method="post" action="admin/reload" class="stack">
          <button type="submit">Reload world from disk</button>
        </form>`,
      user: c.get("user"),
      assetBase: c.get("assetBase"),
      isManager: true,
    }),
  );
});

adminRoutes.post("/reload", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  const world = c.get("world");
  await world.reload();

  const summary = {
    ok: true as const,
    users: world.users.size,
    scenes: world.scenes.size,
    artefacts: world.artefacts.size,
    groups: world.groups.size,
    entranceGroups: world.entranceGroups.size,
  };

  if (wantsJson(c)) return c.json(summary);
  const message = `Reloaded from disk: ${summary.scenes} scenes, ${summary.artefacts} artefacts, ${summary.users} users.`;
  if (negotiateFormat(c) === "text") {
    return c.text(renderMessageText("Reload", message));
  }
  return c.html(
    renderHtmlPage({
      title: "Reload",
      bodyHtml: renderMessageBodyHtml("Reload", message),
      user: c.get("user"),
      assetBase: c.get("assetBase"),
      isManager: true,
    }),
  );
});

function requireManager(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  return null;
}

function apiError(c: Context, status: 401 | 403, message: string) {
  if (wantsJson(c) || negotiateFormat(c) === "text") {
    if (wantsJson(c)) return c.json({ error: message }, status);
    return c.text(renderMessageText("Error", message), status);
  }
  return c.html(
    renderHtmlPage({
      title: "Error",
      bodyHtml: renderMessageBodyHtml("Error", message),
      user: c.get("user"),
      assetBase: c.get("assetBase"),
      isManager: false,
    }),
    status,
  );
}

function wantsJson(c: Context): boolean {
  const accept = c.req.header("accept") ?? "";
  return accept.includes("application/json") || c.req.query("format") === "json";
}
