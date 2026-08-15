import { Hono } from "hono";
import type { Context } from "hono";
import { formatAccessSummary, parseAccessPayload } from "../access/acl.js";
import {
  canEdit,
  canEditArtefact,
  canAddExit,
  canManage,
  canManageGroup,
  canTransferGroup,
  canTransferScene,
  canRead,
  canReadArtefact,
  canReadGroup,
  canRemoveExit,
  isManager,
  isModerator,
  isTopographer,
} from "../access/permissions.js";
import { apiError, liveSceneIdForUser, page, sceneBackLink, wantsJson } from "../http.js";
import { prepareJsonTextarea } from "../json-textarea.js";
import { rateLimit } from "../middleware/rate-limit.js";
import type { InboxMessage, StaffRole } from "../model/types.js";
import { negotiateFormat, queryDetailName } from "../render/format.js";
import {
  escapeHtml,
  renderEditHistoryBodyHtml,
  renderGroupBodyHtml,
  renderGroupsIndexHtml,
  renderInventoryBodyHtml,
  renderMessageBodyHtml,
  renderSnapshotBodyHtml,
  renderStaffBodyHtml,
  renderUserProfileBodyHtml,
  userLinkHtml,
} from "../render/html.js";
import {
  artefactPageView,
  inboxPageView,
  msgPageView,
  profilePageView,
  scenePageView,
} from "../render/view/index.js";
import {
  renderEditHistoryText,
  renderGroupsIndexText,
  renderInventoryText,
  renderMessageText,
  renderSnapshotText,
  renderUserProfileText,
} from "../render/text.js";

export const worldRoutes = new Hono();

const PEER_MESSAGE_MAX = 2000;

const peerMailLimit = rateLimit({
  name: "peer-mail",
  bucket: (limits) => limits.peerMail,
  key: (c) => {
    const user = c.get("user");
    return user ? `user:${user.username}` : `ip:unknown`;
  },
});

worldRoutes.get("/", (c) => {
  const world = c.get("world");
  return c.redirect(`${c.get("assetBase")}/s/${world.worldEntranceSceneId()}`);
});
worldRoutes.get("/s", (c) => {
  const world = c.get("world");
  return c.redirect(`${c.get("assetBase")}/s/${world.worldEntranceSceneId()}`);
});

worldRoutes.get("/s/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  // Prefer explicit ?from=/Referer; otherwise treat a readable lastSceneId as
  // still being "here" (profile/admin/user-page returns) so entrance groups
  // do not bounce the traveller to the entrance.
  const fromHint = parseFromScene(c) ?? liveSceneIdForUser(user, world);
  const resolved = world.resolveTeleportTarget(id, fromHint, {
    asOwnerUsername: user?.username,
  });
  if (resolved.redirected) {
    const entrance = world.getScene(resolved.sceneId);
    if (!entrance || !canRead(user, entrance, world)) {
      const msg = "Entrance to this area is not reachable.";
      return page(
        c,
        user ? 403 : 401,
        "Forbidden",
        renderMessageBodyHtml("Forbidden", msg),
        renderMessageText("Forbidden", msg),
      );
    }
    const dest = `${c.get("assetBase")}/s/${resolved.sceneId}`;
    return c.redirect(dest);
  }

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

  return page(
    c,
    200,
    scenePageView({
      scene,
      exits,
      artefacts,
      detail,
      isEntrance,
      accessSummary,
    }),
    {
      kind: "scene",
      scene,
      exits: exits.map((e) => ({
        ...e,
        canRemove: canRemoveExit(user, scene, e, world),
      })),
      canEdit: canEdit(user, scene, world),
      canManage: manage,
      canAddExit: canAddExit(user, scene, world),
      isTopographer: isTopographer(user, world),
      canDelete: manage || isModerator(user, world),
      canTransfer: canTransferScene(user, scene, world),
      isManager: isManager(user, world),
      groups,
      entranceGroups,
      sceneGroup: sceneGroupSummary(world, scene.groupId),
    },
  );
});

