import type { Context } from "hono";
import { canRead, isManager } from "./access/permissions.js";
import { negotiateFormat } from "./render/format.js";
import {
  editModeHrefs,
  renderHtmlPage,
  renderMessageBodyHtml,
  type OwnedSceneLink,
  type PageBackLink,
} from "./render/html.js";
import { renderMessageText } from "./render/text.js";
import type { UserRecord } from "./model/types.js";
import type { WorldStore } from "./store/world.js";

export function wantsJson(c: Context): boolean {
  const accept = c.req.header("accept") ?? "";
  return accept.includes("application/json") || c.req.query("format") === "json";
}

export function ownedSceneLinks(
  world: WorldStore,
  user: UserRecord | undefined,
): OwnedSceneLink[] {
  if (!user) return [];
  return world.listScenesOwnedBy(user.username).map((s) => ({
    id: s.id,
    title: s.title,
  }));
}

export function ownedSceneLinksFor(c: Context): OwnedSceneLink[] {
  return ownedSceneLinks(c.get("world"), c.get("user"));
}

/** Last readable scene for Live mode when not already on a scene/artefact page. */
export function liveSceneIdForUser(
  user: UserRecord | undefined,
  world: WorldStore,
): number | undefined {
  if (user?.lastSceneId === undefined) return undefined;
  const last = world.getScene(user.lastSceneId);
  if (last && canRead(user, last, world)) return last.id;
  return undefined;
}

/** Crumb back to the Live-bound scene, or history.back when none is readable. */
export function sceneBackLink(user: UserRecord, world: WorldStore): PageBackLink {
  const id = liveSceneIdForUser(user, world);
  if (id !== undefined) {
    return { href: `s/${id}`, label: `← Scene ${id}` };
  }
  return { href: "./", label: "← Back", history: true };
}

export function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404,
  message: string,
  opts?: { isManager?: boolean },
) {
  if (wantsJson(c) || negotiateFormat(c) === "text") {
    if (wantsJson(c)) return c.json({ error: message }, status);
    return c.text(renderMessageText("Error", message), status);
  }
  const user = c.get("user");
  const world = c.get("world");
  return c.html(
    renderHtmlPage({
      title: "Error",
      bodyHtml: renderMessageBodyHtml("Error", message),
      user,
      assetBase: c.get("assetBase"),
      ownedScenes: ownedSceneLinks(world, user),
      isManager: opts?.isManager ?? isManager(user, world),
      ...editModeHrefs(c.req.url, c.get("assetBase")),
    }),
    status,
  );
}
