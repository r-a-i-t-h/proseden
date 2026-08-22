import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataJsonKindAttr } from "../json-table.js";
import { formatJsonTextarea } from "../json-textarea.js";
import type {
  ArtefactRecord,
  Deny,
  EditLogEntry,
  EntityKind,
  ExitRecord,
  Grant,
  InboxMessage,
  SceneRecord,
  UserRecord,
} from "../model/types.js";
import { escapeAttr } from "./escape.js";
import { entityKindLabel, entityPath, userPath } from "./entity.js";
import { escapeHtml, formatProse } from "./prose.js";
import { grantTimeHtml, relativeAgeHtml } from "./relative-age.js";
import {
  artefactPageView,
  DENIES_EXAMPLE,
  DETAILS_EXAMPLE,
  entityDetailView,
  GRANTS_EXAMPLE,
  inboxPageView,
  msgPageView,
  profilePageView,
  scenePageView,
  toHtml,
  userLink,
  type PageBackLink,
} from "./view/index.js";

export { escapeHtml } from "./prose.js";
export { userPath } from "./entity.js";
export type { EntityKind } from "../model/types.js";
export type { PageBackLink };

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

export interface ManageContext {
  kind: "scene" | "artefact" | "inventory" | "home";
  scene?: SceneRecord;
  artefact?: ArtefactRecord;
  exits?: Array<ExitRecord & { canRemove?: boolean }>;
  canEdit?: boolean;
  canManage?: boolean;
  /** Add exit from this scene (manage/topographer, or public junction). */
  canAddExit?: boolean;
  /** Place an artefact in this scene (edit, or public repository). */
  canPlaceArtefact?: boolean;
  /** Reorder the origin’s full exit list (manage or topographer). */
  canReorderExits?: boolean;
  /** Return a guest artefact to its owner's home scene. */
  canEject?: boolean;
  isTopographer?: boolean;
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
  isQuestor: boolean;
  editHref: string;
  readHref: string;
  /** Present on scene pages — enables Live panel + SSE. */
  liveSceneId?: number;
  /** Guests may open Live on public scenes. */
  allowGuestLive: boolean;
  /** Say and shout in Live. */
  liveChatEnabled: boolean;
  /** New account registration. */
  registrationEnabled: boolean;
  /** Non-managers may use Edit mode. */
  nonManagerEditingEnabled: boolean;
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

export function renderViewLockdownBodyHtml(): string {
  return `<h1>Proseden is closed</h1>
    <p class="muted">The site is temporarily closed to readers. Managers may log in below.</p>
    <details class="login" open>
      <summary>Log in</summary>
      <form method="post" action="auth/login" class="login-form">
        <label>User <input name="username" autocomplete="username" required /></label>
        <label>Pass <input name="password" type="password" autocomplete="current-password" required /></label>
        <button type="submit">Log in</button>
      </form>
    </details>`;
}

export function renderViewLockdownText(): string {
  return "Proseden is closed.\n\nThe site is temporarily closed to readers. Managers may log in.\n";
}

function renderNamedDetailsHtml(path: string, details: Record<string, string>): string {
  const names = Object.keys(details);
  if (!names.length) return "";
  const items = names
    .map(
      (name) =>
        `<li><a href="${path}?${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`,
    )
    .join("");
  return `<section><h2>Details</h2><ul class="link-list">${items}</ul></section>`;
}

/** Detail sub-page shared by scenes and artefacts. */
export function renderEntityDetailHtml(opts: {
  kind: EntityKind;
  id: number;
  title?: string;
  owner: string;
  detail: string;
  text?: string;
}): string {
  return toHtml(
    entityDetailView({
      kind: opts.kind,
      id: opts.id,
      title: opts.title,
      owner: opts.owner,
      detail: opts.detail,
      text: opts.text,
    }).body,
  );
}

export function renderSceneBodyHtml(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  isEntrance?: boolean;
  /** @deprecated Links are root-relative via <base href>; kept for callers. */
  assetBase?: string;
}): string {
  return toHtml(
    scenePageView({
      scene: opts.scene,
      exits: opts.exits,
      artefacts: opts.artefacts,
      detail: opts.detail,
      isEntrance: opts.isEntrance,
    }).body,
  );
}

export function renderArtefactBodyHtml(opts: {
  artefact: ArtefactRecord;
  detail?: string;
  /** @deprecated Links are root-relative via <base href>; kept for callers. */
  assetBase?: string;
  collected?: boolean;
}): string {
  return toHtml(
    artefactPageView({
      artefact: opts.artefact,
      detail: opts.detail,
      collected: opts.collected,
    }).body,
  );
}

