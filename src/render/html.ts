import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UserRecord } from "../model/types.js";
import { escapeAttr } from "./escape.js";
import { userPath } from "./entity.js";
import { escapeHtml } from "./prose.js";
import type { EditBootstrap, ManageContext, OwnedSceneLink } from "./bootstrap.js";

export type { EditBootstrap, ManageContext, OwnedSceneLink } from "./bootstrap.js";

export interface HtmlShellOptions {
  title: string;
  bodyHtml: string;
  user?: UserRecord;
  assetBase?: string;
  manage?: ManageContext;
  /** Scenes owned by the signed-in user (sidebar jump list). */
  ownedScenes?: OwnedSceneLink[];
  /** Staff manager — shows /msg, /data and /staff links in the sidebar. */
  isManager?: boolean;
  /** Moderator or manager — live admin / purge. */
  isModerator?: boolean;
  /** Questor or manager — personal quests editor. */
  isQuestor?: boolean;
  /** Scene id for live SSE when viewing a scene page. */
  liveSceneId?: number;
  /** Relative href that adds `?edit` (signed-in Edit control). */
  editHref?: string;
  /** Relative href with `?edit` removed (View). */
  readHref?: string;
  /** Total inbox messages for the signed-in user (header badge). */
  inboxCount?: number;
  /** From data/settings.json — guests may use Live. */
  guestLiveEnabled?: boolean;
  /** From data/settings.json — say and shout allowed. */
  liveChatEnabled?: boolean;
  /** From data/settings.json — new account registration. */
  registrationEnabled?: boolean;
  /** From data/settings.json — non-managers may edit. */
  nonManagerEditingEnabled?: boolean;
}