worldRoutes.get("/s/:id/go/:exit", (c) => {
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

  const resolved = world.resolveTeleportTarget(exit.toSceneId, fromId);
  const dest = world.getScene(resolved.sceneId);
  if (!dest || !canRead(user, dest, world)) {
    return apiError(c, user ? 403 : 401, "Destination is not reachable");
  }
  return c.redirect(`${c.get("assetBase")}/s/${resolved.sceneId}?from=${fromId}`);
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
      renderMessageBodyHtml("Forbidden", "This artefact is not for your eyes."),
      renderMessageText("Forbidden", "This artefact is not for your eyes."),
    );
  }

  const detail = queryDetailName(c);
  const collected = !!user?.inventory.some((i) => i.artefactId === id);

  // Stay present in the artefact's home scene while examining it.
  if (user) c.get("locations").noteVisit(user.username, artefact.homeSceneId);

  return page(
    c,
    200,
    artefactPageView({
      artefact,
      detail,
      collected: user ? collected : undefined,
    }),
    {
      kind: "artefact",
      artefact,
      canEdit: canEditArtefact(user, artefact, home, world),
      canDelete:
        !!user &&
        (user.username === artefact.owner ||
          isModerator(user, world) ||
          canManage(user, home, world)),
      isManager: isManager(user, world),
      collected,
    },
  );
});

worldRoutes.get("/profile", (c) => {
  const user = c.get("user");
  if (!user) {
    return page(
      c,
      401,
      "Profile",
      renderMessageBodyHtml("Profile", "Log in to view your profile."),
      renderMessageText("Profile", "Authentication required."),
    );
  }

  const message = c.req.query("updated")
    ? "Password updated."
    : c.req.query("shared")
      ? "Share-all saved."
      : c.req.query("appearance")
        ? "Appearance saved."
        : undefined;
  const openSection = c.req.query("updated")
    ? "password"
    : c.req.query("shared")
      ? "sharing"
      : "appearance";
  const world = c.get("world");
  const back = sceneBackLink(user, world);
  return page(
    c,
    200,
    profilePageView({
      username: user.username,
      message,
      description: user.description,
      details: user.details,
      grants: user.grants,
      denies: user.denies,
      back,
      openSection,
    }),
  );
});

worldRoutes.put("/profile", async (c) => updateProfileAppearance(c));
worldRoutes.post("/profile", async (c) => updateProfileAppearance(c));

async function updateProfileAppearance(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const body = await readBody(c);
  let details: Record<string, string> | undefined;
  if (body.detailsJson !== undefined || body.details !== undefined) {
    try {
      details = parseDetails(body.detailsJson ?? body.details);
    } catch (err) {
      return apiError(c, 400, err instanceof Error ? err.message : "Invalid details JSON");
    }
  }

  if (body.description === undefined && details === undefined) {
    return apiError(c, 400, "description and/or details required");
  }

  const updated = await world.updateUserAppearance(user.username, {
    description: body.description !== undefined ? String(body.description) : undefined,
    details,
  });

  if (wantsJson(c)) {
    return c.json({ description: updated.description, details: updated.details });
  }
  return c.redirect(`${c.get("assetBase")}/profile?appearance=1`);
}

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
    .map((item) => world.getArtefact(item.artefactId))
    .filter((a): a is NonNullable<typeof a> => !!a);

  const assetBase = c.get("assetBase");
  const back = sceneBackLink(user, world);
  return page(
    c,
    200,
    "Inventory",
    renderInventoryBodyHtml(items, back),
    renderInventoryText(items, assetBase, back),
    {
      kind: "inventory",
      isManager: isManager(user, world),
    },
  );
});

const EXIT_REQUEST_NOTE_MAX = 500;

worldRoutes.get("/inbox", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(
      c,
      401,
      "Messages",
      renderMessageBodyHtml("Messages", "Log in to view your messages."),
      renderMessageText("Messages", "Authentication required."),
    );
  }

  const flash = c.req.query("confirmed")
    ? "Exit confirmed."
    : c.req.query("deleted")
      ? "Message deleted."
      : c.req.query("sent")
        ? "Message sent."
        : undefined;
  const peerMessagingEnabled = world.isPeerMessagingEnabled();
  const messages = world.listInboxFor(user.username);
  const back = sceneBackLink(user, world);
  const composeTo = String(c.req.query("to") ?? "").trim();
  if (wantsJson(c)) {
    return c.json({ messages, peerMessagingEnabled });
  }
  return page(
    c,
    200,
    inboxPageView({
      messages,
      message: flash,
      back,
      peerMessagingEnabled,
      composeTo: composeTo || undefined,
    }),
  );
});

