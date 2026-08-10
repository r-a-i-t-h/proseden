import { Hono } from "hono";
import type { Context } from "hono";
import { formatAccessSummary, parseAccessPayload } from "../access/acl.js";
import {
  canEdit,
  canEditArtefact,
  canManage,
  canManageGroup,
  canRead,
  canReadArtefact,
  canReadGroup,
} from "../access/permissions.js";
import { negotiateFormat, queryDetailName } from "../render/format.js";
import {
  renderArtefactBodyHtml,
  renderHtmlPage,
  renderInventoryBodyHtml,
  renderMessageBodyHtml,
  renderSceneBodyHtml,
} from "../render/html.js";
import {
  renderArtefactText,
  renderInventoryText,
  renderMessageText,
  renderSceneText,
} from "../render/text.js";

export const worldRoutes = new Hono();

const ENTRANCE_SCENE_ID = 1;

worldRoutes.get("/", (c) => c.redirect(`${c.get("assetBase")}/s/${ENTRANCE_SCENE_ID}`));
worldRoutes.get("/s", (c) => c.redirect(`${c.get("assetBase")}/s/${ENTRANCE_SCENE_ID}`));

worldRoutes.get("/s/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) {
    return page(
      c,
      404,
      "Not found",
      renderMessageBodyHtml("Not found", `No scene ${id}.`),
      renderMessageText("Not found", `No scene ${id}.`),
    );
  }
  if (!canRead(user, scene, world)) {
    const msg = user
      ? "This scene is private and you do not have access."
      : "This scene is private. Authenticate and retry.";
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
  const manage = canManage(user, scene, world);
  const accessSummary = manage
    ? formatAccessSummary(scene.grants, scene.denies)
    : undefined;
  const groups = user
    ? world
        .listGroups()
        .filter((g) => canManageGroup(user, g, world))
        .map((g) => ({ id: g.id, title: g.title }))
    : [];

  return page(
    c,
    200,
    scene.title ?? `Scene ${scene.id}`,
    renderSceneBodyHtml({ scene, exits, artefacts, detail, assetBase }),
    renderSceneText({ scene, exits, artefacts, detail, basePath: assetBase, accessSummary }),
    {
      kind: "scene",
      scene,
      canEdit: canEdit(user, scene, world),
      canManage: manage,
      userGrants: user?.grants,
      userDenies: user?.denies,
      groups,
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
  const home = world.getScene(artefact.homeSceneId);
  if (!home || !canReadArtefact(user, artefact, home, world)) {
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
      canEdit: canEditArtefact(user, artefact, home, world),
      collected,
      userGrants: user?.grants,
      userDenies: user?.denies,
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
    {
      kind: "inventory",
      userGrants: user.grants,
      userDenies: user.denies,
    },
  );
});

// --- mutations ---

worldRoutes.post("/s", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const body = await readBody(c);
  const text = String(body.body ?? "");
  if (!text.trim()) return apiError(c, 400, "Body is required");

  const scene = await world.createScene({
    owner: user.username,
    title: optionalString(body.title),
    body: text,
    details: parseDetails(body.detailsJson ?? body.details),
    visibility: body.visibility === "public" || body.visibility === true ? "public" : "private",
  });

  if (wantsJson(c)) return c.json(scene, 201);
  return c.redirect(`${c.get("assetBase")}/s/${scene.id}`);
});

worldRoutes.put("/s/:id", async (c) => updateScene(c));
worldRoutes.post("/s/:id", async (c) => {
  // HTML forms use POST + _method/data-method; also accept POST as update
  return updateScene(c);
});

async function updateScene(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canEdit(user, scene, world)) return apiError(c, 403, "Not allowed to edit this scene");

  const body = await readBody(c);
  const details =
    body.detailsJson !== undefined || body.details !== undefined
      ? parseDetails(body.detailsJson ?? body.details)
      : undefined;

  let visibility = scene.visibility;
  if (body.visibility !== undefined) {
    visibility =
      body.visibility === "public" || body.visibility === true || body.visibility === "on"
        ? "public"
        : "private";
  }

  const updated = await world.updateScene(id, {
    title: body.title !== undefined ? optionalString(body.title) : scene.title,
    body: body.body !== undefined ? String(body.body) : scene.body,
    details,
    visibility,
  });

  if (wantsJson(c)) return c.json(updated);
  return c.redirect(`${c.get("assetBase")}/s/${id}`);
}

