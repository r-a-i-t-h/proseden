import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { escapeHtml, formatProse } from "./prose.js";
import { relativeAgeHtml } from "./relative-age.js";

export { escapeHtml } from "./prose.js";
export type { EntityKind } from "../model/types.js";

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
  /** Scene id for live SSE when viewing a scene page. */
  liveSceneId?: number;
  /** Relative href that adds `?edit` (signed-in Edit control). */
  editHref?: string;
  /** Relative href with `?edit` removed (View). */
  readHref?: string;
  /** Total inbox messages for the signed-in user (header badge). */
  inboxCount?: number;
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
        ${user ? authLoggedIn(user, liveSceneId !== undefined, opts.inboxCount ?? 0) : authLoggedOut(liveSceneId !== undefined)}
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

function authLoggedIn(user: UserRecord, canLive: boolean, inboxCount: number): string {
  const inboxLabel = inboxCount > 0 ? `Inbox (${inboxCount})` : "Inbox";
  return `<span class="who"><strong><a href="${userPath(user.username)}">${escapeHtml(user.username)}</a></strong></span>
    <a href="profile">Profile</a>
    <a href="inbox">${escapeHtml(inboxLabel)}</a>
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

function entityKindLabel(kind: EntityKind): string {
  return kind === "scene" ? "Scene" : "Artefact";
}

function entityPath(kind: EntityKind, id: number): string {
  return kind === "scene" ? `s/${id}` : `a/${id}`;
}

function entityDisplayTitle(kind: EntityKind, id: number, title?: string): string {
  return title?.trim() ? title : `${entityKindLabel(kind)} ${id}`;
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
  const label = entityDisplayTitle(opts.kind, opts.id, opts.title);
  const path = entityPath(opts.kind, opts.id);
  return `<p class="crumb"><a href="${path}">← ${entityKindLabel(opts.kind)} ${opts.id}</a></p>
    <h1>${escapeHtml(label)} <span class="detail-sub">detail: ${escapeHtml(opts.detail)}</span></h1>
    ${bylineHtml(opts.owner)}
    <div class="desc">${formatProse(opts.text ?? `No detail named “${opts.detail}”.`)}</div>`;
}

function renderEntityHeadingHtml(opts: {
  kind: EntityKind;
  id: number;
  title?: string;
  owner: string;
}): string {
  const label = entityDisplayTitle(opts.kind, opts.id, opts.title);
  return `<h1>${escapeHtml(label)} <span class="sub">#${opts.id}</span></h1>
    ${bylineHtml(opts.owner)}`;
}

function renderDetailsSectionHtml(
  kind: EntityKind,
  id: number,
  details: Record<string, string>,
): string {
  return renderNamedDetailsHtml(entityPath(kind, id), details);
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
    return renderEntityDetailHtml({
      kind: "scene",
      id: scene.id,
      title: scene.title,
      owner: scene.owner,
      detail,
      text: scene.details[detail],
    });
  }

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

  return `${renderEntityHeadingHtml({
      kind: "scene",
      id: scene.id,
      title: scene.title,
      owner: scene.owner,
    })}
    <p class="meta">${badges.join(" · ")}</p>
    <div class="desc">${formatProse(scene.body)}</div>
    ${renderDetailsSectionHtml("scene", scene.id, scene.details)}
    ${artefactLinks ? `<section><h2>Artefacts</h2><ul class="link-list">${artefactLinks}</ul></section>` : ""}
    ${exitLinks ? `<section><h2>Exits</h2><ul class="link-list">${exitLinks}</ul></section>` : ""}
    <section>
      <h2>Actions</h2>
      <form method="get" action="s/" class="action-form" id="travel-form">
        <label>Teleport to scene id: <input name="to" type="number" min="1" required /></label>
        <input type="hidden" name="from" value="${scene.id}" />
        <button type="submit">Go</button>
      </form>
      <form method="post" action="s/${scene.id}/view-invites" class="action-form" id="invite-form">
        <label>Invite to view, user: <input name="username" required /></label>
        <button type="submit">Invite</button>
      </form>
    </section>
    <script>
      (function () {
        var travel = document.getElementById("travel-form");
        if (travel) {
          travel.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var to = travel.querySelector('input[name="to"]').value;
            var from = travel.querySelector('input[name="from"]').value;
            if (!to) return;
            window.location.href = "s/" + encodeURIComponent(to) + "?from=" + encodeURIComponent(from);
          });
        }
        var invite = document.getElementById("invite-form");
        if (invite) {
          invite.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var username = invite.querySelector('input[name="username"]').value.trim();
            if (!username) return;
            var body = new URLSearchParams();
            body.set("username", username);
            fetch(invite.action, {
              method: "POST",
              headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
              body: body,
            }).then(function (r) {
              return r.json().then(function (data) {
                if (r.ok) {
                  invite.querySelector('input[name="username"]').value = "";
                  alert((data.toUser || username) + " has been invited to view this scene");
                } else {
                  alert(data.error || "Invalid username");
                }
              });
            });
          });
        }
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
    return renderEntityDetailHtml({
      kind: "artefact",
      id: artefact.id,
      title: artefact.title,
      owner: artefact.owner,
      detail,
      text: artefact.details[detail],
    });
  }

  return `<p class="crumb"><a href="s/${artefact.homeSceneId}?from=${artefact.homeSceneId}">← Scene ${artefact.homeSceneId}</a></p>
    ${renderEntityHeadingHtml({
      kind: "artefact",
      id: artefact.id,
      title: artefact.title,
      owner: artefact.owner,
    })}
    ${artefact.tags.length ? `<p class="meta">${escapeHtml(artefact.tags.join(", "))}</p>` : ""}
    <div class="desc">${formatProse(artefact.body)}</div>
    ${renderDetailsSectionHtml("artefact", artefact.id, artefact.details)}
    ${
      opts.collected === undefined
        ? ""
        : opts.collected
          ? `<form method="post" action="a/${artefact.id}/collect/drop" class="reader-action"><button type="submit">Remove from inventory</button></form>`
          : `<form method="post" action="a/${artefact.id}/collect" class="reader-action"><button type="submit">Collect</button></form>`
    }`;
}

