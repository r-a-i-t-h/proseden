import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { isManager } from "../access/permissions.js";
import { apiError, page, wantsJson } from "../http.js";
import { negotiateFormat } from "../render/format.js";
import { renderViewLockdownBodyHtml, renderViewLockdownText } from "../render/html.js";
import { pathWithinApp } from "./rate-limit.js";

/** POST/PUT/DELETE allowed for non-managers when site editing is locked. */
const EDITING_EXEMPT = new Set([
  "/auth/login",
  "/auth/logout",
  "/live/say",
  "/live/shout",
  "/live/ping",
  "/live/purge",
  "/live/admin/kick",
  "/live/admin/purge",
  "/inbox/send",
  "/alchemy/combine",
]);

const EDITING_EXEMPT_PATTERNS = [
  /^\/inbox\/\d+\/(confirm|delete)$/,
  /^\/a\/\d+\/(use|collect|collect\/drop)$/,
  /^\/s\/\d+\/input$/,
];

/** Managers-only crisis controls — always reachable while view is locked. */
const VIEW_EXEMPT = new Set([
  "/health",
  "/auth/login",
  "/auth/logout",
]);

function viewLockdownExempt(method: string, path: string): boolean {
  if (method === "GET" && path.startsWith("/assets/")) return true;
  if (VIEW_EXEMPT.has(path) && (method === "GET" || method === "POST")) return true;
  return false;
}

function editingExempt(path: string): boolean {
  if (EDITING_EXEMPT.has(path)) return true;
  return EDITING_EXEMPT_PATTERNS.some((re) => re.test(path));
}

/** Manager-only settings toggles from Live admin. */
function isSecurityTogglePath(path: string): boolean {
  return path.startsWith("/live/admin/") && path !== "/live/admin/kick" && path !== "/live/admin/purge";
}

export const crisisLockdown = createMiddleware(async (c, next) => {
  const world = c.get("world");
  const user = c.get("user");
  if (isManager(user, world)) {
    await next();
    return;
  }

  const path = pathWithinApp(c);
  const method = c.req.method;

  if (!world.isNonManagerViewEnabled()) {
    if (!viewLockdownExempt(method, path)) {
      return viewLockdownResponse(c);
    }
  }

  if (
    !world.isNonManagerEditingEnabled() &&
    (method === "POST" || method === "PUT" || method === "DELETE") &&
    !editingExempt(path) &&
    !isSecurityTogglePath(path)
  ) {
    return apiError(c, user ? 403 : 401, "Editing is temporarily disabled.");
  }

  await next();
});

function viewLockdownResponse(c: Context) {
  if (wantsJson(c)) {
    return c.json({ error: "The site is temporarily closed to readers." }, 403);
  }
  if (negotiateFormat(c) === "text") {
    return c.text(renderViewLockdownText(), 403);
  }
  return page(
    c,
    403,
    "Closed",
    renderViewLockdownBodyHtml(),
    renderViewLockdownText(),
    undefined,
    { isManager: false },
  );
}