worldRoutes.post("/inbox/send", peerMailLimit, async (c) => sendPeerMessage(c));
worldRoutes.post("/inbox/:id/confirm", async (c) => confirmInboxMessage(c));
worldRoutes.post("/inbox/:id/delete", async (c) => deleteInboxMessage(c));
worldRoutes.delete("/inbox/:id", async (c) => deleteInboxMessage(c));

async function sendPeerMessage(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const body = await readBody(c);
  const toRaw = String(body.uid ?? "").trim();
  const text = typeof body.body === "string" ? body.body : String(body.body ?? "");
  const trimmed = text.trim();

  const fail = (status: 400 | 403 | 404, error: string) => {
    if (wantsJson(c) || negotiateFormat(c) === "text") {
      return apiError(c, status, error);
    }
    const back = sceneBackLink(user, world);
    return page(
      c,
      status,
      inboxPageView({
        messages: world.listInboxFor(user.username),
        error,
        back,
        peerMessagingEnabled: world.isPeerMessagingEnabled(),
        composeTo: toRaw,
        composeBody: text,
      }),
    );
  };

  if (!world.isPeerMessagingEnabled()) {
    return fail(403, "Peer messaging is disabled.");
  }
  if (!toRaw) return fail(400, "Choose a recipient.");
  if (toRaw === user.username) return fail(400, "You cannot message yourself.");
  if (!world.getUser(toRaw)) return fail(404, `User not found: ${toRaw}`);
  if (!trimmed) return fail(400, "Message is required.");

  const bodyText =
    trimmed.length > PEER_MESSAGE_MAX ? trimmed.slice(0, PEER_MESSAGE_MAX) : trimmed;
  const subject = `Personal message from ${user.username}`;

  try {
    const message = await world.createInboxMessage({
      type: "message",
      toUser: toRaw,
      fromUser: user.username,
      subject,
      body: bodyText,
    });
    if (wantsJson(c)) return c.json({ ok: true, message }, 201);
    if (negotiateFormat(c) === "text") {
      return c.text(renderMessageText("Messages", `Message sent to ${toRaw}.`), 201);
    }
    return c.redirect(`${c.get("assetBase")}/inbox?sent=1`);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Could not send message");
  }
}

