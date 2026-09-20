import { Hono } from "hono";
import type { Context } from "hono";
import { formatAccessSummary } from "../access/acl.js";
import {
  canAddExit,
  canDeleteScene,
  canEdit,
  canManage,
  canManageGroup,
  canPlaceArtefact,
  canRead,
  canRemoveExit,
  canReorderExits,
  canTransferScene,
  isManager,
  isTopographer,
} from "../access/permissions.js";
import { assertSceneEntry } from "../access/scene-entry.js";
import {
  aliasFormMethods,
  apiError,
  isResponse,
  page,
  readRequestBody,
  requireUser,
  respondMutation,
  wantsJson,
} from "../http.js";
import { triggerQuestEval } from "../logic/trigger.js";
import { INPUT_PHRASE_MAX } from "../model/logic.js";
import { exitAllowed, resolveSceneDetails, visibleArtefacts, visibleExits } from "../logic/world-view.js";
import { gateFactsFor, normalizeInputPhrase, parseDetailWhenMap, parseOptionalFlagRef } from "../logic/pred.js";
import { requestSessionToken } from "../middleware/auth.js";
import { negotiateFormat, queryDetailName } from "../render/format.js";
import { formatPlainMessage, scenePageView } from "../render/view/index.js";
import {
  collectExitKeys,
  EXIT_REQUEST_NOTE_MAX,
  isTruthy,
  optionalString,
  parseDetails,
  parseExitGates,
  parseKeepAccess,
  questActionReply,
  sceneGroupSummary,
  sceneLabel,
  sceneTitle,
  updateAccess,
} from "./helpers.js";

export const sceneRoutes = new Hono();

sceneRoutes.get("/s/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const entered = assertSceneEntry(c, id, { teleport: "redirect" });
  if (!entered.ok) return entered.response;
  const { scene, facts } = entered;

  const detail = queryDetailName(c);
  const exits = visibleExits(world.getExits(id), facts);
  const artefacts = visibleArtefacts(world.artefactsAt(id), facts);
  const readerScene = {
    ...scene,
    details: resolveSceneDetails(scene, facts),
  };
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
  const entranceGroups =
    user && (manage || isTopographer(user, world))
      ? world.listEntranceGroups().map((g) => ({
          id: g.id,
          title: g.title,
          entranceSceneId: g.entranceSceneId,
        }))
      : [];
  const entranceGroup = scene.entranceGroupId
    ? world.getEntranceGroup(scene.entranceGroupId)
    : undefined;
  const isEntrance = entranceGroup?.entranceSceneId === scene.id;

  if (user) c.get("locations").noteVisit(user.username, scene.id);

  const subscriberCount = world.getSubscribers(id).length;
  const notice = c.get("sessions").takeActionMessage(requestSessionToken(c));

  return page(
    c,
    200,
    scenePageView({
      scene: readerScene,
      exits,
      artefacts,
      detail,
      isEntrance,
      accessSummary,
      subscribed: user ? world.isSubscribed(id, user.username) : undefined,
      subscriberCount: user ? subscriberCount : undefined,
      showInput: Boolean(user),
      notice,
    }),
    {
      kind: "scene",
      scene,
      exits: world.getExits(id).map((e) => ({
        ...e,
        canRemove: canRemoveExit(user, scene, e, world),
      })),
      canEdit: canEdit(user, scene, world),
      canManage: manage,
      canAddExit: canAddExit(user, scene, world),
      canPlaceArtefact: canPlaceArtefact(user, scene, world),
      canReorderExits: canReorderExits(user, scene, world),
      isTopographer: isTopographer(user, world),
      canDelete: canDeleteScene(user, scene, world),
      canTransfer: canTransferScene(user, scene, world),
      isManager: isManager(user, world),
      groups,
      entranceGroups,
      sceneGroup: sceneGroupSummary(world, scene.groupId),
    },
  );
});

