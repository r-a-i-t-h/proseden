import { Hono } from "hono";
import type { Context } from "hono";
import {
  canEdit,
  canEditArtefact,
  canRead,
  canReadArtefact,
} from "../access/permissions.js";
import { negotiateFormat, queryDetailName } from "../render/format.js";
import {
  renderArtefactBodyHtml,
  renderHtmlPage,
  renderInventoryBodyHtml,
  renderMessageBodyHtml,
  renderNodeBodyHtml,
} from "../render/html.js";
import {
  renderArtefactText,
  renderInventoryText,
  renderMessageText,
  renderNodeText,
} from "../render/text.js";

export const worldRoutes = new Hono();

worldRoutes.get("/", (c) => {
  const world = c.get("world");
  const base = c.get("assetBase");
  // Prefer lowest public node id as entrance
  const publicNodes = [...world.nodes.values()]
    .filter((n) => n.visibility === "public")
    .sort((a, b) => a.id - b.id);
  if (publicNodes[0]) {
    return c.redirect(`${base}/n/${publicNodes[0].id}`);
  }
  return page(
    c,
    200,
    "Proseden",
    renderMessageBodyHtml(
      "Proseden",
      "No public nodes yet. Register, then create one from the sidebar.",
    ),
    renderMessageText(
      "Proseden",
      "No public nodes yet. Register via POST /auth/register then POST /n.",
    ),
    { kind: "home" },
  );
});

worldRoutes.get("/n/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const node = world.getNode(id);
  if (!node) {
    return page(
      c,
      404,
      "Not found",
      renderMessageBodyHtml("Not found", `No node ${id}.`),
      renderMessageText("Not found", `No node ${id}.`),
    );
  }
  if (!canRead(user, node)) {
    const msg = user
      ? "This node is private and you do not have access."
      : "This node is private. Authenticate and retry.";
    return page(
      c,
      user ? 403 : 401,
      "Forbidden",
      renderMessageBodyHtml("Forbidden", msg),
      renderMessageText("Forbidden", msg),
    );
  }

  const detail = queryDetailName(c);
  const exits = world.getExits(id);
  const artefacts = world.artefactsAt(id);
  const assetBase = c.get("assetBase");

  return page(
    c,
    200,
    node.title ?? `Node ${node.id}`,
    renderNodeBodyHtml({ node, exits, artefacts, detail, assetBase }),
    renderNodeText({ node, exits, artefacts, detail, basePath: assetBase }),
    {
      kind: "node",
      node,
      canEdit: canEdit(user, node),
    },
  );
});

worldRoutes.get("/a/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) {
    return page(
      c,
      404,
      "Not found",
      renderMessageBodyHtml("Not found", `No artefact ${id}.`),
      renderMessageText("Not found", `No artefact ${id}.`),
    );
  }
  const home = world.getNode(artefact.homeNodeId);
  if (!home || !canReadArtefact(user, artefact, home)) {
    return page(
      c,
      user ? 403 : 401,
      "Forbidden",
      renderMessageBodyHtml("Forbidden", "This artefact is not readable."),
      renderMessageText("Forbidden", "This artefact is not readable."),
    );
  }

  const detail = queryDetailName(c);
  const assetBase = c.get("assetBase");
  const collected = !!user?.inventory.some((i) => i.artefactId === id);

  return page(
    c,
    200,
    artefact.title ?? `Artefact ${artefact.id}`,
    renderArtefactBodyHtml({ artefact, detail, assetBase }),
    renderArtefactText({ artefact, detail, basePath: assetBase }),
    {
      kind: "artefact",
      artefact,
      canEdit: canEditArtefact(user, artefact, home),
      collected,
    },
  );
});

worldRoutes.get("/inv", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(
      c,
      401,
      "Inventory",
      renderMessageBodyHtml("Inventory", "Log in to view your inventory."),
      renderMessageText("Inventory", "Authentication required."),
    );
  }

  const items = user.inventory
    .map((item) => {
      const artefact = world.getArtefact(item.artefactId);
      return artefact ? { artefact, tags: item.tags } : null;
    })
    .filter((x): x is { artefact: NonNullable<typeof x>["artefact"]; tags: string[] } => !!x);

  const assetBase = c.get("assetBase");
  return page(
    c,
    200,
    "Inventory",
    renderInventoryBodyHtml(items, assetBase),
    renderInventoryText(items, assetBase),
    { kind: "inventory" },
  );
});

// --- mutations ---

worldRoutes.post("/n", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const body = await readBody(c);
  const text = String(body.body ?? "");
  if (!text.trim()) return apiError(c, 400, "Body is required");

  const node = await world.createNode({
    owner: user.username,
    title: optionalString(body.title),
    body: text,
    details: parseDetails(body.detailsJson ?? body.details),
    visibility: body.visibility === "public" || body.visibility === true ? "public" : "private",
  });

  if (wantsJson(c)) return c.json(node, 201);
  return c.redirect(`${c.get("assetBase")}/n/${node.id}`);
});

worldRoutes.put("/n/:id", async (c) => updateNode(c));
worldRoutes.post("/n/:id", async (c) => {
  // HTML forms use POST + _method/data-method; also accept POST as update
  return updateNode(c);
});