async function confirmInboxMessage(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const message = world.getInboxMessage(id);
  if (!message || message.toUser !== user.username) {
    return apiError(c, 404, "Inbox message not found");
  }
  if (message.type !== "exit_request") {
    return apiError(c, 400, "Only exit requests can be confirmed");
  }

  const origin = world.getScene(message.fromSceneId);
  if (!origin) return apiError(c, 404, "Origin scene not found");
  if (!canAddExit(user, origin, world)) {
    return apiError(c, 403, "Not allowed to add exits from this scene");
  }

  const dest = world.getScene(message.toSceneId);
  if (!dest) return apiError(c, 404, "Destination scene not found");
  if (!canRead(user, dest, world)) {
    return apiError(c, 403, "Destination must be reachable");
  }

  try {
    const exit = await world.addExit(message.fromSceneId, message.nickname, message.toSceneId);
    await world.deleteInboxMessage(message.id);
    const notice = await world.createInboxMessage({
      type: "notice",
      toUser: message.fromUser,
      fromUser: user.username,
      subject: `Exit confirmed: ${message.nickname}`,
      body: [
        `${user.username} confirmed your exit request.`,
        `Exit "${message.nickname}" now leads from ${sceneLabel(origin)} to ${sceneLabel(dest)}.`,
      ].join("\n\n"),
    });
    if (wantsJson(c)) {
      return c.json({ exit, notice });
    }
    return c.redirect(`${c.get("assetBase")}/inbox?confirmed=1`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not confirm exit request");
  }
}

async function deleteInboxMessage(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const message = world.getInboxMessage(id);
  if (!message || message.toUser !== user.username) {
    return apiError(c, 404, "Inbox message not found");
  }

  try {
    await world.deleteInboxMessage(id);
    if (wantsJson(c)) return c.json({ ok: true, id });
    return c.redirect(`${c.get("assetBase")}/inbox?deleted=1`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not delete message");
  }
}

function sceneLabel(scene: { id: number; title?: string }): string {
  const title = scene.title?.trim();
  return title ? `${title} (${scene.id})` : `Scene ${scene.id}`;
}

function sceneTitle(scene: { id: number; title?: string }): string {
  const title = scene.title?.trim();
  return title || `scene ${scene.id}`;
}

// --- mutations ---

worldRoutes.post("/s", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const body = await readBody(c);
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

  const updated = await world.updateScene(
    id,
    {
      title: body.title !== undefined ? optionalString(body.title) : scene.title,
      body: body.body !== undefined ? String(body.body) : scene.body,
      details,
      visibility,
      isJunction,
    },
    {
      by: user.username,
      retainSnapshot: isTruthy(body.retainSnapshot) || isTruthy(body.keepVersion),
    },
  );

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

worldRoutes.post("/s/:id/transfer", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canTransferScene(user, scene, world)) {
    return apiError(c, 403, "Only the owner or a manager can transfer this scene");
  }
  const body = await readBody(c);
  const to = String(body.to ?? "").trim();
  if (!to) return apiError(c, 400, "Recipient username is required");
  try {
    const result = await world.transferSceneOwner(id, to, {
      keepAccess: parseKeepAccess(body),
      by: user.username,
    });
    if (wantsJson(c)) return c.json(result);
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not transfer scene");
  }
});

worldRoutes.get("/u/:username", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const username = String(c.req.param("username") ?? "");
  const target = world.getUser(username);
  if (!target) return apiError(c, 404, "User not found");

  const description = target.description ?? "";
  const details = target.details ?? {};
  const detail = queryDetailName(c);
  const ownedScenes = world.listScenesOwnedBy(target.username).length;
  const ownedArtefacts = world.listArtefactsOwnedBy(target.username).length;
  const lastSeenAt = target.lastSeenAt;
  const payload = {
    username: target.username,
    description,
    details,
    ownedScenes,
    ownedArtefacts,
    ...(lastSeenAt ? { lastSeenAt } : {}),
  };
  if (wantsJson(c)) {
    if (detail) {
      return c.json({
        username: target.username,
        detail,
        text: details[detail] ?? null,
      });
    }
    return c.json(payload);
  }

  const back = user
    ? sceneBackLink(user, world)
    : { href: "./", label: "← Back", history: true };
  return page(
    c,
    200,
    target.username,
    renderUserProfileBodyHtml({
      username: target.username,
      description,
      details,
      detail,
      ownedScenes,
      ownedArtefacts,
      lastSeenAt,
      back,
    }),
    renderUserProfileText({
      username: target.username,
      description,
      details,
      detail,
      ownedScenes,
      ownedArtefacts,
      lastSeenAt,
      basePath: c.get("assetBase"),
      back,
    }),
  );
});

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
    if (username === user.username) {
      return c.redirect(`${c.get("assetBase")}/profile?shared=1`);
    }
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
  return isManager(user, world);
}

function parseFromScene(c: Context): number | undefined {
  const q = c.req.query("from");
  if (q !== undefined) {
    const n = Number(q);
    if (Number.isFinite(n)) return n;
  }
  const referer = c.req.header("referer") ?? "";
  const match = referer.match(/\/s\/(\d+)/);
  if (match) {
    const n = Number(match[1]);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

// --- groups ---

worldRoutes.get("/g", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(
      c,
      401,
      "Groups",
      renderMessageBodyHtml("Groups", "Log in to view your groups."),
      renderMessageText("Groups", "Authentication required."),
    );
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
  return page(
    c,
    200,
    "Groups",
    renderGroupsIndexHtml({ managed, readable, back }),
    renderGroupsIndexText(managed, readable, c.get("assetBase"), back),
  );
});

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
    group.title,
    renderGroupBodyHtml({
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
    renderMessageText(`Group ${group.id}`, summary),
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
    return c.redirect(`${c.get("assetBase")}/g/${id}?updated=1`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid access payload");
  }
}

worldRoutes.post("/g/:id/transfer", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = String(c.req.param("id") ?? "");
  const group = world.getGroup(id);
  if (!group) return apiError(c, 404, "Group not found");
  if (!canTransferGroup(user, group, world)) {
    return apiError(c, 403, "Only the owner or a manager can transfer this group");
  }
  const body = await readBody(c);
  const to = String(body.to ?? "").trim();
  if (!to) return apiError(c, 400, "Recipient username is required");
  try {
    const result = await world.transferGroupOwner(id, to, {
      keepAccess: parseKeepAccess(body),
      by: user.username,
    });
    if (wantsJson(c)) return c.json(result);
    return c.redirect(`${c.get("assetBase")}/g/${id}?transferred=1`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not transfer group");
  }
});

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
  if (!canAddExit(user, scene, world)) {
    return apiError(c, 403, "Not allowed to add exits from this scene");
  }

  const body = await readBody(c);
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
    const exit = await world.addExit(id, nickname, toSceneId);
    if (wantsJson(c)) return c.json(exit, 201);
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not add exit");
  }
});