sceneRoutes.get("/s/:id/go/:exit", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const fromId = Number(c.req.param("id"));
  const exitKey = decodeURIComponent(String(c.req.param("exit") ?? ""));
  const from = world.getScene(fromId);
  if (!from) return apiError(c, 404, "Scene not found");
  if (!canRead(user, from, world)) {
    return apiError(c, user ? 403 : 401, "Cannot leave from an unreachable scene");
  }
  const exit = world.findExit(fromId, exitKey);
  if (!exit) return apiError(c, 404, `No exit matching "${exitKey}"`);

  const facts = gateFactsFor(world, user);
  if (!exitAllowed(exit, facts)) {
    const msg = exit.whenDenied?.trim() || "That way is closed.";
    return apiError(c, 403, msg);
  }

  const resolved = world.resolveTeleportTarget(exit.toSceneId, fromId);
  const destEntry = assertSceneEntry(c, resolved.sceneId, {
    teleport: "ignore",
    fromHint: fromId,
  });
  if (!destEntry.ok) return destEntry.response;
  if (user) {
    await triggerQuestEval(c, user, resolved.sceneId);
  }
  return c.redirect(`${c.get("assetBase")}/s/${resolved.sceneId}?from=${fromId}`);
});

sceneRoutes.post("/s/:id/input", async (c) => {
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const entered = assertSceneEntry(c, id, { teleport: "forbid" });
  if (!entered.ok) return entered.response;
  const { scene } = entered;

  const body = await readRequestBody(c);
  const phrase = body.phrase !== undefined ? String(body.phrase) : "";
  if (phrase.length > INPUT_PHRASE_MAX) {
    return apiError(c, 400, "That phrase is too long.");
  }
  if (!normalizeInputPhrase(phrase)) {
    return apiError(c, 400, "Phrase required.");
  }

  c.get("locations").noteVisit(user.username, scene.id);
  const outcome = await triggerQuestEval(c, user, scene.id, {
    wake: "input",
    inputPhrase: phrase,
  });
  return questActionReply(c, `/s/${id}`, outcome);
});

sceneRoutes.post("/s", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const body = await readRequestBody(c);
  const text = String(body.body ?? "");
  if (!text.trim()) return apiError(c, 400, "Body is required");

  let details: Record<string, string>;
  try {
    details = parseDetails(body.detailsJson ?? body.details);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid details JSON");
  }

  const scene = await world.createScene({
    owner: user.username,
    title: optionalString(body.title),
    body: text,
    details,
    visibility: body.visibility === "public" || body.visibility === true ? "public" : "private",
  });

  return respondMutation(c, { json: scene, redirect: `/s/${scene.id}`, status: 201 });
});

aliasFormMethods(sceneRoutes, "put", "/s/:id", (c) => updateScene(c));

async function updateScene(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canEdit(user, scene, world)) return apiError(c, 403, "Not allowed to edit this scene");

  const body = await readRequestBody(c);
  let details: Record<string, string> | undefined;
  if (body.detailsJson !== undefined || body.details !== undefined) {
    try {
      details = parseDetails(body.detailsJson ?? body.details);
    } catch (err) {
      return apiError(c, 400, err instanceof Error ? err.message : "Invalid details JSON");
    }
  }

  let visibility = scene.visibility;
  if (body.visibility !== undefined) {
    visibility =
      body.visibility === "public" || body.visibility === true || body.visibility === "on"
        ? "public"
        : "private";
  }

  let isJunction = scene.isJunction;
  if (body.isJunction !== undefined && canManage(user, scene, world)) {
    isJunction =
      body.isJunction === true ||
      body.isJunction === "true" ||
      body.isJunction === "on" ||
      body.isJunction === "1";
  }

  let isRepository = scene.isRepository;
  if (body.isRepository !== undefined && canManage(user, scene, world)) {
    isRepository =
      body.isRepository === true ||
      body.isRepository === "true" ||
      body.isRepository === "on" ||
      body.isRepository === "1";
  }

  const clearGates: Array<"when" | "whenDenied" | "detailWhen"> = [];
  const gatePatch: {
    when?: string;
    whenDenied?: string;
    detailWhen?: Record<string, string>;
  } = {};

  if (body.when !== undefined || body.flag !== undefined) {
    const ref = parseOptionalFlagRef(body.when ?? body.flag);
    if (ref) gatePatch.when = ref;
    else clearGates.push("when");
  }
  if (body.whenDenied !== undefined) {
    const msg = String(body.whenDenied).trim();
    if (msg) gatePatch.whenDenied = msg;
    else clearGates.push("whenDenied");
  }
  if (body.detailWhenJson !== undefined || body.detailWhen !== undefined) {
    try {
      const raw =
        body.detailWhenJson !== undefined
          ? typeof body.detailWhenJson === "string"
            ? body.detailWhenJson.trim()
              ? JSON.parse(body.detailWhenJson as string)
              : {}
            : body.detailWhenJson
          : body.detailWhen;
      const map = parseDetailWhenMap(raw);
      if (map) gatePatch.detailWhen = map;
      else clearGates.push("detailWhen");
    } catch (err) {
      return apiError(c, 400, err instanceof Error ? err.message : "Invalid detailWhen JSON");
    }
  }

  const updated = await world.updateScene(
    id,
    {
      title: body.title !== undefined ? optionalString(body.title) : scene.title,
      body: body.body !== undefined ? String(body.body) : scene.body,
      details,
      visibility,
      isJunction,
      isRepository,
      ...gatePatch,
    },
    {
      by: user.username,
      retainSnapshot: isTruthy(body.retainSnapshot) || isTruthy(body.keepVersion),
      clearGates: clearGates.length ? clearGates : undefined,
    },
  );

  return respondMutation(c, { json: updated, redirect: `/s/${id}` });
}