async function updateNode(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const node = world.getNode(id);
  if (!node) return apiError(c, 404, "Node not found");
  if (!canEdit(user, node)) return apiError(c, 403, "Not allowed to edit this node");

  const body = await readBody(c);
  const details =
    body.detailsJson !== undefined || body.details !== undefined
      ? parseDetails(body.detailsJson ?? body.details)
      : undefined;

  let visibility = node.visibility;
  if (body.visibility !== undefined) {
    visibility =
      body.visibility === "public" || body.visibility === true || body.visibility === "on"
        ? "public"
        : "private";
  }

  const updated = await world.updateNode(id, {
    title: body.title !== undefined ? optionalString(body.title) : node.title,
    body: body.body !== undefined ? String(body.body) : node.body,
    details,
    visibility,
  });

  if (wantsJson(c)) return c.json(updated);
  return c.redirect(`${c.get("assetBase")}/n/${id}`);
}

worldRoutes.post("/n/:id/exits", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const node = world.getNode(id);
  if (!node) return apiError(c, 404, "Node not found");
  if (!canEdit(user, node)) return apiError(c, 403, "Not allowed to edit this node");

  const body = await readBody(c);
  const nickname = String(body.nickname ?? "").trim();
  const toNodeId = Number(body.toNodeId);
  if (!nickname) return apiError(c, 400, "Nickname is required");
  if (!Number.isFinite(toNodeId)) return apiError(c, 400, "toNodeId is required");

  try {
    const exit = await world.addExit(id, nickname, toNodeId);
    if (wantsJson(c)) return c.json(exit, 201);
    return c.redirect(`${c.get("assetBase")}/n/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not add exit");
  }
});

worldRoutes.post("/a", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const body = await readBody(c);
  const homeNodeId = Number(body.homeNodeId);
  const text = String(body.body ?? "");
  if (!Number.isFinite(homeNodeId)) return apiError(c, 400, "homeNodeId is required");
  if (!text.trim()) return apiError(c, 400, "Body is required");

  const home = world.getNode(homeNodeId);
  if (!home) return apiError(c, 404, "Home node not found");
  if (!canEdit(user, home)) return apiError(c, 403, "Not allowed to place artefacts here");

  const artefact = await world.createArtefact({
    owner: user.username,
    homeNodeId,
    title: optionalString(body.title),
    body: text,
    details: parseDetails(body.detailsJson ?? body.details),
    tags: parseTags(body.tags),
  });

  if (wantsJson(c)) return c.json(artefact, 201);
  return c.redirect(`${c.get("assetBase")}/a/${artefact.id}`);
});

worldRoutes.put("/a/:id", async (c) => updateArtefact(c));
worldRoutes.post("/a/:id", async (c) => updateArtefact(c));

async function updateArtefact(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getNode(artefact.homeNodeId);
  if (!home || !canEditArtefact(user, artefact, home)) {
    return apiError(c, 403, "Not allowed to edit this artefact");
  }

  const body = await readBody(c);
  try {
    const updated = await world.updateArtefact(id, {
      title: body.title !== undefined ? optionalString(body.title) : artefact.title,
      body: body.body !== undefined ? String(body.body) : artefact.body,
      details:
        body.detailsJson !== undefined || body.details !== undefined
          ? parseDetails(body.detailsJson ?? body.details)
          : undefined,
      tags: body.tags !== undefined ? parseTags(body.tags) : undefined,
      homeNodeId: body.homeNodeId !== undefined ? Number(body.homeNodeId) : undefined,
    });
    if (wantsJson(c)) return c.json(updated);
    return c.redirect(`${c.get("assetBase")}/a/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Update failed");
  }
}

worldRoutes.post("/a/:id/collect", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getNode(artefact.homeNodeId);
  if (!home || !canReadArtefact(user, artefact, home)) {
    return apiError(c, 403, "Cannot collect an unreadable artefact");
  }

  const body = await readBody(c);
  const updated = await world.collectArtefact(user.username, id, parseTags(body.tags));
  c.set("user", updated);
  if (wantsJson(c)) return c.json({ ok: true, inventory: updated.inventory });
  return c.redirect(`${c.get("assetBase")}/a/${id}`);
});

worldRoutes.delete("/a/:id/collect", async (c) => dropCollect(c));
worldRoutes.post("/a/:id/collect/drop", async (c) => dropCollect(c));

async function dropCollect(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = Number(c.req.param("id"));
  const updated = await world.dropArtefact(user.username, id);
  c.set("user", updated);
  if (wantsJson(c)) return c.json({ ok: true, inventory: updated.inventory });
  return c.redirect(`${c.get("assetBase")}/a/${id}`);
}

function page(
  c: Context,
  status: number,
  title: string,
  htmlBody: string,
  textBody: string,
  manage?: Parameters<typeof renderHtmlPage>[0]["manage"],
) {
  const format = negotiateFormat(c);
  if (format === "text") {
    return c.text(textBody, status as 200);
  }
  return c.html(
    renderHtmlPage({
      title,
      bodyHtml: htmlBody,
      user: c.get("user"),
      assetBase: c.get("assetBase"),
      manage,
    }),
    status as 200,
  );
}

function apiError(c: Context, status: 400 | 401 | 403 | 404, message: string) {
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
    }),
    status,
  );
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await c.req.json()) as Record<string, unknown>;
  }
  const form = await c.req.parseBody();
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    out[k] = typeof v === "string" ? v : String(v);
  }
  // checkbox absence means private
  if (!("visibility" in out) && c.req.method !== "GET") {
    // only force private when form intentionally editing visibility fields present in edit forms
  }
  return out;
}

function wantsJson(c: Context): boolean {
  const accept = c.req.header("accept") ?? "";
  return accept.includes("application/json") || c.req.query("format") === "json";
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDetails(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = String(v);
    }
    return out;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
    return out;
  }
  return {};
}