worldRoutes.get("/s/:id/access", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) {
    return apiError(c, user ? 403 : 401, "Manage rights required");
  }
  const payload = {
    grants: scene.grants ?? [],
    denies: scene.denies ?? [],
  };
  if (wantsJson(c) || negotiateFormat(c) === "text") {
    if (wantsJson(c)) return c.json(payload);
    return c.text(
      renderMessageText(`Scene ${id} access`, formatAccessSummary(payload.grants, payload.denies)),
    );
  }
  return c.redirect(`${c.get("assetBase")}/s/${id}`);
});

worldRoutes.put("/s/:id/access", async (c) => updateSceneAccess(c));
worldRoutes.post("/s/:id/access", async (c) => updateSceneAccess(c));

async function updateSceneAccess(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) return apiError(c, 403, "Manage rights required");

  const body = await readBody(c);
  try {
    const patch = parseAccessPayload(body);
    if (patch.grants === undefined && patch.denies === undefined) {
      return apiError(c, 400, "grants and/or denies required");
    }
    const updated = await world.updateSceneAccess(id, patch);
    if (wantsJson(c)) return c.json({ grants: updated.grants, denies: updated.denies });
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid access payload");
  }
}

worldRoutes.get("/u/:username/access", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const username = String(c.req.param("username") ?? "");
  const target = world.getUser(username);
  if (!target) return apiError(c, 404, "User not found");
  if (!canManageUserAccess(user, username, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to view this user's access");
  }
  const payload = {
    grants: target.grants ?? [],
    denies: target.denies ?? [],
  };
  if (wantsJson(c)) return c.json(payload);
  return c.text(
    renderMessageText(
      `User ${username} access (share-all)`,
      formatAccessSummary(payload.grants, payload.denies),
    ),
  );
});

worldRoutes.put("/u/:username/access", async (c) => updateUserAccess(c));
worldRoutes.post("/u/:username/access", async (c) => updateUserAccess(c));

async function updateUserAccess(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const username = String(c.req.param("username") ?? "");
  if (!canManageUserAccess(user, username, world)) {
    return apiError(c, 403, "Not allowed to edit this user's access");
  }
  const body = await readBody(c);
  try {
    const patch = parseAccessPayload(body);
    if (patch.grants === undefined && patch.denies === undefined) {
      return apiError(c, 400, "grants and/or denies required");
    }
    const updated = await world.updateUserAccess(username, patch);
    if (wantsJson(c)) return c.json({ grants: updated.grants, denies: updated.denies });
    return c.redirect(`${c.get("assetBase")}/`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid access payload");
  }
}

function canManageUserAccess(
  user: import("../model/types.js").UserRecord | undefined,
  username: string,
  world: import("../store/world.js").WorldStore,
): boolean {
  if (!user) return false;
  if (user.username === username) return true;
  return world.rolesFor(user.username).includes("manager");
}

// --- groups ---

worldRoutes.post("/g", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const body = await readBody(c);
  const title = String(body.title ?? "").trim();
  if (!title) return apiError(c, 400, "Title is required");
  const access = parseAccessPayload(body);
  const group = await world.createGroup({
    owner: user.username,
    title,
    grants: access.grants ?? [],
    denies: access.denies ?? [],
  });
  if (wantsJson(c)) return c.json(group, 201);
  return c.redirect(`${c.get("assetBase")}/g/${group.id}`);
});

worldRoutes.get("/g/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canReadGroup(user, group, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to view this group");
  }
  if (wantsJson(c)) return c.json(group);
  const summary = [
    `title: ${group.title}`,
    `owner: ${group.owner}`,
    `scenes: ${group.sceneIds.join(", ") || "(none)"}`,
    "",
    formatAccessSummary(group.grants, group.denies),
  ].join("\n");
  return page(
    c,
    200,
    group.title,
    renderMessageBodyHtml(group.title, summary.replace(/\n/g, "<br />")),
    renderMessageText(`Group ${group.id}`, summary),
    {
      kind: "home",
      userGrants: user?.grants,
      userDenies: user?.denies,
    },
  );
});

worldRoutes.put("/g/:id", async (c) => updateGroup(c));
worldRoutes.post("/g/:id", async (c) => updateGroup(c));

async function updateGroup(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canManageGroup(user, group, world)) return apiError(c, 403, "Manage rights required");

  const body = await readBody(c);
  const access = parseAccessPayload(body);
  const updated = await world.updateGroup(id, {
    title: body.title !== undefined ? String(body.title).trim() || group.title : group.title,
    grants: access.grants,
    denies: access.denies,
  });
  if (wantsJson(c)) return c.json(updated);
  return c.redirect(`${c.get("assetBase")}/g/${id}`);
}

