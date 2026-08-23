import { Hono } from "hono";
import type { Context } from "hono";
import {
  canDeleteArtefact,
  canEditArtefact,
  canEjectArtefact,
  canPlaceArtefact,
  canReadArtefact,
  isManager,
} from "../access/permissions.js";
import { assertSceneEntry } from "../access/scene-entry.js";
import { bypassesSceneFlagGate } from "../access/scene-gate.js";
import {
  aliasFormMethods,
  apiError,
  isResponse,
  page,
  readRequestBody,
  requireUser,
  respondMutation,
  sceneBackLink,
} from "../http.js";
import { triggerQuestEval } from "../logic/trigger.js";
import { artefactVisible, resolveArtefactDetails, sceneAllowed } from "../logic/world-view.js";
import { gateFactsFor, parseDetailWhenMap, parseOptionalFlagRef } from "../logic/pred.js";
import { requestSessionToken } from "../middleware/auth.js";
import { queryDetailName } from "../render/format.js";
import { artefactPageView, messagePageView } from "../render/view/index.js";
import { isTruthy, optionalString, parseDetails, parseTags, questActionReply } from "./helpers.js";

export const artefactRoutes = new Hono();

artefactRoutes.get("/a/:id", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) {
    return page(c, 404, messagePageView("Not found", `No artefact ${id}.`));
  }
  const home = world.getScene(artefact.homeSceneId);
  if (!home) {
    return page(
      c,
      user ? 403 : 401,
      messagePageView("Forbidden", "This artefact is not for your eyes."),
    );
  }
  const collected = !!user?.inventory.some((i) => i.artefactId === id);
  const facts = gateFactsFor(world, user);
  // Holding is a reader credential for this page only — not home-scene read,
  // world collect, or history. Skip ACL / scene when / artefact when when held.
  if (!collected) {
    if (!canReadArtefact(user, artefact, home, world)) {
      return page(
        c,
        user ? 403 : 401,
        messagePageView("Forbidden", "This artefact is not for your eyes."),
      );
    }
    if (!bypassesSceneFlagGate(user, home, world) && !sceneAllowed(home, facts)) {
      const msg = home.whenDenied?.trim() || "You cannot enter here yet.";
      return page(c, user ? 403 : 401, messagePageView("Forbidden", msg));
    }
    if (!artefactVisible(artefact, facts)) {
      return page(c, 404, messagePageView("Not found", `No artefact ${id}.`));
    }
  }

  const detail = queryDetailName(c);
  const readerArtefact = {
    ...artefact,
    details: resolveArtefactDetails(artefact, facts),
  };

  // Like inventory/profile: do not move Live; crumb back to the current scene.
  const back = user
    ? sceneBackLink(user, world)
    : {
        href: `s/${artefact.homeSceneId}?from=${artefact.homeSceneId}`,
        label: `← Scene ${artefact.homeSceneId}`,
      };

  return page(
    c,
    200,
    artefactPageView({
      artefact: readerArtefact,
      detail,
      collected: user ? collected : undefined,
      back,
      notice: c.get("sessions").takeActionMessage(requestSessionToken(c)),
    }),
    {
      kind: "artefact",
      artefact,
      canEdit: canEditArtefact(user, artefact, home, world),
      canDelete: canDeleteArtefact(user, artefact, home, world),
      canEject: canEjectArtefact(user, artefact, home, world),
      isManager: isManager(user, world),
      collected,
    },
  );
});

artefactRoutes.post("/a", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const body = await readRequestBody(c);
  const homeSceneId = Number(body.homeSceneId);
  const text = String(body.body ?? "");
  if (!Number.isFinite(homeSceneId)) return apiError(c, 400, "homeSceneId is required");
  if (!text.trim()) return apiError(c, 400, "Body is required");

  const home = world.getScene(homeSceneId);
  if (!home) return apiError(c, 404, "Home scene not found");
  if (!canPlaceArtefact(user, home, world)) {
    return apiError(c, 403, "Not allowed to place artefacts here");
  }

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

  return respondMutation(c, { json: artefact, redirect: `/a/${artefact.id}`, status: 201 });
});

aliasFormMethods(artefactRoutes, "put", "/a/:id", (c) => updateArtefact(c));

