import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatJsonTextarea } from "../json-textarea.js";
import type { ArtefactRecord, Deny, ExitRecord, Grant, SceneRecord, UserRecord } from "../model/types.js";
import { escapeHtml, formatProse } from "./prose.js";

export { escapeHtml } from "./prose.js";

export interface OwnedSceneLink {
  id: number;
  title?: string;
}

export interface HtmlShellOptions {
  title: string;
  bodyHtml: string;
  user?: UserRecord;
  assetBase?: string;
  manage?: ManageContext;
  /** Scenes owned by the signed-in user (sidebar jump list). */
  ownedScenes?: OwnedSceneLink[];
  /** Staff manager — shows /admin and /staff links in the sidebar. */
  isManager?: boolean;
  /** Moderator or manager — live admin / purge. */
  isModerator?: boolean;
  /** Scene id for live SSE when viewing a scene page. */
  liveSceneId?: number;
  /** Relative href that adds `?edit` (signed-in Edit control). */
  editHref?: string;
  /** Relative href with `?edit` removed (View). */
  readHref?: string;
}

export interface ManageContext {
  kind: "scene" | "artefact" | "inventory" | "home";
  scene?: SceneRecord;
  artefact?: ArtefactRecord;
  exits?: Array<ExitRecord & { canRemove?: boolean }>;
  canEdit?: boolean;
  canManage?: boolean;
  /** Add exit from this scene (manage/organise, or public junction). */
  canAddExit?: boolean;
  canOrganise?: boolean;
  canDelete?: boolean;
  canTransfer?: boolean;
  isManager?: boolean;
  collected?: boolean;
  groups?: Array<{ id: string; title: string }>;
  entranceGroups?: Array<{ id: string; title: string; entranceSceneId: number }>;
  sceneGroup?: { id: string; title: string };
}