worldRoutes.post("/s/:id/exit-requests", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

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

  const body = await readBody(c);
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
    if (wantsJson(c)) return c.json(message, 201);
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not create exit request");
  }
});

worldRoutes.post("/s/:id/view-invites", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canRead(user, scene, world)) {
    return apiError(c, 403, "Cannot invite others to an unreachable scene");
  }

  const body = await readBody(c);
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
      if (wantsJson(c)) return c.json(refreshed);
      return c.redirect(`${c.get("assetBase")}/s/${id}`);
    }

    const message = await world.createInboxMessage({
      type: "invite_to_view",
      toUser: invitee.username,
      fromUser: user.username,
      subject,
      body: messageBody,
      sceneId: id,
    });
    if (wantsJson(c)) return c.json(message, 201);
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not send invite");
  }
});

worldRoutes.delete("/s/:id/exits/:exit", async (c) => removeExit(c));
worldRoutes.post("/s/:id/exits/:exit/delete", async (c) => removeExit(c));
worldRoutes.post("/s/:id/exits/delete", async (c) => removeExits(c));

async function removeExit(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

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
    if (wantsJson(c)) return c.json(removed);
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not remove exit");
  }
}

async function removeExits(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");

  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");

  const body = await readBody(c);
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

  if (wantsJson(c)) return c.json({ ok: true, removed });
  return c.redirect(`${c.get("assetBase")}/s/${id}`);
}

function collectExitKeys(body: Record<string, unknown>): string[] {
  const raw = body.exitId ?? body.exitIds ?? body.exit;
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) {
    return raw.map(String).map((s) => s.trim()).filter(Boolean);
  }
  const text = String(raw).trim();
  if (!text) return [];
  if (text.includes(",")) {
    return text.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [text];
}

worldRoutes.post("/eg", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const body = await readBody(c);
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
    if (wantsJson(c)) return c.json(eg, 201);
    return c.redirect(`${c.get("assetBase")}/s/${entranceSceneId}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not create entrance group");
  }
});

worldRoutes.post("/s/:id/entrance-group", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const sceneId = Number(c.req.param("id"));
  const scene = world.getScene(sceneId);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world) && !isTopographer(user, world)) {
    return apiError(c, 403, "Manage rights required");
  }
  const body = await readBody(c);
  const raw = body.entranceGroupId;
  const entranceGroupId =
    raw === undefined || raw === null || raw === "" || raw === "none" ? null : String(raw);
  try {
    const updated = await world.setSceneEntranceGroup(sceneId, entranceGroupId);
    if (wantsJson(c)) return c.json(updated);
    return c.redirect(`${c.get("assetBase")}/s/${sceneId}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not set entrance group");
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

  let details: Record<string, string>;
  try {
    details = parseDetails(body.detailsJson ?? body.details);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid details JSON");
  }

  const artefact = await world.createArtefact({
    owner: user.username,
    homeSceneId,
    title: optionalString(body.title),
    body: text,
    details,
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
    let details: Record<string, string> | undefined;
    if (body.detailsJson !== undefined || body.details !== undefined) {
      details = parseDetails(body.detailsJson ?? body.details);
    }
    const updated = await world.updateArtefact(
      id,
      {
        title: body.title !== undefined ? optionalString(body.title) : artefact.title,
        body: body.body !== undefined ? String(body.body) : artefact.body,
        details,
        tags: body.tags !== undefined ? parseTags(body.tags) : undefined,
        homeSceneId: body.homeSceneId !== undefined ? Number(body.homeSceneId) : undefined,
      },
      {
        by: user.username,
        retainSnapshot: isTruthy(body.retainSnapshot) || isTruthy(body.keepVersion),
      },
    );
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
    return apiError(c, 403, "Cannot collect a prohibited artefact");
  }

  const updated = await world.collectArtefact(user.username, id);
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

worldRoutes.delete("/s/:id", async (c) => deleteScene(c));
worldRoutes.post("/s/:id/delete", async (c) => deleteScene(c));

async function deleteScene(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world) && !isModerator(user, world)) {
    return apiError(c, 403, "Not allowed to delete this scene");
  }
  try {
    await world.deleteScene(id);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not delete scene");
  }
  if (wantsJson(c)) return c.json({ ok: true });
  return c.redirect(`${c.get("assetBase")}/`);
}

worldRoutes.delete("/a/:id", async (c) => deleteArtefact(c));
worldRoutes.post("/a/:id/delete", async (c) => deleteArtefact(c));

async function deleteArtefact(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getScene(artefact.homeSceneId);
  const allowed =
    user.username === artefact.owner ||
    isModerator(user, world) ||
    (!!home && canManage(user, home, world));
  if (!allowed) return apiError(c, 403, "Not allowed to delete this artefact");
  await world.deleteArtefact(id);
  if (wantsJson(c)) return c.json({ ok: true });
  return c.redirect(`${c.get("assetBase")}/`);
}

worldRoutes.get("/msg", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const usernames = world.listUsers().map((u) => u.username);
  const peerMessagingEnabled = world.isPeerMessagingEnabled();
  const notice =
    msgSentNotice(c.req.query("sent"), c.req.query("n")) ??
    msgPeerNotice(c.req.query("peer")) ??
    msgPurgeNotice(c.req.query("purged"), c.req.query("from"), c.req.query("n"));
  if (wantsJson(c)) {
    return c.json({
      users: usernames,
      all: "*",
      peerMessagingEnabled,
      ...(notice ? { notice } : {}),
    });
  }
  const back = sceneBackLink(user!, world);
  return page(c, 200, msgPageView({ usernames, notice, back, peerMessagingEnabled }));
});