sceneRoutes.get("/s/:id/access", (c) => {
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
      formatPlainMessage(`Scene ${id} access`, formatAccessSummary(payload.grants, payload.denies)),
    );
  }
  return c.redirect(`${c.get("assetBase")}/s/${id}`);
});

aliasFormMethods(sceneRoutes, "put", "/s/:id/access", (c) => updateSceneAccess(c));

async function updateSceneAccess(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) return apiError(c, user ? 403 : 401, "Manage rights required");
  return updateAccess(c, {
    persist: (patch) => world.updateSceneAccess(id, patch),
    redirect: `/s/${id}`,
  });
}

sceneRoutes.post("/s/:id/transfer", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canTransferScene(user, scene, world)) {
    return apiError(c, 403, "Only the owner or a manager can transfer this scene");
  }
  const body = await readRequestBody(c);
  const to = String(body.to ?? "").trim();
  if (!to) return apiError(c, 400, "Recipient username is required");
  try {
    const result = await world.transferSceneOwner(id, to, {
      keepAccess: parseKeepAccess(body),
      by: user.username,
    });
    return respondMutation(c, { json: result, redirect: `/s/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not transfer scene");
  }
});

sceneRoutes.post("/s/:id/group", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const sceneId = Number(c.req.param("id"));
  const scene = world.getScene(sceneId);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) return apiError(c, 403, "Manage rights required");

  const body = await readRequestBody(c);
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
    return respondMutation(c, { json: updated, redirect: `/s/${sceneId}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not set group");
  }
});

sceneRoutes.post("/s/:id/exits", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canAddExit(user, scene, world)) {
    return apiError(c, 403, "Not allowed to add exits from this scene");
  }

  const body = await readRequestBody(c);
  const nickname = String(body.nickname ?? "").trim();
  const toSceneId = Number(body.toSceneId);
  if (!nickname) return apiError(c, 400, "Nickname is required");
  if (!Number.isFinite(toSceneId)) return apiError(c, 400, "toSceneId is required");

  const dest = world.getScene(toSceneId);
  if (!dest) return apiError(c, 404, "Destination scene not found");
  if (!canRead(user, dest, world)) {
    return apiError(c, 403, "Destination must be reachable");
  }

  try {
    const exit = await world.addExit(id, nickname, toSceneId, parseExitGates(body));
    return respondMutation(c, { json: exit, redirect: `/s/${id}`, status: 201 });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not add exit");
  }
});

sceneRoutes.post("/s/:id/exit-requests", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canRead(user, scene, world)) {
    return apiError(c, user ? 403 : 401, "Cannot request an exit from an unreachable scene");
  }
  if (canAddExit(user, scene, world)) {
    return apiError(c, 400, "You can add exits here directly — no request needed");
  }

  const owner = world.getUser(scene.owner);
  if (!owner) return apiError(c, 404, "Scene owner not found");
  if (owner.username === user.username) {
    return apiError(c, 400, "You own this scene — add the exit directly");
  }

  const body = await readRequestBody(c);
  const nickname = String(body.nickname ?? "").trim();
  const toSceneId = Number(body.toSceneId);
  const note = String(body.note ?? "").trim();
  if (!nickname) return apiError(c, 400, "Nickname is required");
  if (!Number.isFinite(toSceneId)) return apiError(c, 400, "toSceneId is required");
  if (note.length > EXIT_REQUEST_NOTE_MAX) {
    return apiError(c, 400, `Note must be at most ${EXIT_REQUEST_NOTE_MAX} characters`);
  }

  const dest = world.getScene(toSceneId);
  if (!dest) return apiError(c, 404, "Destination scene not found");
  if (dest.owner !== user.username) {
    return apiError(c, 403, "Destination must be a scene you own");
  }

  if (world.findDuplicateExitRequest(owner.username, id, toSceneId, nickname)) {
    return apiError(c, 400, "An identical exit request is already in their inbox");
  }

  const bodyLines = [
    `${user.username} asks you to add an exit from your scene ${sceneLabel(scene)} to their scene ${sceneLabel(dest)}.`,
    `Suggested nickname: ${nickname}`,
  ];
  if (note) bodyLines.push("", `Note: ${note}`);

  try {
    const message = await world.createInboxMessage({
      type: "exit_request",
      toUser: owner.username,
      fromUser: user.username,
      subject: `Exit request: ${nickname}`,
      body: bodyLines.join("\n"),
      fromSceneId: id,
      toSceneId,
      nickname,
    });
    return respondMutation(c, { json: message, redirect: `/s/${id}`, status: 201 });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not create exit request");
  }
});