export interface EditBootstrap {
  user?: { username: string };
  manage?: ManageContext;
  ownedScenes: OwnedSceneLink[];
  isManager: boolean;
  isModerator: boolean;
  editHref: string;
  readHref: string;
  /** Present on scene pages — enables Live panel + SSE. */
  liveSceneId?: number;
  /** Guests may open Live on public scenes. */
  allowGuestLive: boolean;
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
  const bootstrap: EditBootstrap = {
    user: user ? { username: user.username } : undefined,
    manage: opts.manage,
    ownedScenes: opts.ownedScenes ?? [],
    isManager: opts.isManager ?? opts.manage?.isManager ?? false,
    isModerator: opts.isModerator ?? false,
    editHref,
    readHref,
    liveSceneId,
    allowGuestLive: liveSceneId !== undefined,
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
        ${user ? authLoggedIn(user, editHref, liveSceneId !== undefined) : authLoggedOut(liveSceneId !== undefined)}
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

function authLoggedIn(user: UserRecord, _editHref: string, canLive: boolean): string {
  return `<span class="who"><strong>${escapeHtml(user.username)}</strong></span>
    <a href="profile">Profile</a>
    <a href="inv">Inventory</a>
    ${modeSwitchHtml({ canLive, canEdit: true })}
    <form method="post" action="auth/logout" class="inline">
      <button type="submit">Log out</button>
    </form>`;
}

function authLoggedOut(canLive: boolean): string {
  return `${modeSwitchHtml({ canLive, canEdit: false })}
  <details class="login">
      <summary>Log in</summary>
      <form method="post" action="auth/login" class="login-form">
        <label>User <input name="username" autocomplete="username" required /></label>
        <label>Pass <input name="password" type="password" autocomplete="current-password" required /></label>
        <button type="submit">Log in</button>
      </form>
    </details>
    <details class="register">
      <summary>Register</summary>
      <form method="post" action="auth/register" class="login-form">
        <label>User <input name="username" autocomplete="username" required /></label>
        <label>Pass <input name="password" type="password" autocomplete="new-password" required minlength="6" /></label>
        <button type="submit">Create account</button>
      </form>
    </details>`;
}

function modeSwitchHtml(opts: { canLive: boolean; canEdit: boolean }): string {
  const liveDis = opts.canLive ? "" : " disabled";
  const editDis = opts.canEdit ? "" : " disabled";
  return `<div class="mode-switch" role="group" aria-label="Panel mode">
      <button type="button" class="mode-switch-btn" id="panel-live"${liveDis} title="${opts.canLive ? "Live" : "Live is available on scene pages"}">Live</button>
      <button type="button" class="mode-switch-btn" id="panel-edit"${editDis} title="${opts.canEdit ? "Edit" : "Log in to edit"}">Edit</button>
      <button type="button" class="mode-switch-btn" id="panel-view">View</button>
    </div>`;
}

export function renderSceneBodyHtml(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  /** True when this scene is the landing scene of an entrance group. */
  isEntrance?: boolean;
  /** @deprecated Links are root-relative via <base href>; kept for callers. */
  assetBase?: string;
}): string {
  const { scene, exits, artefacts, detail, isEntrance } = opts;

  if (detail) {
    const text = scene.details[detail];
    return `<p class="crumb"><a href="s/${scene.id}">← Scene ${scene.id}</a></p>
      <h1>${escapeHtml(scene.title ?? `Scene ${scene.id}`)} <span class="sub">detail:${escapeHtml(detail)}</span></h1>
      ${bylineHtml(scene.owner)}
      <div class="desc">${formatProse(text ?? `No detail named “${detail}”.`)}</div>`;
  }

  const detailLinks = Object.keys(scene.details)
    .map(
      (name) =>
        `<li><a href="s/${scene.id}?${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`,
    )
    .join("");

  const artefactLinks = artefacts
    .map((a) => {
      const label = a.title ?? `Artefact ${a.id}`;
      return `<li><a href="a/${a.id}">${escapeHtml(label)}</a></li>`;
    })
    .join("");

  const exitLinks = exits
    .map((e) => {
      return `<li><a href="s/${scene.id}/go/${e.exitId}">${escapeHtml(e.nickname)}</a></li>`;
    })
    .join("");

  const publicJunction = Boolean(scene.isJunction && scene.visibility === "public");
  const badges = [
    escapeHtml(scene.visibility),
    publicJunction ? "junction" : "",
    isEntrance ? "entrance" : "",
  ].filter(Boolean);

  return `<h1>${escapeHtml(scene.title ?? `Scene ${scene.id}`)} <span class="sub">#${scene.id}</span></h1>
    ${bylineHtml(scene.owner)}
    <p class="meta">${badges.join(" · ")}</p>
    <div class="desc">${formatProse(scene.body)}</div>
    ${detailLinks ? `<section><h2>Details</h2><ul class="link-list">${detailLinks}</ul></section>` : ""}
    ${artefactLinks ? `<section><h2>Artefacts</h2><ul class="link-list">${artefactLinks}</ul></section>` : ""}
    ${exitLinks ? `<section><h2>Exits</h2><ul class="link-list">${exitLinks}</ul></section>` : ""}
    <section>
      <h2>Travel</h2>
      <form method="get" action="s/" class="travel-form" id="travel-form">
        <label>Scene id <input name="to" type="number" min="1" required /></label>
        <input type="hidden" name="from" value="${scene.id}" />
        <button type="submit">Go</button>
      </form>
    </section>
    <script>
      (function () {
        var form = document.getElementById("travel-form");
        if (!form) return;
        form.addEventListener("submit", function (ev) {
          ev.preventDefault();
          var to = form.querySelector('input[name="to"]').value;
          var from = form.querySelector('input[name="from"]').value;
          if (!to) return;
          window.location.href = "s/" + encodeURIComponent(to) + "?from=" + encodeURIComponent(from);
        });
      })();
    </script>`;
}

export function renderArtefactBodyHtml(opts: {
  artefact: ArtefactRecord;
  detail?: string;
  /** @deprecated Links are root-relative via <base href>; kept for callers. */
  assetBase?: string;
  /** When set, show collect / drop as a reader action. */
  collected?: boolean;
}): string {
  const { artefact, detail } = opts;

  if (detail) {
    const text = artefact.details[detail];
    return `<p class="crumb"><a href="a/${artefact.id}">← Artefact ${artefact.id}</a></p>
      <h1>${escapeHtml(artefact.title ?? `Artefact ${artefact.id}`)} <span class="sub">detail:${escapeHtml(detail)}</span></h1>
      ${bylineHtml(artefact.owner)}
      <div class="desc">${formatProse(text ?? `No detail named “${detail}”.`)}</div>`;
  }

  const detailLinks = Object.keys(artefact.details)
    .map(
      (name) =>
        `<li><a href="a/${artefact.id}?${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`,
    )
    .join("");

  return `<h1>${escapeHtml(artefact.title ?? `Artefact ${artefact.id}`)} <span class="sub">#${artefact.id}</span></h1>
    ${bylineHtml(artefact.owner)}
    <p class="meta">Homed at <a href="s/${artefact.homeSceneId}?from=${artefact.homeSceneId}">scene ${artefact.homeSceneId}</a>${
      artefact.tags.length ? ` · ${escapeHtml(artefact.tags.join(", "))}` : ""
    }</p>
    <div class="desc">${formatProse(artefact.body)}</div>
    ${detailLinks ? `<section><h2>Details</h2><ul class="link-list">${detailLinks}</ul></section>` : ""}
    ${
      opts.collected === undefined
        ? ""
        : opts.collected
          ? `<form method="post" action="a/${artefact.id}/collect/drop" class="reader-action"><button type="submit">Remove from inventory</button></form>`
          : `<form method="post" action="a/${artefact.id}/collect" class="reader-action"><button type="submit">Collect</button></form>`
    }`;
}

const GRANTS_EXAMPLE = `[
  { "who": "visitor", "rights": ["read"] },
  { "who": "*", "rights": ["read", "edit"] }
]`;

const DENIES_EXAMPLE = `[
  { "who": "bob", "rights": ["edit"] },
  { "who": "carol" }
]`;

export function renderProfileBodyHtml(opts: {
  username: string;
  message?: string;
  grants?: Grant[];
  denies?: Deny[];
}): string {
  const notice = opts.message
    ? `<p class="notice" role="status">${escapeHtml(opts.message)}</p>`
    : "";
  const accessAction = `u/${encodeURIComponent(opts.username)}/access`;
  return `<h1>Profile</h1>
    ${bylineHtml(opts.username)}
    ${notice}
    <h2>Change password</h2>
    <form method="post" action="auth/password" class="profile-form">
      <label>Current password
        <input name="currentPassword" type="password" autocomplete="current-password" required />
      </label>
      <label>New password
        <input name="newPassword" type="password" autocomplete="new-password" required minlength="6" />
      </label>
      <label>Confirm new password
        <input name="confirmPassword" type="password" autocomplete="new-password" required minlength="6" />
      </label>
      <button type="submit">Update password</button>
    </form>
    <h2>Share all my work</h2>
    <p class="muted">Applies to every scene and group you own.</p>
    ${renderAccessFormHtml(accessAction, opts.grants, opts.denies, "Save share-all")}
`;
}

export interface GroupListItem {
  id: string;
  title: string;
  owner: string;
  sceneCount: number;
}

export function renderGroupsIndexHtml(opts: {
  managed: GroupListItem[];
  readable: GroupListItem[];
}): string {
  return `<h1>Groups</h1>
    <p class="muted">Rights on a group apply to every scene in it.</p>
    ${renderGroupListSection("Groups you manage", opts.managed)}
    ${renderGroupListSection("Other groups you can see", opts.readable)}
    <h2>New group</h2>
    <form method="post" action="g" class="profile-form">
      <label>Title <input name="title" required /></label>
      <button type="submit">Create group</button>
    </form>`;
}

function renderGroupListSection(heading: string, groups: GroupListItem[]): string {
  if (!groups.length) return "";
  const items = groups
    .map((group) => {
      const scenes = group.sceneCount === 1 ? "1 scene" : `${group.sceneCount} scenes`;
      return `<li><a href="g/${encodeURIComponent(group.id)}">${escapeHtml(group.title)}</a>
        <span class="muted"> (#${escapeHtml(group.id)} · ${escapeHtml(group.owner)} · ${scenes})</span></li>`;
    })
    .join("");
  return `<h2>${escapeHtml(heading)}</h2><ul class="link-list">${items}</ul>`;
}

export function renderGroupBodyHtml(opts: {
  id: string;
  title: string;
  owner: string;
  scenes: Array<{ id: number; title?: string }>;
  grants?: Grant[];
  denies?: Deny[];
  canManage: boolean;
  canTransfer?: boolean;
  accessSummary: string;
  message?: string;
}): string {
  const notice = opts.message
    ? `<p class="notice" role="status">${escapeHtml(opts.message)}</p>`
    : "";
  const scenes = opts.scenes.length
    ? `<ul class="link-list">${opts.scenes
        .map((scene) => {
          const label = scene.title?.trim() ? scene.title : `Scene ${scene.id}`;
          return `<li><a href="s/${scene.id}">${escapeHtml(label)}</a> <span class="muted">#${scene.id}</span></li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">No scenes in this group yet. Assign one from Edit → Groups.</p>`;
  const access = opts.canManage
    ? `<h2>Access</h2>
    <p class="muted">Anyone granted rights here can use them on every scene in this group.</p>
    ${renderAccessFormHtml(`g/${encodeURIComponent(opts.id)}/access`, opts.grants, opts.denies, "Save group access")}`
    : `<h2>Access</h2><pre class="desc">${escapeHtml(opts.accessSummary)}</pre>`;
  const transfer = opts.canTransfer
    ? renderTransferFormHtml(`g/${encodeURIComponent(opts.id)}/transfer`, opts.owner, "group")
    : "";
  return `<p class="crumb"><a href="g">← Groups</a></p>
    <h1>${escapeHtml(opts.title)} <span class="sub">#${escapeHtml(opts.id)}</span></h1>
    ${bylineHtml(opts.owner)}
    ${notice}
    <h2>Scenes</h2>
    ${scenes}
    ${access}
    ${transfer}`;
}

export function renderInventoryBodyHtml(items: ArtefactRecord[], _assetBase = ""): string {
  if (!items.length) {
    return `<h1>Inventory</h1><p class="muted">Empty — collect artefacts you love.</p>`;
  }
  const list = items
    .map((artefact) => {
      const label = artefact.title ?? `Artefact ${artefact.id}`;
      const tags = artefact.tags.length
        ? ` <span class="muted">(${escapeHtml(artefact.tags.join(", "))})</span>`
        : "";
      return `<li><a href="a/${artefact.id}">${escapeHtml(label)}</a>${tags}</li>`;
    })
    .join("");
  return `<h1>Inventory</h1><ul class="link-list">${list}</ul>`;
}

export function renderMessageBodyHtml(title: string, message: string): string {
  return `<h1>${escapeHtml(title)}</h1><div class="desc">${formatProse(message)}</div>`;
}

function renderTransferFormHtml(
  action: string,
  owner: string,
  kind: "scene" | "group",
): string {
  const what =
    kind === "group"
      ? "this group, its scenes, and artefacts you own that are homed in those scenes"
      : "this scene and artefacts you own that are homed here";
  return `<h2>Transfer ownership</h2>
    <p class="muted">Owner is ${escapeHtml(owner)}. Transfer ${what} to another registered user.</p>
    <form method="post" action="${escapeAttr(action)}" class="profile-form">
      <label>New owner <input name="to" required autocomplete="username" /></label>
      <input type="hidden" name="keepAccess" value="0" />
      <label class="edit-check"><input type="checkbox" name="keepAccess" value="1" checked /> Keep my access</label>
      <button type="submit">Transfer</button>
    </form>`;
}

function renderAccessFormHtml(
  action: string,
  grants: Grant[] | undefined,
  denies: Deny[] | undefined,
  submit: string,
): string {
  return `<form method="post" action="${escapeAttr(action)}" class="access-form">
      ${renderJsonFieldHtml("Grants", "grantsJson", 10, grants ?? [], GRANTS_EXAMPLE, "Array of { who, rights }.")}
      ${renderJsonFieldHtml("Denies", "deniesJson", 10, denies ?? [], DENIES_EXAMPLE, "Array of { who, rights? }. Omit rights to deny all.")}
      <button type="submit">${escapeHtml(submit)}</button>
    </form>`;
}

function renderJsonFieldHtml(
  label: string,
  name: string,
  rows: number,
  value: unknown,
  example: string,
  note: string,
): string {
  return `<div class="json-field">
      <div class="json-field-label">
        <span>${escapeHtml(label)}</span>
        <details class="json-format-help">
          <summary class="json-format-info" title="Example ${escapeAttr(label)}">i</summary>
          <div class="json-format-example">
            <p class="muted">${escapeHtml(note)}</p>
            <pre>${escapeHtml(example)}</pre>
          </div>
        </details>
      </div>
      <textarea name="${escapeAttr(name)}" rows="${rows}">${escapeHtml(formatJsonTextarea(value))}</textarea>
    </div>`;
}

function bylineHtml(owner: string): string {
  return owner ? `<p class="byline">by ${escapeHtml(owner)}</p>` : "";
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

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

/** JSON for a script tag: escape `<` so `</script>` in prose cannot break out. */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