async function updateArtefact(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getScene(artefact.homeSceneId);
  if (!home || !canEditArtefact(user, artefact, home, world)) {
    return apiError(c, 403, "Not allowed to edit this artefact");
  }

  const body = await readRequestBody(c);
  try {
    if (body.homeSceneId !== undefined) {
      const destId = Number(body.homeSceneId);
      const dest = world.getScene(destId);
      if (!dest) return apiError(c, 404, "Home scene not found");
      if (destId !== artefact.homeSceneId && !canPlaceArtefact(user, dest, world)) {
        return apiError(c, 403, "Not allowed to place artefacts there");
      }
    }
    let details: Record<string, string> | undefined;
    if (body.detailsJson !== undefined || body.details !== undefined) {
      details = parseDetails(body.detailsJson ?? body.details);
    }
    const clearGates: Array<"when" | "detailWhen"> = [];
    const gatePatch: { when?: string; detailWhen?: Record<string, string> } = {};
    if (body.when !== undefined || body.flag !== undefined) {
      const ref = parseOptionalFlagRef(body.when ?? body.flag);
      if (ref) gatePatch.when = ref;
      else clearGates.push("when");
    }
    if (body.detailWhenJson !== undefined || body.detailWhen !== undefined) {
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
    }
    const updated = await world.updateArtefact(
      id,
      {
        title: body.title !== undefined ? optionalString(body.title) : artefact.title,
        body: body.body !== undefined ? String(body.body) : artefact.body,
        details,
        tags: body.tags !== undefined ? parseTags(body.tags) : undefined,
        homeSceneId: body.homeSceneId !== undefined ? Number(body.homeSceneId) : undefined,
        ...gatePatch,
      },
      {
        by: user.username,
        retainSnapshot: isTruthy(body.retainSnapshot) || isTruthy(body.keepVersion),
        clearGates: clearGates.length ? clearGates : undefined,
      },
    );
    return respondMutation(c, { json: updated, redirect: `/a/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Update failed");
  }
}

artefactRoutes.post("/a/:id/collect", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const entered = assertSceneEntry(c, artefact.homeSceneId, { teleport: "forbid" });
  if (!entered.ok) return entered.response;
  const { scene: home, facts } = entered;
  if (!canReadArtefact(user, artefact, home, world)) {
    return apiError(c, 403, "Cannot collect a prohibited artefact");
  }
  if (!artefactVisible(artefact, facts)) {
    return apiError(c, 403, "That artefact is not available to collect.");
  }

  const updated = await world.collectArtefact(user.username, id);
  c.set("user", updated);
  await triggerQuestEval(c, updated, home.id, {
    wake: "gain",
    wakeGained: [id],
  });
  return respondMutation(c, { json: { ok: true, inventory: c.get("user")!.inventory }, redirect: `/a/${id}` });
});

aliasFormMethods(artefactRoutes, "delete", "/a/:id/collect", (c) => dropCollect(c), "/a/:id/collect/drop");

artefactRoutes.post("/a/:id/use", async (c) => {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  if (!user.inventory.some((i) => i.artefactId === id)) {
    return apiError(c, 403, "You are not holding that artefact.");
  }
  const outcome = await triggerQuestEval(c, user, user.lastSceneId, {
    wake: "use",
    useArtefactId: id,
  });
  return questActionReply(c, `/a/${id}`, outcome);
});

async function dropCollect(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const updated = await world.dropArtefact(user.username, id);
  c.set("user", updated);
  await triggerQuestEval(c, updated, updated.lastSceneId, {
    wake: "drop",
    wakeDropped: [id],
  });
  return respondMutation(c, { json: { ok: true, inventory: c.get("user")!.inventory }, redirect: `/a/${id}` });
}

aliasFormMethods(artefactRoutes, "delete", "/a/:id", (c) => deleteArtefact(c));

artefactRoutes.post("/a/:id/eject", async (c) => ejectArtefact(c));

async function ejectArtefact(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getScene(artefact.homeSceneId);
  if (!home || !canEjectArtefact(user, artefact, home, world)) {
    return apiError(c, 403, "Not allowed to eject this artefact");
  }
  try {
    const updated = await world.ejectArtefact(id, user.username);
    return respondMutation(c, { json: updated, redirect: `/a/${id}` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not eject artefact");
  }
}

async function deleteArtefact(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const id = Number(c.req.param("id"));
  const artefact = world.getArtefact(id);
  if (!artefact) return apiError(c, 404, "Artefact not found");
  const home = world.getScene(artefact.homeSceneId);
  if (!canDeleteArtefact(user, artefact, home, world)) {
    return apiError(c, 403, "Not allowed to delete this artefact");
  }
  await world.deleteArtefact(id, { by: user.username, notify: true });
  return respondMutation(c, { json: { ok: true }, redirect: `/` });
}