sceneRoutes.post("/s/:id/view-invites", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canRead(user, scene, world)) {
    return apiError(c, 403, "Cannot invite others to an unreachable scene");
  }

  const body = await readRequestBody(c);
  const uid = String(body.uid ?? "").trim();
  if (!uid) return apiError(c, 400, "Username is required");
  if (uid === user.username) {
    return apiError(c, 400, "You cannot invite yourself");
  }

  const invitee = world.getUser(uid);
  if (!invitee) return apiError(c, 404, "Invalid username");

  const sceneName = sceneTitle(scene);
  const subject = `Invite to view: ${sceneName}`;
  const messageBody = `${user.username} has invited you to view the scene, ${sceneName}. It's either new or has been updated recently.`;

  try {
    const existing = world.findDuplicateViewInvite(invitee.username, user.username, id);
    if (existing) {
      const refreshed = {
        ...existing,
        createdAt: new Date().toISOString(),
        subject,
        body: messageBody,
      };
      await world.saveInboxMessage(refreshed);
      return respondMutation(c, { json: refreshed, redirect: `/s/${id}` });
    }

    const message = await world.createInboxMessage({
      type: "invite_to_view",
      toUser: invitee.username,
      fromUser: user.username,
      subject,
      body: messageBody,
      sceneId: id,
    });
    return respondMutation(c, { json: message, redirect: `/s/${id}`, status: 201 });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not send invite");
  }
});