worldRoutes.post("/msg/peer-messaging", async (c) => setPeerMessaging(c));
worldRoutes.post("/msg/purge-from", async (c) => purgeInboxFromUser(c));
worldRoutes.post("/msg", async (c) => sendManagerMessage(c));

async function setPeerMessaging(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const body = await readBody(c);
  const raw = body.enabled ?? body.peerMessagingEnabled;
  const enabled =
    raw === true ||
    raw === 1 ||
    String(raw).toLowerCase() === "true" ||
    String(raw) === "1" ||
    String(raw).toLowerCase() === "on";
  const settings = await world.setPeerMessagingEnabled(enabled);
  if (wantsJson(c)) {
    return c.json({ ok: true, peerMessagingEnabled: settings.peerMessagingEnabled });
  }
  return c.redirect(
    `${c.get("assetBase")}/msg?peer=${settings.peerMessagingEnabled ? "on" : "off"}`,
  );
}

async function purgeInboxFromUser(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const body = await readBody(c);
  const uid = String(body.uid ?? "").trim();
  const usernames = world.listUsers().map((u) => u.username);
  const peerMessagingEnabled = world.isPeerMessagingEnabled();

  const fail = (error: string) => {
    if (wantsJson(c) || negotiateFormat(c) === "text") {
      return apiError(c, 400, error);
    }
    const back = sceneBackLink(user!, world);
    return page(
      c,
      400,
      msgPageView({ usernames, error, back, peerMessagingEnabled }),
    );
  };

  if (!uid) return fail("Username is required.");
  const deleted = await world.deleteInboxFromUser(uid);
  if (wantsJson(c)) {
    return c.json({ ok: true, uid, deleted });
  }
  return c.redirect(
    `${c.get("assetBase")}/msg?purged=1&from=${encodeURIComponent(uid)}&n=${deleted}`,
  );
}