const DETAILS_EXAMPLE = `{
  "card": "Closer look at the mantel card.
Second paragraph on a new line.",
  "window": "Rain beads on the glass."
}`;

const GRANTS_EXAMPLE = `[
  { "who": "visitor", "rights": ["read"] },
  { "who": "*", "rights": ["read", "edit"] }
]`;

const DENIES_EXAMPLE = `[
  { "who": "bob", "rights": ["edit"] },
  { "who": "carol" }
]`;

export type PageBackLink = { href: string; label: string; history?: boolean };

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
  const notice = opts.message
    ? `<p class="notice" role="status">${escapeHtml(opts.message)}</p>`
    : "";
  const accessAction = `u/${encodeURIComponent(opts.username)}/access`;
  const open = opts.openSection ?? "appearance";
  return `${renderPageBackCrumb(opts.back)}<h1>Profile</h1>
    ${bylineHtml(opts.username)}
    ${notice}
    <details class="profile-section"${open === "appearance" ? " open" : ""}>
      <summary>Appearance</summary>
      <form method="post" action="profile" class="profile-form profile-appearance">
        <label>Description
          <textarea name="description" rows="8">${escapeHtml(opts.description ?? "")}</textarea>
        </label>
        ${renderJsonFieldHtml("Details", "detailsJson", 10, opts.details ?? {}, DETAILS_EXAMPLE, "Object of named closer-look texts.")}
        <button type="submit">Save appearance</button>
      </form>
    </details>
    <details class="profile-section"${open === "password" ? " open" : ""}>
      <summary>Password</summary>
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
    </details>
    <details class="profile-section"${open === "sharing" ? " open" : ""}>
      <summary>Sharing</summary>
      <p class="muted">Applies to every scene and group you own.</p>
      ${renderAccessFormHtml(accessAction, opts.grants, opts.denies, "Save share-all")}
    </details>
`;
}