sceneRoutes.post("/s/:id/subscribe", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canRead(user, scene, world)) {
    return apiError(c, 403, "Cannot subscribe to an unreachable scene");
  }

  try {
    const subscribers = await world.subscribeScene(id, user.username);
    return respondMutation(c, { json: { ok: true, subscribed: true, subscribers }, redirect: `/s/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not subscribe");
  }
});

aliasFormMethods(sceneRoutes, "delete", "/s/:id/subscribe", (c) => dropSubscribe(c), "/s/:id/subscribe/drop");

async function dropSubscribe(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  if (!world.getScene(id)) return apiError(c, 404, "Scene not found");
  const subscribers = await world.unsubscribeScene(id, user.username);
  return respondMutation(c, { json: { ok: true, subscribed: false, subscribers }, redirect: `/s/${id}` });
}

aliasFormMethods(sceneRoutes, "delete", "/s/:id/exits/:exit", (c) => removeExit(c));
sceneRoutes.post("/s/:id/exits/delete", async (c) => removeExits(c));
sceneRoutes.post("/s/:id/exits/reorder", async (c) => reorderExitsRoute(c));

aliasFormMethods(sceneRoutes, "put", "/s/:id/exits/:exit", (c) => updateExitRoute(c));

async function updateExitRoute(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  const exitKey = decodeURIComponent(String(c.req.param("exit") ?? ""));
  if (exitKey === "delete" || exitKey === "reorder") {
    return apiError(c, 404, `No exit matching "${exitKey}"`);
  }
  const existing = world.findExit(id, exitKey);
  if (!existing) return apiError(c, 404, `No exit matching "${exitKey}"`);
  if (!canRemoveExit(user, scene, existing, world) && !canManage(user, scene, world)) {
    return apiError(c, 403, "Not allowed to edit this exit");
  }

  const body = await readRequestBody(c);
  const nickname =
    body.nickname !== undefined ? String(body.nickname).trim() : existing.nickname;
  if (!nickname) return apiError(c, 400, "Nickname is required");
  const toSceneId =
    body.toSceneId !== undefined ? Number(body.toSceneId) : existing.toSceneId;
  if (!Number.isFinite(toSceneId)) return apiError(c, 400, "toSceneId is required");
  const dest = world.getScene(toSceneId);
  if (!dest) return apiError(c, 404, "Destination scene not found");
  if (!canRead(user, dest, world)) {
    return apiError(c, 403, "Destination must be reachable");
  }

  const clearGates: Array<"when" | "whenDenied" | "hidden"> = [];
  const patch: {
    nickname: string;
    toSceneId: number;
    when?: string;
    whenDenied?: string;
    hidden?: boolean;
  } = { nickname, toSceneId };

  if (body.when !== undefined || body.flag !== undefined) {
    const ref = parseOptionalFlagRef(body.when ?? body.flag);
    if (ref) patch.when = ref;
    else clearGates.push("when");
  }
  if (body.whenDenied !== undefined) {
    const msg = String(body.whenDenied).trim();
    if (msg) patch.whenDenied = msg;
    else clearGates.push("whenDenied");
  }
  if (body.hidden !== undefined) {
    if (isTruthy(body.hidden)) patch.hidden = true;
    else clearGates.push("hidden");
  }

  try {
    const exit = await world.updateExit(id, existing.exitId, patch, {
      clearGates: clearGates.length ? clearGates : undefined,
    });
    return respondMutation(c, { json: exit, redirect: `/s/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not update exit");
  }
}

async function removeExit(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const exitKey = decodeURIComponent(String(c.req.param("exit") ?? ""));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  const exit = world.findExit(id, exitKey);
  if (!exit) return apiError(c, 404, `No exit matching "${exitKey}"`);
  if (!canRemoveExit(user, scene, exit, world)) {
    return apiError(c, 403, "Not allowed to remove this exit");
  }

  try {
    const removed = await world.removeExit(id, exitKey);
    return respondMutation(c, { json: removed, redirect: `/s/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not remove exit");
  }
}

async function removeExits(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");

  const body = await readRequestBody(c);
  const keys = collectExitKeys(body);
  if (!keys.length) return apiError(c, 400, "Select at least one exit to remove");

  const removed = [];
  for (const key of keys) {
    const exit = world.findExit(id, key);
    if (!exit) return apiError(c, 404, `No exit matching "${key}"`);
    if (!canRemoveExit(user, scene, exit, world)) {
      return apiError(c, 403, `Not allowed to remove exit ${exit.exitId}`);
    }
    removed.push(await world.removeExit(id, String(exit.exitId)));
  }

  return respondMutation(c, { json: { ok: true, removed }, redirect: `/s/${id}` });
}

async function reorderExitsRoute(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canReorderExits(user, scene, world)) {
    return apiError(c, 403, "Not allowed to reorder exits on this scene");
  }

  const body = await readRequestBody(c);
  const raw = body.exitIds ?? body.exitId;
  if (raw === undefined || raw === null || raw === "") {
    return apiError(c, 400, "exitIds is required");
  }
  const keys = collectExitKeys({ exitIds: raw });
  const exitIds = keys.map(Number);
  if (!exitIds.length || exitIds.some((n) => !Number.isInteger(n))) {
    return apiError(c, 400, "exitIds must be a list of exit ids");
  }

  try {
    const exits = await world.reorderExits(id, exitIds);
    return respondMutation(c, { json: { ok: true, exits }, redirect: `/s/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not reorder exits");
  }
}

sceneRoutes.post("/s/:id/entrance-group", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const sceneId = Number(c.req.param("id"));
  const scene = world.getScene(sceneId);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world) && !isTopographer(user, world)) {
    return apiError(c, 403, "Manage rights required");
  }
  const body = await readRequestBody(c);
  const raw = body.entranceGroupId;
  const entranceGroupId =
    raw === undefined || raw === null || raw === "" || raw === "none" ? null : String(raw);
  try {
    const updated = await world.setSceneEntranceGroup(sceneId, entranceGroupId);
    return respondMutation(c, { json: updated, redirect: `/s/${sceneId}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not set entrance group");
  }
});

aliasFormMethods(sceneRoutes, "delete", "/s/:id", (c) => deleteScene(c));

async function deleteScene(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canDeleteScene(user, scene, world)) {
    return apiError(c, 403, "Not allowed to delete this scene");
  }
  try {
    await world.deleteScene(id);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not delete scene");
  }
  return respondMutation(c, { json: { ok: true }, redirect: "/" });
}
