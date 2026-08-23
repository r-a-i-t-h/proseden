import { Hono } from "hono";
import type { Context } from "hono";
import { formatAccessSummary, parseAccessPayload } from "../access/acl.js";
import { canManage, canManageGroup, canReadGroup, canTransferGroup, isTopographer } from "../access/permissions.js";
import {
  aliasFormMethods,
  apiError,
  isResponse,
  page,
  readRequestBody,
  requireUser,
  respondMutation,
  sceneBackLink,
  wantsJson,
} from "../http.js";
import {
  formatPlainMessage,
  groupPageView,
  groupsIndexPageView,
  messagePageView,
} from "../render/view/index.js";
import { parseKeepAccess, updateAccess } from "./helpers.js";

export const groupRoutes = new Hono();

groupRoutes.get("/g", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(c, 401, messagePageView("Groups", "Log in to view your groups."));
  }

  const managed: Array<{ id: string; title: string; owner: string; sceneCount: number }> = [];
  const readable: Array<{ id: string; title: string; owner: string; sceneCount: number }> = [];
  for (const group of world.listGroups()) {
    const item = {
      id: group.id,
      title: group.title,
      owner: group.owner,
      sceneCount: group.sceneIds.length,
    };
    if (canManageGroup(user, group, world)) managed.push(item);
    else if (canReadGroup(user, group, world)) readable.push(item);
  }

  const back = sceneBackLink(user, world);
  return page(c, 200, groupsIndexPageView({ managed, readable, back }));
});

groupRoutes.post("/g", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const body = await readRequestBody(c);
  const title = String(body.title ?? "").trim();
  if (!title) return apiError(c, 400, "Title is required");
  const access = parseAccessPayload(body);
  const group = await world.createGroup({
    owner: user.username,
    title,
    grants: access.grants ?? [],
    denies: access.denies ?? [],
  });
  return respondMutation(c, { json: group, redirect: `/g/${group.id}`, status: 201 });
});

groupRoutes.get("/g/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canReadGroup(user, group, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to view this group");
  }
  if (wantsJson(c)) return c.json(group);
  const manage = canManageGroup(user, group, world);
  const scenes = group.sceneIds
    .map((sceneId) => world.getScene(sceneId))
    .filter((scene): scene is NonNullable<typeof scene> => !!scene)
    .map((scene) => ({ id: scene.id, title: scene.title }));
  const message = c.req.query("updated")
    ? "Group access saved."
    : c.req.query("transferred")
      ? "Group transferred."
      : undefined;
  const back = user ? sceneBackLink(user, world) : undefined;
  return page(
    c,
    200,
    groupPageView({
      id: group.id,
      title: group.title,
      owner: group.owner,
      scenes,
      grants: group.grants,
      denies: group.denies,
      canManage: manage,
      canTransfer: canTransferGroup(user, group, world),
      accessSummary: formatAccessSummary(group.grants, group.denies),
      message,
      back,
    }),
  );
});

aliasFormMethods(groupRoutes, "put", "/g/:id", (c) => updateGroup(c));

async function updateGroup(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canManageGroup(user, group, world)) return apiError(c, 403, "Manage rights required");

  const body = await readRequestBody(c);
  const access = parseAccessPayload(body);
  const updated = await world.updateGroup(id, {
    title: body.title !== undefined ? String(body.title).trim() || group.title : group.title,
    grants: access.grants,
    denies: access.denies,
  });
  return respondMutation(c, { json: updated, redirect: `/g/${id}` });
}

groupRoutes.get("/g/:id/access", (c) => {
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
    formatPlainMessage(`Group ${id} access`, formatAccessSummary(payload.grants, payload.denies)),
  );
});

aliasFormMethods(groupRoutes, "put", "/g/:id/access", (c) => updateGroupAccess(c));

async function updateGroupAccess(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canManageGroup(user, group, world)) return apiError(c, 403, "Manage rights required");
  return updateAccess(c, {
    persist: (patch) => world.updateGroupAccess(id, patch),
    redirect: `/g/${id}`,
    flash: { updated: "1" },
  });
}

groupRoutes.post("/g/:id/transfer", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canTransferGroup(user, group, world)) {
    return apiError(c, 403, "Only the owner or a manager can transfer this group");
  }
  const body = await readRequestBody(c);
  const to = String(body.to ?? "").trim();
  if (!to) return apiError(c, 400, "Recipient username is required");
  try {
    const result = await world.transferGroupOwner(id, to, {
      keepAccess: parseKeepAccess(body),
      by: user.username,
    });
    return respondMutation(c, { json: result, redirect: `/g/${id}?transferred=1` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not transfer group");
  }
});

groupRoutes.post("/g/:id/scenes", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canManageGroup(user, group, world)) return apiError(c, 403, "Manage rights required");

  const body = await readRequestBody(c);
  const sceneId = Number(body.sceneId);
  if (!Number.isFinite(sceneId)) return apiError(c, 400, "sceneId is required");
  const scene = world.getScene(sceneId);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) {
    return apiError(c, 403, "Manage rights required on the scene");
  }

  try {
    const updated = await world.setSceneGroup(sceneId, id);
    return respondMutation(c, { json: { group: world.getGroup(id), scene: updated }, redirect: `/s/${sceneId}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not assign scene");
  }
});

groupRoutes.post("/eg", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const body = await readRequestBody(c);
  const title = String(body.title ?? "").trim();
  const entranceSceneId = Number(body.entranceSceneId);
  if (!title) return apiError(c, 400, "Title is required");
  if (!Number.isFinite(entranceSceneId)) return apiError(c, 400, "entranceSceneId is required");
  const entrance = world.getScene(entranceSceneId);
  if (!entrance) return apiError(c, 404, "Entrance scene not found");
  if (!canManage(user, entrance, world) && !isTopographer(user, world)) {
    return apiError(c, 403, "Manage rights required on entrance scene");
  }
  try {
    const eg = await world.createEntranceGroup({
      title,
      entranceSceneId,
      sceneIds: Array.isArray(body.sceneIds)
        ? body.sceneIds.map(Number).filter(Number.isFinite)
        : undefined,
    });
    return respondMutation(c, { json: eg, redirect: `/s/${entranceSceneId}`, status: 201 });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not create entrance group");
  }
});
