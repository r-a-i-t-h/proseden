import type { Context, Handler, Hono } from "hono";
import { canRead, isManager, isModerator, isQuestor } from "./access/permissions.js";
import { negotiateFormat } from "./render/format.js";
import { editModeHrefs, renderHtmlPage } from "./render/html.js";
import type { ManageContext, OwnedSceneLink } from "./render/bootstrap.js";
import type { PageBackLink } from "./render/view/index.js";
import { isPageView, messagePageView, toHtml, toText, type PageView } from "./render/view/index.js";
import type { UserRecord } from "./model/types.js";
import { timed } from "./observe.js";
import type { WorldStore } from "./store/world.js";

export { readRequestBody, parseEnabledFlag, isTruthy, optionalString } from "./http/body.js";
export type { ManageContext, OwnedSceneLink, EditBootstrap } from "./render/bootstrap.js";

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
 */
export function page(
  c: Context,
  status: number,
  view: PageView,
  manage?: ManageContext,
  shell?: PageShellOverrides,
): Response {
  if (!isPageView(view)) {
    throw new Error("page() expects a PageView");
  }
  return pageFromView(c, status, view, manage, shell);
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
  // Scene pages bind Live to that scene. Artefact/inventory/etc. keep the
  // viewer's last readable scene; fall back to artefact home only when none.
  let liveSceneId =
    manage?.kind === "scene" && manage.scene ? manage.scene.id : undefined;
  if (liveSceneId === undefined) {
    liveSceneId = liveSceneIdForUser(user, world);
  }
  if (liveSceneId === undefined && manage?.kind === "artefact" && manage.artefact) {
    liveSceneId = manage.artefact.homeSceneId;
  }
  const timer = c.get("timer");
  const ownedScenes = timed(timer, "ownedScenes", () => ownedSceneLinks(world, user));
  const inboxCount = user
    ? timed(timer, "inbox", () => world.inboxCountFor(user.username))
    : 0;
  const html = timed(timer, "render", () =>
    renderHtmlPage({
      title,
      bodyHtml,
      user,
      assetBase: c.get("assetBase"),
      manage,
      ownedScenes,
      isManager: shell?.isManager ?? isManager(user, world),
      isModerator: shell?.isModerator ?? isModerator(user, world),
      isQuestor: shell?.isQuestor ?? isQuestor(user, world),
      liveSceneId,
      inboxCount,
      guestLiveEnabled: world.isGuestLiveEnabled(),
      liveChatEnabled: world.isLiveChatEnabled(),
      registrationEnabled: world.isRegistrationEnabled(),
      nonManagerEditingEnabled: world.isNonManagerEditingEnabled(),
      ...hrefs,
    }),
  );
  return c.html(html, status as 200);
}

export function apiError(
  c: Context,
  status: 400 | 401 | 403 | 404 | 429,
  message: string,
  opts?: { isManager?: boolean; title?: string },
) {
  const title = opts?.title ?? "Error";
  if (wantsJson(c) || negotiateFormat(c) === "text") {
    if (wantsJson(c)) return c.json({ error: message }, status);
    return c.text(`[${title}]\n\n${message}\n`, status);
  }
  return page(c, status, messagePageView(title, message), undefined, {
    isManager: opts?.isManager,
  });
}

/** JSON entity for the edit panel; HTML forms redirect (optional query flash). */
export function respondMutation(
  c: Context,
  opts: {
    json: unknown;
    redirect: string;
    status?: 200 | 201;
    flash?: Record<string, string>;
  },
): Response {
  if (wantsJson(c)) {
    return c.json(opts.json, (opts.status ?? 200) as 200);
  }
  const path = opts.redirect.startsWith("/") ? opts.redirect : `/${opts.redirect}`;
  const qs = opts.flash
    ? `?${new URLSearchParams(opts.flash).toString()}`
    : "";
  return c.redirect(`${c.get("assetBase")}${path}${qs}`);
}

export function requireUser(c: Context): UserRecord | Response {
  const user = c.get("user");
  if (!user) return apiError(c, 401, "Authentication required");
  return user;
}

export function requireManager(c: Context): UserRecord | Response {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required", { isManager: false });
  }
  return user!;
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

/** Register PUT (or DELETE) plus a POST alias for HTML forms. */
export function aliasFormMethods(
  router: Hono,
  method: "put" | "delete",
  path: string,
  handler: Handler,
  postPath?: string,
): void {
  if (method === "put") {
    router.put(path, handler);
    router.post(path, handler);
    return;
  }
  router.delete(path, handler);
  router.post(postPath ?? `${path}/delete`, handler);
}