worldRoutes.get("/g/:id/access", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canManageGroup(user, group, world)) {
    return apiError(c, user ? 403 : 401, "Manage rights required");
  }
  const payload = { grants: group.grants, denies: group.denies };
  if (wantsJson(c)) return c.json(payload);
  return c.text(
    renderMessageText(`Group ${id} access`, formatAccessSummary(payload.grants, payload.denies)),
  );
});

worldRoutes.put("/g/:id/access", async (c) => updateGroupAccess(c));
worldRoutes.post("/g/:id/access", async (c) => updateGroupAccess(c));

async function updateGroupAccess(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canManageGroup(user, group, world)) return apiError(c, 403, "Manage rights required");
  const body = await readBody(c);
  try {
    const patch = parseAccessPayload(body);
    if (patch.grants === undefined && patch.denies === undefined) {
      return apiError(c, 400, "grants and/or denies required");
    }
    const updated = await world.updateGroupAccess(id, patch);
    if (wantsJson(c)) return c.json({ grants: updated.grants, denies: updated.denies });
    return c.redirect(`${c.get("assetBase")}/g/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid access payload");
  }
}

worldRoutes.post("/g/:id/scenes", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canManageGroup(user, group, world)) return apiError(c, 403, "Manage rights required");

  const body = await readBody(c);
  const sceneId = Number(body.sceneId);
  if (!Number.isFinite(sceneId)) return apiError(c, 400, "sceneId is required");
  const scene = world.getScene(sceneId);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) {
    return apiError(c, 403, "Manage rights required on the scene");
  }

  try {
    const updated = await world.setSceneGroup(sceneId, id);
    if (wantsJson(c)) return c.json({ group: world.getGroup(id), scene: updated });
    return c.redirect(`${c.get("assetBase")}/s/${sceneId}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not assign scene");
  }
});

worldRoutes.post("/s/:id/group", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const sceneId = Number(c.req.param("id"));
  const scene = world.getScene(sceneId);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) return apiError(c, 403, "Manage rights required");

  const body = await readBody(c);
  const raw = body.groupId;
  const groupId =
    raw === undefined || raw === null || raw === "" || raw === "none" ? null : String(raw);

  if (groupId) {
    const group = world.getGroup(groupId);
    if (!group) return apiError(c, 404, "Group not found");
    if (!canManageGroup(user, group, world)) {
      return apiError(c, 403, "Manage rights required on the group");
    }
  }

  try {
    const updated = await world.setSceneGroup(sceneId, groupId);
    if (wantsJson(c)) return c.json(updated);
    return c.redirect(`${c.get("assetBase")}/s/${sceneId}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not set group");
  }
});

worldRoutes.post("/s/:id/exits", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canEdit(user, scene, world)) return apiError(c, 403, "Not allowed to edit this scene");

  const body = await readBody(c);
  const nickname = String(body.nickname ?? "").trim();
  const toSceneId = Number(body.toSceneId);
  if (!nickname) return apiError(c, 400, "Nickname is required");
  if (!Number.isFinite(toSceneId)) return apiError(c, 400, "toSceneId is required");

  try {
    const exit = await world.addExit(id, nickname, toSceneId);
    if (wantsJson(c)) return c.json(exit, 201);
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not add exit");
  }
});

worldRoutes.post("/a", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const body = await readBody(c);
  const homeSceneId = Number(body.homeSceneId);
  const text = String(body.body ?? "");
  if (!Number.isFinite(homeSceneId)) return apiError(c, 400, "homeSceneId is required");
  if (!text.trim()) return apiError(c, 400, "Body is required");

  const home = world.getScene(homeSceneId);
  if (!home) return apiError(c, 404, "Home scene not found");
  if (!canEdit(user, home, world)) return apiError(c, 403, "Not allowed to place artefacts here");

  const artefact = await world.createArtefact({
    owner: user.username,
    homeSceneId,
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
  const home = world.getScene(artefact.homeSceneId);
  if (!home || !canEditArtefact(user, artefact, home, world)) {
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
      homeSceneId: body.homeSceneId !== undefined ? Number(body.homeSceneId) : undefined,
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
  const home = world.getScene(artefact.homeSceneId);
  if (!home || !canReadArtefact(user, artefact, home, world)) {
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