export function renderUserProfileBodyHtml(opts: {
  username: string;
  description: string;
  details: Record<string, string>;
  detail?: string;
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
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
  return `${back}<h1>${escapeHtml(opts.username)}</h1>
    ${meta}
    <div class="desc">${desc}</div>
    ${renderNamedDetailsHtml(path, opts.details)}`;
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
): string {
  const crumb = renderPageBackCrumb(back);
  if (!items.length) {
    return `${crumb}<h1>Inventory</h1><p class="muted">Empty — collect artefacts you love.</p>`;
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
  return `${crumb}<h1>Inventory</h1><ul class="link-list">${list}</ul>`;
}

export function renderInboxBodyHtml(opts: {
  messages: InboxMessage[];
  message?: string;
  back?: PageBackLink;
}): string {
  const crumb = renderPageBackCrumb(opts.back);
  const notice = opts.message ? `<p class="flash">${escapeHtml(opts.message)}</p>` : "";
  if (!opts.messages.length) {
    return `${crumb}<h1>Inbox</h1>${notice}<p class="muted">Empty. Deal with messages as they arrive — this is not a mail archive.</p>`;
  }
  const items = opts.messages
    .map((msg) => {
      const viewLink =
        msg.type === "invite_to_view"
          ? `<a href="s/${msg.sceneId}">View scene</a>`
          : "";
      const actions =
        msg.type === "exit_request"
          ? `<form method="post" action="inbox/${msg.id}/confirm" class="inline"><button type="submit">Confirm</button></form>
        <form method="post" action="inbox/${msg.id}/delete" class="inline"><button type="submit" class="edit-danger">Delete</button></form>`
          : `${viewLink}${viewLink ? "\n        " : ""}<form method="post" action="inbox/${msg.id}/delete" class="inline"><button type="submit" class="edit-danger">Delete</button></form>`;
      return `<article class="inbox-item">
      <header class="inbox-meta">
        <time datetime="${escapeAttr(msg.createdAt)}">${escapeHtml(msg.createdAt)}</time>
        <span>from <strong>${escapeHtml(msg.fromUser)}</strong></span>
      </header>
      <h2 class="inbox-subject">${escapeHtml(msg.subject)}</h2>
      <div class="desc">${formatProse(msg.body)}</div>
      <div class="inbox-actions">${actions}</div>
    </article>`;
    })
    .join("");
  return `${crumb}<h1>Inbox</h1>${notice}${items}`;
}

export function renderMsgBodyHtml(opts: {
  usernames: string[];
  selected?: string;
  body?: string;
  notice?: string;
  error?: string;
  back?: PageBackLink;
}): string {
  const flash = opts.error
    ? `<p class="notice notice-error" role="alert">${escapeHtml(opts.error)}</p>`
    : opts.notice
      ? `<p class="notice" role="status">${escapeHtml(opts.notice)}</p>`
      : "";
  const selected = opts.selected ?? "";
  const options = [
    `<option value="" disabled${selected ? "" : " selected"}>Choose recipient…</option>`,
    `<option value="*"${selected === "*" ? " selected" : ""}>ALL users</option>`,
    ...opts.usernames.map((name) => {
      const sel = selected === name ? " selected" : "";
      return `<option value="${escapeAttr(name)}"${sel}>${escapeHtml(name)}</option>`;
    }),
  ];
  return `${renderPageBackCrumb(opts.back)}<h1>Msg</h1>
    <p class="muted">Send a free-text note to one reader or everyone. Line breaks and prose adornments are kept: _emphasis_, *bold*, ~strike~, ---, and [links](https://…).</p>
    ${flash}
    <form method="post" action="msg" class="profile-form profile-appearance" id="msg-form">
      <label>To
        <select name="to" required>${options.join("")}</select>
      </label>
      <label>Message
        <textarea name="body" rows="12" required>${escapeHtml(opts.body ?? "")}</textarea>
      </label>
      <button type="submit">Send</button>
    </form>`;
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
        <label>Roles (comma: moderator, organiser, manager) <input name="roles" placeholder="moderator" /></label>
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
  return owner ? `<p class="byline">by ${userLinkHtml(owner)}</p>` : "";
}

export function userPath(username: string): string {
  return `u/${encodeURIComponent(username)}`;
}

export function userLinkHtml(username: string): string {
  return `<a href="${userPath(username)}">${escapeHtml(username)}</a>`;
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
