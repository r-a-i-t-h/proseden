import type { Context } from "hono";
import { apiError, isResponse, liveSceneIdForUser } from "../http.js";
import { gateFactsFor } from "../logic/pred.js";
import type { GateFacts } from "../logic/pred.js";
import { sceneAllowed } from "../logic/world-view.js";
import type { FlagValue } from "../model/logic.js";
import type { SceneRecord, UserRecord } from "../model/types.js";
import { canRead, type AccessWorld } from "./permissions.js";
import { bypassesSceneFlagGate } from "./scene-gate.js";

export type SceneEntryOk = { ok: true; scene: SceneRecord; facts: GateFacts };
export type SceneEntryFail = { ok: false; response: Response };
export type SceneEntryResult = SceneEntryOk | SceneEntryFail;

export type SceneEntryEval =
  | { ok: true; scene: SceneRecord; facts: GateFacts }
  | {
      ok: false;
      status: 401 | 403 | 404;
      message: string;
      title?: string;
      redirectSceneId?: number;
    };

export interface SceneEntryWorld extends AccessWorld {
  resolveTeleportTarget(
    requestedSceneId: number,
    fromSceneId: number | undefined,
    opts?: { asOwnerUsername?: string; asJoin?: boolean },
  ): { sceneId: number; redirected: boolean };
  getUserFlags(username: string): Record<string, FlagValue>;
  getUserBadges(username: string): ReadonlyArray<{ badge: string }>;
  getUserVars?(username: string): Record<string, number>;
}

export function parseFromScene(c: Context): number | undefined {
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

/**
 * Resolve entrance-group teleport, then ACL + FlagRef gate (no HTTP).
 * GET /s/:id uses `teleport: "redirect"`; mutations use `"forbid"`.
 */
export function evaluateSceneEntry(
  world: SceneEntryWorld,
  user: UserRecord | undefined,
  sceneId: number,
  opts?: {
    fromHint?: number;
    teleport?: "redirect" | "forbid" | "ignore";
  },
): SceneEntryEval {
  const teleport = opts?.teleport ?? "ignore";
  const fromHint = opts?.fromHint;

  if (teleport !== "ignore") {
    const resolved = world.resolveTeleportTarget(sceneId, fromHint, {
      asOwnerUsername: user?.username,
    });
    if (resolved.redirected) {
      if (teleport === "forbid") {
        return {
          ok: false,
          status: 403,
          message: "Entrance to this area is not reachable.",
          title: "Forbidden",
        };
      }
      const entrance = world.getScene(resolved.sceneId);
      const readable = checkReadable(world, user, entrance, "Entrance to this area is not reachable.");
      if (!readable.ok) {
        return {
          ok: false,
          status: user ? 403 : 401,
          message: "Entrance to this area is not reachable.",
          title: "Forbidden",
        };
      }
      return {
        ok: false,
        status: 403,
        message: "Entrance to this area is not reachable.",
        title: "Forbidden",
        redirectSceneId: resolved.sceneId,
      };
    }
  }

  const scene = world.getScene(sceneId);
  if (!scene) {
    return {
      ok: false,
      status: 404,
      message: `No scene ${sceneId}.`,
      title: "Not found",
    };
  }
  return checkReadable(world, user, scene);
}

/**
 * HTTP wrapper around `evaluateSceneEntry`.
 * GET /s/:id uses `teleport: "redirect"`; mutations use `"forbid"`.
 */
export function assertSceneEntry(
  c: Context,
  sceneId: number,
  opts?: {
    fromHint?: number;
    teleport?: "redirect" | "forbid" | "ignore";
  },
): SceneEntryResult {
  const world = c.get("world");
  const user = c.get("user");
  const fromHint = opts?.fromHint ?? parseFromScene(c) ?? liveSceneIdForUser(user, world);
  const evaluated = evaluateSceneEntry(world, user, sceneId, {
    teleport: opts?.teleport,
    fromHint,
  });
  if (evaluated.ok) return evaluated;
  if (evaluated.redirectSceneId !== undefined) {
    return {
      ok: false,
      response: c.redirect(`${c.get("assetBase")}/s/${evaluated.redirectSceneId}`),
    };
  }
  return {
    ok: false,
    response: apiError(c, evaluated.status, evaluated.message, {
      title: evaluated.title,
    }),
  };
}

function checkReadable(
  world: SceneEntryWorld,
  user: UserRecord | undefined,
  scene: SceneRecord | undefined,
  unreachable = "",
): SceneEntryEval {
  if (!scene) {
    return {
      ok: false,
      status: user ? 403 : 401,
      message: unreachable || "Scene not found",
      title: "Forbidden",
    };
  }
  if (!canRead(user, scene, world)) {
    const msg = user
      ? "This scene is private and you do not have access."
      : "This scene is private. Authenticate and retry.";
    return {
      ok: false,
      status: user ? 403 : 401,
      message: msg,
      title: "Forbidden",
    };
  }
  const facts = gateFactsFor(world, user);
  if (!bypassesSceneFlagGate(user, scene, world) && !sceneAllowed(scene, facts)) {
    return {
      ok: false,
      status: user ? 403 : 401,
      message: scene.whenDenied?.trim() || "You cannot enter here yet.",
      title: "Forbidden",
    };
  }
  return { ok: true, scene, facts };
}

export function sceneEntryOrResponse(
  result: SceneEntryResult,
): SceneEntryOk | Response {
  return result.ok ? result : result.response;
}

export { isResponse };
