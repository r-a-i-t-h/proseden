import { Hono } from "hono";
import { canManage, canRead, canReadArtefact, isManager } from "../access/permissions.js";
import { apiError, isResponse, page, requireUser, respondMutation, wantsJson } from "../http.js";
import { editHistoryPageView, snapshotPageView } from "../render/view/index.js";

export const historyRoutes = new Hono();

historyRoutes.get("/s/:id/history", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canRead(user, scene, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to read this scene");
  }
  const log = await world.listEditLog("scenes", id);
  if (wantsJson(c)) return c.json({ edits: log });
  return page(c, 200, editHistoryPageView({ kind: "scene", id, log }), {
    kind: "scene",
    scene,
    canManage: canManage(user, scene, world),
    isManager: isManager(user, world),
  });
});

historyRoutes.get("/s/:id/history/:version", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const versionId = String(c.req.param("version") ?? "");
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canRead(user, scene, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to read this scene");
  }
  const snap = await world.getSceneSnapshot(id, versionId);
  if (!snap) return apiError(c, 404, "Snapshot not found");
  const manage = canManage(user, scene, world);
  return page(
    c,
    200,
    snapshotPageView({
      kind: "scene",
      id,
      versionId,
      body: snap.body,
      title: snap.title,
      canRestore: manage,
    }),
  );
});

historyRoutes.post("/s/:id/history/:version/restore", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const versionId = String(c.req.param("version") ?? "");
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) return apiError(c, 403, "Manage rights required to restore");
  try {
    const updated = await world.restoreSceneSnapshot(id, versionId, user.username);
    return respondMutation(c, { json: updated, redirect: `/s/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Restore failed");
  }
});

historyRoutes.get("/a/:id/history", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getScene(artefact.homeSceneId);
  if (!home || !canReadArtefact(user, artefact, home, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to read this artefact");
  }
  const log = await world.listEditLog("artefacts", id);
  if (wantsJson(c)) return c.json({ edits: log });
  return page(c, 200, editHistoryPageView({ kind: "artefact", id, log }));
});

historyRoutes.get("/a/:id/history/:version", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const versionId = String(c.req.param("version") ?? "");
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getScene(artefact.homeSceneId);
  if (!home || !canReadArtefact(user, artefact, home, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to read this artefact");
  }
  const snap = await world.getArtefactSnapshot(id, versionId);
  if (!snap) return apiError(c, 404, "Snapshot not found");
  const canRestore =
    !!user &&
    (user.username === artefact.owner || canManage(user, home, world));
  return page(
    c,
    200,
    snapshotPageView({
      kind: "artefact",
      id,
      versionId,
      body: snap.body,
      canRestore,
    }),
  );
});

historyRoutes.post("/a/:id/history/:version/restore", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const versionId = String(c.req.param("version") ?? "");
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getScene(artefact.homeSceneId);
  if (
    user.username !== artefact.owner &&
    !(home && canManage(user, home, world))
  ) {
    return apiError(c, 403, "Manage rights required to restore");
  }
  try {
    const updated = await world.restoreArtefactSnapshot(id, versionId, user.username);
    return respondMutation(c, { json: updated, redirect: `/a/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Restore failed");
  }
});