async function sendManagerMessage(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const body = await readBody(c);
  const toRaw = String(body.to ?? body.toUser ?? "").trim();
  const text = typeof body.body === "string" ? body.body : String(body.body ?? "");
  const trimmed = text.trim();
  const usernames = world.listUsers().map((u) => u.username);

  const fail = (error: string) => {
    if (wantsJson(c) || negotiateFormat(c) === "text") {
      return apiError(c, 400, error);
    }
    const back = sceneBackLink(user!, world);
    return page(
      c,
      400,
      msgPageView({
        usernames,
        selected: toRaw,
        body: text,
        error,
        back,
        peerMessagingEnabled: world.isPeerMessagingEnabled(),
      }),
    );
  };

  if (!toRaw) return fail("Choose a recipient.");
  if (!trimmed) return fail("Message is required.");

  const all = toRaw === "*" || /^all(?:\s+users)?$/i.test(toRaw);
  let recipients: string[];
  if (all) {
    if (!usernames.length) return fail("No users to message.");
    recipients = usernames;
  } else if (!world.getUser(toRaw)) {
    return fail(`User not found: ${toRaw}`);
  } else {
    recipients = [toRaw];
  }

  const subject = `Manager message from ${user!.username}`;
  const sentTo: string[] = [];
  const messages: InboxMessage[] = [];
  try {
    for (const toUser of recipients) {
      const message = await world.createInboxMessage({
        type: "notice",
        toUser,
        fromUser: user!.username,
        subject,
        body: trimmed,
      });
      messages.push(message);
      sentTo.push(toUser);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Could not send message";
    const partial = sentTo.length
      ? ` Sent to ${sentTo.length} of ${recipients.length} before failing.`
      : "";
    return fail(`${detail}.${partial}`);
  }

  if (wantsJson(c)) {
    return c.json({ ok: true, to: sentTo, count: sentTo.length, messages }, 201);
  }
  const summary = msgDeliveredSummary(all, sentTo);
  if (negotiateFormat(c) === "text") {
    return c.text(renderMessageText("Msg", summary), 201);
  }
  const qs = all
    ? `sent=all&n=${sentTo.length}`
    : `sent=${encodeURIComponent(sentTo[0]!)}`;
  return c.redirect(`${c.get("assetBase")}/msg?${qs}`);
}

function msgSentNotice(sent?: string, nRaw?: string): string | undefined {
  if (!sent) return undefined;
  if (sent === "all") {
    const n = Number(nRaw);
    const count = Number.isFinite(n) && n > 0 ? n : 0;
    return `Message sent to all ${count} ${count === 1 ? "user" : "users"}.`;
  }
  return `Message sent to ${sent}.`;
}

function msgPeerNotice(peer?: string): string | undefined {
  if (peer === "on") return "Peer messaging enabled.";
  if (peer === "off") return "Peer messaging disabled.";
  return undefined;
}

function msgPurgeNotice(purged?: string, from?: string, nRaw?: string): string | undefined {
  if (!purged) return undefined;
  const n = Number(nRaw);
  const count = Number.isFinite(n) && n >= 0 ? n : 0;
  const who = from?.trim() || "user";
  return `Deleted ${count} ${count === 1 ? "message" : "messages"} from ${who}.`;
}

function msgDeliveredSummary(all: boolean, sentTo: string[]): string {
  if (all) {
    const n = sentTo.length;
    return `Message sent to all ${n} ${n === 1 ? "user" : "users"}.`;
  }
  return `Message sent to ${sentTo[0]}.`;
}

worldRoutes.get("/staff", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  if (wantsJson(c)) return c.json(world.staff);
  const staffText = JSON.stringify(world.staff.roles, null, 2);
  const rows = Object.entries(world.staff.roles)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([username, roles]) =>
        `<li><strong>${userLinkHtml(username)}</strong> — ${escapeHtml(roles.join(", ") || "(none)")}</li>`,
    )
    .join("");
  const back = user ? sceneBackLink(user, world) : undefined;
  return page(
    c,
    200,
    "Staff",
    renderStaffBodyHtml({ rowsHtml: rows, back }),
    renderMessageText("Staff", staffText),
  );
});

worldRoutes.put("/staff/:username", async (c) => setStaff(c));
worldRoutes.post("/staff/:username", async (c) => setStaff(c));

async function setStaff(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const username = String(c.req.param("username") ?? "");
  const body = await readBody(c);
  let roles: StaffRole[] = [];
  if (Array.isArray(body.roles)) {
    roles = body.roles.map(String) as StaffRole[];
  } else if (typeof body.roles === "string") {
    roles = body.roles.split(",").map((s) => s.trim()).filter(Boolean) as StaffRole[];
  } else if (typeof body.rolesJson === "string") {
    try {
      roles = JSON.parse(prepareJsonTextarea(body.rolesJson)) as StaffRole[];
    } catch {
      return apiError(c, 400, "Invalid rolesJson");
    }
  }
  try {
    const staff = await world.setStaffRoles(username, roles);
    if (wantsJson(c)) return c.json({ username, roles: staff.roles[username] ?? [] });
    return c.redirect(`${c.get("assetBase")}/staff`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not set roles");
  }
}

worldRoutes.get("/s/:id/history", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canRead(user, scene, world)) {
    return apiError(c, user ? 403 : 401, "Not allowed to read this scene");
  }
  const log = await world.listEditLog("scenes", id);
  const assetBase = c.get("assetBase");
  if (wantsJson(c)) return c.json({ edits: log });
  return page(
    c,
    200,
    `History · Scene ${id}`,
    renderEditHistoryBodyHtml({ kind: "scene", id, log }),
    renderEditHistoryText({ kind: "scene", id, log, basePath: assetBase }),
    {
      kind: "scene",
      scene,
      canManage: canManage(user, scene, world),
      isManager: isManager(user, world),
    },
  );
});

