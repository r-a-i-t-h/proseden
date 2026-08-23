import { Hono } from "hono";
import type { Context } from "hono";
import { formatAccessSummary } from "../access/acl.js";
import { triggerQuestEval } from "../logic/trigger.js";
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
import { queryDetailName } from "../render/format.js";
import {
  formatPlainMessage,
  messagePageView,
  profilePageView,
  userProfilePageView,
} from "../render/view/index.js";
import { canManageUserAccess, parseDetails, updateAccess } from "./helpers.js";

export const profileRoutes = new Hono();

profileRoutes.get("/profile", (c) => {
  const user = c.get("user");
  if (!user) {
    return page(c, 401, messagePageView("Profile", "Log in to view your profile."));
  }

  const message = c.req.query("updated")
    ? "Password updated."
    : c.req.query("shared")
      ? "Share-all saved."
      : c.req.query("appearance")
        ? "Appearance saved."
        : c.req.query("badge-dropped")
          ? "Badge removed."
          : undefined;
  const openSection = c.req.query("updated")
    ? "password"
    : c.req.query("shared")
      ? "sharing"
      : "appearance";
  const world = c.get("world");
  const back = sceneBackLink(user, world);
  const badges = world.getUserBadges(user.username).map((b) => ({
    id: b.badge,
    title: world.badgeTitle(b.badge),
    grantTime: b.grantTime,
  }));
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
      badges,
    }),
  );
});

profileRoutes.post("/profile/badges/:id/drop", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const badgeId = decodeURIComponent(c.req.param("id"));
  const next = world.getUserBadges(user.username).filter((b) => b.badge !== badgeId);
  await world.saveUserBadges(user.username, next);
  await triggerQuestEval(c, user, user.lastSceneId);
  return respondMutation(c, { json: { ok: true, badges: next }, redirect: `/profile?badge-dropped=1` });
});

aliasFormMethods(profileRoutes, "put", "/profile", (c) => updateProfileAppearance(c));

async function updateProfileAppearance(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const body = await readRequestBody(c);
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

  return respondMutation(c, {
    json: { description: updated.description, details: updated.details },
    redirect: "/profile",
    flash: { appearance: "1" },
  });
}

profileRoutes.get("/u/:username", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const username = String(c.req.param("username") ?? "");
  const target = world.getUser(username);
  if (!target) return apiError(c, 404, "User not found");

  const description = target.description ?? "";
  const details = target.details ?? {};
  const detail = queryDetailName(c);
  const scenesOwned = world.scenesOwned(target.username);
  const ownedArtefacts = world.listArtefactsOwnedBy(target.username).length;
  const lastSeenAt = target.lastSeenAt;
  const badges = world.getUserBadges(target.username).map((b) => ({
    id: b.badge,
    title: world.badgeTitle(b.badge),
    grantTime: b.grantTime ?? null,
  }));
  const payload = {
    username: target.username,
    description,
    details,
    cache: { scenesOwned },
    ownedArtefacts,
    badges,
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
    userProfilePageView({
      username: target.username,
      description,
      details,
      detail,
      ownedScenes: scenesOwned,
      ownedArtefacts,
      lastSeenAt,
      badges,
      back,
    }),
  );
});

profileRoutes.get("/u/:username/access", (c) => {
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
    formatPlainMessage(
      `User ${username} access (share-all)`,
      formatAccessSummary(payload.grants, payload.denies),
    ),
  );
});

aliasFormMethods(profileRoutes, "put", "/u/:username/access", (c) => updateUserAccess(c));

async function updateUserAccess(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const username = String(c.req.param("username") ?? "");
  if (!canManageUserAccess(user, username, world)) {
    return apiError(c, 403, "Not allowed to edit this user's access");
  }
  return updateAccess(c, {
    persist: (patch) => world.updateUserAccess(username, patch),
    redirect: username === user.username ? "/profile" : "/",
    flash: username === user.username ? { shared: "1" } : undefined,
  });
}


