import type { Context } from "hono";
import { canRead, isManager, isModerator, isQuestor } from "./access/permissions.js";
import { negotiateFormat } from "./render/format.js";
import {
  editModeHrefs,
  renderHtmlPage,
  renderMessageBodyHtml,
  type ManageContext,
  type OwnedSceneLink,
  type PageBackLink,
} from "./render/html.js";
import { renderMessageText } from "./render/text.js";
import { isPageView, toHtml, toText, type PageView } from "./render/view/index.js";
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

export interface PageShellOverrides {
  isManager?: boolean;
  isModerator?: boolean;
  isQuestor?: boolean;
}

/**
 * Negotiate text vs HTML and wrap HTML in the shared site shell
 * (header, edit bootstrap, live scene binding, owned-scene list).
 *
 * Pass either a PageView (document model) or legacy htmlBody + textBody strings.
 */
export function page(
  c: Context,
  status: number,
  title: string,
  htmlBody: string,
  textBody: string,
  manage?: ManageContext,
  shell?: PageShellOverrides,
): Response;
export function page(
  c: Context,
  status: number,
  view: PageView,
  manage?: ManageContext,
  shell?: PageShellOverrides,
): Response;
export function page(
  c: Context,
  status: number,
  titleOrView: string | PageView,
  htmlBodyOrManage?: string | ManageContext,
  textBodyOrShell?: string | PageShellOverrides,
  manage?: ManageContext,
  shell?: PageShellOverrides,
) {
  if (isPageView(titleOrView)) {
    return pageFromView(
      c,
      status,
      titleOrView,
      htmlBodyOrManage as ManageContext | undefined,
      textBodyOrShell as PageShellOverrides | undefined,
    );
  }

  const title = titleOrView;
  const htmlBody = htmlBodyOrManage as string;
  const textBody = textBodyOrShell as string;
  const format = negotiateFormat(c);
  if (format === "text") {
    return c.text(textBody, status as 200);
  }
  return htmlPageResponse(c, status, title, htmlBody, manage, shell);
}

function pageFromView(
  c: Context,
  status: number,
  view: PageView,
  manage?: ManageContext,
  shell?: PageShellOverrides,
) {
  const format = negotiateFormat(c);
  const basePath = c.get("assetBase") ?? "";
  if (format === "text") {
    return c.text(toText(view.body, { basePath }), status as 200);
  }
  return htmlPageResponse(c, status, view.title, toHtml(view.body), manage, shell);
}

function htmlPageResponse(
  c: Context,
  status: number,
  title: string,
  bodyHtml: string,
  manage?: ManageContext,
  shell?: PageShellOverrides,
) {
  const user = c.get("user");
  const world = c.get("world");
  const hrefs = editModeHrefs(c.req.url, c.get("assetBase"));
  let liveSceneId =
    manage?.kind === "scene" && manage.scene
      ? manage.scene.id
      : manage?.kind === "artefact" && manage.artefact
        ? manage.artefact.homeSceneId
        : undefined;
  if (liveSceneId === undefined) {
    liveSceneId = liveSceneIdForUser(user, world);
  }
  return c.html(
    renderHtmlPage({
      title,
      bodyHtml,
      user,
      assetBase: c.get("assetBase"),
      manage,
      ownedScenes: ownedSceneLinks(world, user),
      isManager: shell?.isManager ?? isManager(user, world),
      isModerator: shell?.isModerator ?? isModerator(user, world),
      isQuestor: shell?.isQuestor ?? isQuestor(user, world),
      liveSceneId,
      inboxCount: user ? world.inboxCountFor(user.username) : 0,
      ...hrefs,
    }),
    status as 200,
  );
}

export function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 429,
  message: string,
  opts?: { isManager?: boolean },
) {
  if (wantsJson(c) || negotiateFormat(c) === "text") {
    if (wantsJson(c)) return c.json({ error: message }, status);
    return c.text(renderMessageText("Error", message), status);
  }
  return page(
    c,
    status,
    "Error",
    renderMessageBodyHtml("Error", message),
    renderMessageText("Error", message),
    undefined,
    { isManager: opts?.isManager },
  );
}