export function renderEditHistoryBodyHtml(opts: {
  kind: EntityKind;
  id: number;
  log: EditLogEntry[];
}): string {
  const path = entityPath(opts.kind, opts.id);
  const htmlList = opts.log.length
    ? `<ul class="link-list">${opts.log
        .map((e) => {
          const link = e.versionId
            ? ` <a href="${path}/history/${encodeURIComponent(e.versionId)}">view</a>`
            : "";
          return `<li>${escapeHtml(e.at)} · ${userLinkHtml(e.by)} · ${escapeHtml(e.fields.join(", ") || "—")}${e.retained ? " · retained" : ""}${link}</li>`;
        })
        .join("")}</ul>`
    : `<p class="muted">No edits logged.</p>`;
  return `<p class="crumb"><a href="${path}">← ${entityKindLabel(opts.kind)} ${opts.id}</a></p><h1>History</h1>${htmlList}`;
}

export function renderSnapshotBodyHtml(opts: {
  kind: EntityKind;
  id: number;
  versionId: string;
  body: string;
  title?: string;
  canRestore: boolean;
}): string {
  const path = entityPath(opts.kind, opts.id);
  const meta =
    opts.kind === "scene"
      ? `<p class="meta">${escapeHtml(opts.title ?? `Scene ${opts.id}`)}</p>`
      : "";
  const restore = opts.canRestore
    ? `<form method="post" action="${path}/history/${encodeURIComponent(opts.versionId)}/restore" class="stack"><button type="submit">Restore this version</button></form>`
    : "";
  return `<p class="crumb"><a href="${path}/history">← History</a></p>
    <h1>Snapshot <span class="sub">${escapeHtml(opts.versionId)}</span></h1>
    ${meta}
    <div class="desc">${formatProse(opts.body)}</div>
    ${restore}`;
}



export function renderPageBackCrumb(back?: PageBackLink): string {
  if (!back) return "";
  return `<p class="crumb"><a href="${escapeAttr(back.href)}"${back.history ? ' data-nav="back"' : ""}>${escapeHtml(back.label)}</a></p>`;
}

export function renderProfileBodyHtml(opts: {
  username: string;
  message?: string;
  description?: string;
  details?: Record<string, string>;
  grants?: Grant[];
  denies?: Deny[];
  back?: PageBackLink;
  openSection?: "appearance" | "password" | "sharing";
}): string {
  return toHtml(profilePageView(opts).body);
}

export function renderUserProfileBodyHtml(opts: {
  username: string;
  description: string;
  details: Record<string, string>;
  detail?: string;
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
  badges?: Array<{ id: string; title: string; grantTime?: string | null }>;
  back?: PageBackLink;
}): string {
  const path = userPath(opts.username);
  const back = renderPageBackCrumb(opts.back);
  if (opts.detail) {
    const text = opts.details[opts.detail];
    return `${back}<p class="crumb"><a href="${path}">← ${escapeHtml(opts.username)}</a></p>
    <h1>${escapeHtml(opts.username)} <span class="detail-sub">detail: ${escapeHtml(opts.detail)}</span></h1>
    <div class="desc">${formatProse(text ?? `No detail named “${opts.detail}”.`)}</div>`;
  }
  const desc = opts.description.trim()
    ? formatProse(opts.description)
    : `<p class="muted">No description yet.</p>`;
  const meta = renderUserProfileMetaHtml(opts);
  const badges = opts.badges ?? [];
  const badgeBlock =
    badges.length === 0
      ? ""
      : `<h2>Badges</h2>
    <ul class="link-list">${badges
      .map(
        (b) =>
          `<li>${escapeHtml(b.title)} <span class="muted">(${escapeHtml(b.id)}) · ${grantTimeHtml(b.grantTime ?? undefined)}</span></li>`,
      )
      .join("")}</ul>`;
  return `${back}<h1>${escapeHtml(opts.username)}</h1>
    ${meta}
    <div class="desc">${desc}</div>
    ${renderNamedDetailsHtml(path, opts.details)}
    ${badgeBlock}`;
}

function renderUserProfileMetaHtml(opts: {
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
}): string {
  const parts: string[] = [];
  if (opts.ownedScenes !== undefined) {
    parts.push(escapeHtml(pluralCount(opts.ownedScenes, "scene", "scenes")));
  }
  if (opts.ownedArtefacts !== undefined) {
    parts.push(escapeHtml(pluralCount(opts.ownedArtefacts, "artefact", "artefacts")));
  }
  if (opts.lastSeenAt) {
    parts.push(`last seen ${relativeAgeHtml(opts.lastSeenAt)}`);
  }
  if (!parts.length) return "";
  return `<p class="meta">${parts.join(" · ")}</p>`;
}

function pluralCount(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
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
  back?: PageBackLink;
}): string {
  return `${renderPageBackCrumb(opts.back)}<h1>Groups</h1>
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
        <span class="muted"> (#${escapeHtml(group.id)} · ${userLinkHtml(group.owner)} · ${scenes})</span></li>`;
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
  back?: PageBackLink;
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
  return `${renderPageBackCrumb(opts.back)}<p class="crumb"><a href="g">← Groups</a></p>
    <h1>${escapeHtml(opts.title)} <span class="sub">#${escapeHtml(opts.id)}</span></h1>
    ${bylineHtml(opts.owner)}
    ${notice}
    <h2>Scenes</h2>
    ${scenes}
    ${access}
    ${transfer}`;
}