/** Relative hrefs for entering / leaving edit mode on the current request. */
export function editModeHrefs(
  requestUrl: string,
  assetBase: string,
): { editHref: string; readHref: string } {
  const url = new URL(requestUrl);
  let path = url.pathname;
  if (assetBase && (path === assetBase || path.startsWith(`${assetBase}/`))) {
    path = path.slice(assetBase.length) || "/";
  }
  const relative = path.replace(/^\//, "") || "./";
  const edit = new URLSearchParams(url.search);
  const read = new URLSearchParams(url.search);
  edit.set("edit", "");
  read.delete("edit");
  return {
    editHref: `${relative}${formatFlagQuery(edit)}`,
    readHref: `${relative}${formatFlagQuery(read)}`,
  };
}

function formatFlagQuery(params: URLSearchParams): string {
  const qs = params.toString().replace(/=(?=&|$)/g, "");
  return qs ? `?${qs}` : "";
}

const APP_VERSION = readAppVersion();

export function renderHtmlPage(opts: HtmlShellOptions): string {
  const assetBase = opts.assetBase ?? "";
  // Resolve all relative href/src/action against the mount path ("" → "/", "/garden" → "/garden/")
  const baseHref = `${assetBase}/`;
  const user = opts.user;
  const editHref = opts.editHref ?? "?edit";
  const readHref = opts.readHref ?? "./";
  const liveSceneId = opts.liveSceneId;
  const canEditPanel =
    !!user && (opts.isManager === true || opts.nonManagerEditingEnabled !== false);
  const bootstrap: EditBootstrap = {
    user: user ? { username: user.username } : undefined,
    manage: opts.manage,
    ownedScenes: opts.ownedScenes ?? [],
    isManager: opts.isManager ?? opts.manage?.isManager ?? false,
    isModerator: opts.isModerator ?? false,
    isQuestor: opts.isQuestor ?? false,
    editHref,
    readHref,
    liveSceneId,
    allowGuestLive: liveSceneId !== undefined && opts.guestLiveEnabled !== false,
    liveChatEnabled: opts.liveChatEnabled !== false,
    registrationEnabled: opts.registrationEnabled !== false,
    nonManagerEditingEnabled: opts.nonManagerEditingEnabled !== false,
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${escapeAttr(baseHref)}" />
  <title>${escapeHtml(opts.title)} — Proseden</title>
  <link rel="stylesheet" href="assets/styles.css" />
</head>
<body>
  <div class="app">
    <header class="top">
      <a class="brand" href="./">Proseden</a>
      <div class="auth" id="auth-panel">
        ${user ? authLoggedIn(user, liveSceneId !== undefined, opts.inboxCount ?? 0, canEditPanel) : authLoggedOut(liveSceneId !== undefined && opts.guestLiveEnabled !== false, opts.registrationEnabled !== false)}
      </div>
    </header>
    <div class="layout">
      <main class="prose">
        ${opts.bodyHtml}
      </main>
      <aside id="edit-root" class="edit-root" hidden></aside>
    </div>
  </div>
  <footer class="site-footer">
    <p>
      <span>proseden</span>
      <span class="site-footer-sep" aria-hidden="true">::</span>
      <span>by raith &amp; cursor</span>
      <span class="site-footer-sep" aria-hidden="true">::</span>
      <span>&copy; 2026</span>
      <span class="site-footer-sep" aria-hidden="true">::</span>
      <span>v${escapeHtml(APP_VERSION)}</span>
    </p>
  </footer>
  <script type="application/json" id="edit-bootstrap">${jsonScript(bootstrap)}</script>
  <script type="module" src="assets/panel.js"></script>
</body>
</html>`;
}

function authLoggedIn(user: UserRecord, canLive: boolean, inboxCount: number, canEdit: boolean): string {
  const inboxLabel = inboxCount > 0 ? `Messages (${inboxCount})` : "Messages";
  return `<span class="who"><strong><a href="${userPath(user.username)}">${escapeHtml(user.username)}</a></strong></span>
    <a href="profile">Profile</a>
    <a href="inbox">${escapeHtml(inboxLabel)}</a>
    <a href="inv">Inventory</a>
    ${modeSwitchHtml({ canLive, canEdit })}
    <form method="post" action="auth/logout" class="inline">
      <button type="submit">Log out</button>
    </form>`;
}

function authLoggedOut(canLive: boolean, registrationEnabled: boolean): string {
  return `${modeSwitchHtml({ canLive, canEdit: false })}
  <details class="login">
      <summary>Log in</summary>
      <form method="post" action="auth/login" class="login-form">
        <label>User <input name="username" autocomplete="username" required /></label>
        <label>Pass <input name="password" type="password" autocomplete="current-password" required /></label>
        <button type="submit">Log in</button>
      </form>
    </details>${
      registrationEnabled
        ? `
    <details class="register">
      <summary>Register</summary>
      <form method="post" action="auth/register" class="login-form">
        <label>User <input name="username" autocomplete="username" required /></label>
        <label>Pass <input name="password" type="password" autocomplete="new-password" required minlength="6" /></label>
        <button type="submit">Create account</button>
      </form>
    </details>`
        : ""
    }`;
}

function modeSwitchHtml(opts: { canLive: boolean; canEdit: boolean }): string {
  const liveDis = opts.canLive ? "" : " disabled";
  const editDis = opts.canEdit ? "" : " disabled";
  return `<div class="mode-switch" role="group" aria-label="Panel mode">
      <button type="button" class="mode-switch-btn" id="panel-live"${liveDis} title="${opts.canLive ? "Live" : "Live is available on scene pages"}">Live</button>
      <button type="button" class="mode-switch-btn" id="panel-edit"${editDis} title="${opts.canEdit ? "Edit" : opts.canLive ? "Editing is temporarily disabled" : "Log in to edit"}">Edit</button>
      <button type="button" class="mode-switch-btn" id="panel-view">View</button>
    </div>`;
}

function readAppVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const rel of ["../../package.json", "../package.json"]) {
    try {
      const pkg = JSON.parse(readFileSync(join(here, rel), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "proseden" && pkg.version) return pkg.version;
    } catch {
      /* try the next candidate */
    }
  }
  return "0.0.0";
}

/** JSON for a script tag: escape `<` so `</script>` in prose cannot break out. */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
