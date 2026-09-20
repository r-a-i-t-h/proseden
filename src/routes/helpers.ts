import type { Context } from "hono";
import { formatAccessSummary, parseAccessPayload } from "../access/acl.js";
import { isManager, type AccessWorld } from "../access/permissions.js";
import {
  apiError,
  isResponse,
  readRequestBody,
  respondMutation,
  requireUser,
} from "../http.js";
import { prepareJsonTextarea } from "../json-textarea.js";
import { isTruthy, optionalString } from "../http/body.js";
import { parseOptionalFlagRef } from "../logic/pred.js";
import { questActionMessage } from "../logic/quests.js";
import { requestSessionToken } from "../middleware/auth.js";
import type { UserRecord } from "../model/types.js";
import { wantsJson } from "../http.js";

export { optionalString, isTruthy };

export const PEER_MESSAGE_MAX = 2000;
export const EXIT_REQUEST_NOTE_MAX = 500;

export function sceneLabel(scene: { id: number; title?: string }): string {
  const title = scene.title?.trim();
  return title ? `${title} (${scene.id})` : `Scene ${scene.id}`;
}

export function sceneTitle(scene: { id: number; title?: string }): string {
  const title = scene.title?.trim();
  return title || `scene ${scene.id}`;
}

export function sceneGroupSummary(
  world: { getGroup(id: string): { id: string; title: string } | undefined },
  groupId: string | null | undefined,
): { id: string; title: string } | undefined {
  if (!groupId) return undefined;
  const group = world.getGroup(groupId);
  return group ? { id: group.id, title: group.title } : { id: groupId, title: `Group ${groupId}` };
}

export function canManageUserAccess(
  user: UserRecord | undefined,
  username: string,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (user.username === username) return true;
  return isManager(user, world);
}

export function parseExitGates(body: Record<string, unknown>): {
  when?: string;
  whenDenied?: string;
  hidden?: boolean;
} {
  const gates: { when?: string; whenDenied?: string; hidden?: boolean } = {};
  const ref = parseOptionalFlagRef(body.when ?? body.flag);
  if (ref) gates.when = ref;
  const denied = body.whenDenied !== undefined ? String(body.whenDenied).trim() : "";
  if (denied) gates.whenDenied = denied;
  if (isTruthy(body.hidden)) gates.hidden = true;
  return gates;
}

/** Omitted keepAccess defaults on; form uses hidden 0 + checkbox 1. */
export function parseKeepAccess(body: Record<string, unknown>): boolean {
  if (body.keepAccess === undefined || body.keepAccess === null || body.keepAccess === "") {
    return true;
  }
  if (body.keepAccess === false || body.keepAccess === 0) return false;
  const s = String(body.keepAccess).toLowerCase();
  return s !== "0" && s !== "false" && s !== "off" && s !== "no";
}

export function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseDetails(value: unknown): Record<string, string> {
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

export function collectExitKeys(body: Record<string, unknown>): string[] {
  const raw = body.exitId ?? body.exitIds ?? body.exit ?? body.ids;
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/);
  return list.map(String).map((s) => s.trim()).filter(Boolean);
}

export function questActionReply(
  c: Context,
  path: string,
  outcome: { actionMatched: boolean; actionOk?: string },
) {
  const message = questActionMessage(outcome);
  if (wantsJson(c)) return c.json({ ok: outcome.actionMatched, message });
  c.get("sessions").setActionMessage(requestSessionToken(c), message);
  return c.redirect(`${c.get("assetBase")}${path}`);
}

export function alchemyFail(c: Context, message: string) {
  if (wantsJson(c)) return apiError(c, 400, message);
  return c.redirect(
    `${c.get("assetBase")}/inv?alchemy-error=${encodeURIComponent(message)}`,
  );
}

export async function updateAccess(
  c: Context,
  opts: {
    persist: (patch: { grants?: import("../model/types.js").Grant[]; denies?: import("../model/types.js").Deny[] }) => Promise<{
      grants?: import("../model/types.js").Grant[];
      denies?: import("../model/types.js").Deny[];
    }>;
    redirect: string;
    flash?: Record<string, string>;
  },
) {
  const user = requireUser(c);
  if (isResponse(user)) return user;
  const body = await readRequestBody(c);
  try {
    const patch = parseAccessPayload(body);
    if (patch.grants === undefined && patch.denies === undefined) {
      return apiError(c, 400, "grants and/or denies required");
    }
    const updated = await opts.persist(patch);
    return respondMutation(c, {
      json: { grants: updated.grants, denies: updated.denies },
      redirect: opts.redirect,
      flash: opts.flash,
    });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid access payload");
  }
}

export { formatAccessSummary };