export function renderInventoryBodyHtml(
  items: ArtefactRecord[],
  back?: PageBackLink,
  alchemy?: { alchemyOk?: string; alchemyError?: string },
): string {
  const crumb = renderPageBackCrumb(back);
  const list =
    items.length === 0
      ? `<p class="muted">Empty — collect artefacts you love.</p>`
      : `<ul class="link-list">${items
          .map((artefact) => {
            const label = artefact.title ?? `Artefact ${artefact.id}`;
            const tags = artefact.tags.length
              ? ` <span class="muted">(${escapeHtml(artefact.tags.join(", "))})</span>`
              : "";
            return `<li><a href="a/${artefact.id}">${escapeHtml(label)}</a>${tags}</li>`;
          })
          .join("")}</ul>`;

  const alchemyChecks =
    items.length < 2
      ? `<p class="muted">Collect at least two artefacts to attempt alchemy.</p>`
      : `<form method="post" action="alchemy/combine" class="alchemy-form">
      <ul class="alchemy-pick-list">
        ${items
          .map((a) => {
            const label = a.title ?? `Artefact ${a.id}`;
            return `<li><label class="alchemy-pick"><input type="checkbox" name="artefactId" value="${a.id}" /> <span>${escapeHtml(label)}</span></label></li>`;
          })
          .join("")}
      </ul>
      <button type="submit">Combine selected</button>
    </form>`;

  const notice = alchemy?.alchemyOk
    ? `<p class="notice">${escapeHtml(alchemy.alchemyOk)}</p>`
    : alchemy?.alchemyError
      ? `<p class="error">${escapeHtml(alchemy.alchemyError)}</p>`
      : "";

  const alchemyOpen =
    Boolean(alchemy?.alchemyOk || alchemy?.alchemyError) || undefined;

  return `${crumb}<h1>Inventory</h1>${list}
    <details class="alchemy-panel"${alchemyOpen ? " open" : ""} data-alchemy-panel>
      <summary>Alchemy</summary>
      ${notice}
      <p class="muted">Select two or more holdings and combine them. Recipes are world-defined.</p>
      ${alchemyChecks}
    </details>`;
}

export function renderInboxBodyHtml(opts: {
  messages: InboxMessage[];
  message?: string;
  error?: string;
  back?: PageBackLink;
  peerMessagingEnabled?: boolean;
  composeTo?: string;
  composeBody?: string;
}): string {
  return toHtml(inboxPageView(opts).body);
}

export function renderMsgBodyHtml(opts: {
  usernames: string[];
  selected?: string;
  body?: string;
  notice?: string;
  error?: string;
  back?: PageBackLink;
  peerMessagingEnabled?: boolean;
}): string {
  return toHtml(msgPageView(opts).body);
}

export function renderStaffBodyHtml(opts: {
  rowsHtml: string;
  back?: PageBackLink;
}): string {
  return `${renderPageBackCrumb(opts.back)}<h1>Staff</h1>
      ${opts.rowsHtml ? `<ul class="link-list">${opts.rowsHtml}</ul>` : `<p class="muted">No staff roles assigned.</p>`}
      <h2>Assign staff role</h2>
      <form method="post" action="staff/" class="stack" id="staff-form">
        <label>Username <input name="username" required /></label>
        <label>Roles (comma: moderator, topographer, manager, questor) <input name="roles" placeholder="questor" /></label>
        <button type="submit">Save roles</button>
      </form>
      <script>
        (function () {
          var form = document.getElementById("staff-form");
          if (!form) return;
          form.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var username = form.querySelector('input[name="username"]').value.trim();
            var roles = form.querySelector('input[name="roles"]').value;
            if (!username) return;
            form.action = "staff/" + encodeURIComponent(username);
            var body = new URLSearchParams();
            body.set("roles", roles);
            fetch(form.action, {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
              body: body,
            }).then(function (r) {
              if (r.ok) window.location.reload();
              else r.json().then(function (err) { alert(err.error || "Failed"); });
            });
          });
        })();
      </script>`;
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
    <p class="muted">Owner is ${userLinkHtml(owner)}. Transfer ${what} to another registered user.</p>
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
  /** When set, use this source text instead of pretty-printing `value`. */
  text?: string,
): string {
  const body = text !== undefined ? text : formatJsonTextarea(value);
  return `<div class="json-field">
      <div class="json-field-label">
        <span>${escapeHtml(label)}</span>
        <details class="json-format-help">
          <summary class="json-format-info" title="Example ${escapeAttr(label)}">i</summary>
          <div class="json-format-example">
            <p class="muted json-format-note">${escapeHtml(note)}</p>
            <pre>${escapeHtml(example)}</pre>
          </div>
        </details>
      </div>
      <textarea name="${escapeAttr(name)}" rows="${rows}" data-editor="json"${dataJsonKindAttr(name)}>${escapeHtml(body)}</textarea>
    </div>`;
}

export { renderJsonFieldHtml };

function bylineHtml(owner: string): string {
  return owner ? `<p class="byline">by ${userLinkHtml(owner)}</p>` : "";
}

export function userLinkHtml(username: string): string {
  return userLink(username);
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