worldRoutes.get("/s/:id/history/:version", async (c) => {
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
    `Snapshot ${versionId}`,
    renderSnapshotBodyHtml({
      kind: "scene",
      id,
      versionId,
      body: snap.body,
      title: snap.title,
      canRestore: manage,
    }),
    renderSnapshotText({
      kind: "scene",
      id,
      versionId,
      body: snap.body,
      title: snap.title,
    }),
  );
});

worldRoutes.post("/s/:id/history/:version/restore", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  const id = Number(c.req.param("id"));
  const versionId = String(c.req.param("version") ?? "");
  const scene = world.getScene(id);
  if (!scene) return apiError(c, 404, "Scene not found");
  if (!canManage(user, scene, world)) return apiError(c, 403, "Manage rights required to restore");
  try {
    const updated = await world.restoreSceneSnapshot(id, versionId, user.username);
    if (wantsJson(c)) return c.json(updated);
    return c.redirect(`${c.get("assetBase")}/s/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Restore failed");
  }
});

worldRoutes.get("/a/:id/history", async (c) => {
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
  const assetBase = c.get("assetBase");
  if (wantsJson(c)) return c.json({ edits: log });
  return page(
    c,
    200,
    `History · Artefact ${id}`,
    renderEditHistoryBodyHtml({ kind: "artefact", id, log }),
    renderEditHistoryText({ kind: "artefact", id, log, basePath: assetBase }),
  );
});

worldRoutes.get("/a/:id/history/:version", async (c) => {
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
    `Snapshot ${versionId}`,
    renderSnapshotBodyHtml({
      kind: "artefact",
      id,
      versionId,
      body: snap.body,
      canRestore,
    }),
    renderSnapshotText({ kind: "artefact", id, versionId, body: snap.body }),
  );
});

worldRoutes.post("/a/:id/history/:version/restore", async (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
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
    if (wantsJson(c)) return c.json(updated);
    return c.redirect(`${c.get("assetBase")}/a/${id}`);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Restore failed");
  }
});

function isTruthy(value: unknown): boolean {
  return value === true || value === "true" || value === "on" || value === "1";
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await c.req.json()) as Record<string, unknown>;
  }
  const form = await c.req.parseBody({ all: true });
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (Array.isArray(v)) {
      const strings = v.filter((item): item is string => typeof item === "string");
      // Multi-select fields keep every value; hidden+checkbox pairs keep the last.
      if (k === "exitId" || k === "exitIds" || k === "exit") {
        out[k] = strings.length <= 1 ? (strings[0] ?? "") : strings;
      } else {
        out[k] = strings.at(-1) ?? String(v.at(-1));
      }
    } else {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

function sceneGroupSummary(
  world: { getGroup(id: string): { id: string; title: string } | undefined },
  groupId: string | null | undefined,
): { id: string; title: string } | undefined {
  if (!groupId) return undefined;
  const group = world.getGroup(groupId);
  return group ? { id: group.id, title: group.title } : { id: groupId, title: `Group ${groupId}` };
}

/** Omitted keepAccess defaults on; form uses hidden 0 + checkbox 1. */
function parseKeepAccess(body: Record<string, unknown>): boolean {
  if (body.keepAccess === undefined || body.keepAccess === null || body.keepAccess === "") {
    return true;
  }
  if (body.keepAccess === false || body.keepAccess === 0) return false;
  const s = String(body.keepAccess).toLowerCase();
  return s !== "0" && s !== "false" && s !== "off" && s !== "no";
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(prepareJsonTextarea(trimmed));
    } catch {
      throw new Error("Details must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Details must be a JSON object");
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = String(v);
    }
    return out;
  }
  return {};
}
