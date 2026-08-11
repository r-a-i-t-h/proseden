import type { Context } from "hono";
import { isManager } from "./access/permissions.js";
import { negotiateFormat } from "./render/format.js";
import {
  renderHtmlPage,
  renderMessageBodyHtml,
  type OwnedSceneLink,
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
    }),
    status,
  );
}
