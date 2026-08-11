import type { ArtefactRecord, ExitRecord, SceneRecord, UserRecord } from "../model/types.js";
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
  /** Relative href that adds `?edit` (signed-in Edit control). */
  editHref?: string;
  /** Relative href with `?edit` removed (Done). */
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
  isManager?: boolean;
  collected?: boolean;
  /** Current user's share-all ACL (for sidebar). */
  userGrants?: import("../model/types.js").Grant[];
  userDenies?: import("../model/types.js").Deny[];
  groups?: Array<{ id: string; title: string }>;
  entranceGroups?: Array<{ id: string; title: string; entranceSceneId: number }>;
}

export interface EditBootstrap {
  user?: { username: string };
  manage?: ManageContext;
  ownedScenes: OwnedSceneLink[];
  isManager: boolean;
  editHref: string;
  readHref: string;
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

export function renderHtmlPage(opts: HtmlShellOptions): string {
  const assetBase = opts.assetBase ?? "";
  // Resolve all relative href/src/action against the mount path ("" → "/", "/garden" → "/garden/")
  const baseHref = `${assetBase}/`;
  const user = opts.user;
  const editHref = opts.editHref ?? "?edit";
  const readHref = opts.readHref ?? "./";
  const bootstrap: EditBootstrap = {
    user: user ? { username: user.username } : undefined,
    manage: opts.manage,
    ownedScenes: opts.ownedScenes ?? [],
    isManager: opts.isManager ?? opts.manage?.isManager ?? false,
    editHref,
    readHref,
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
        ${user ? authLoggedIn(user, editHref) : authLoggedOut()}
      </div>
    </header>
    <div class="layout">
      <main class="prose">
        ${opts.bodyHtml}
      </main>
      <aside id="edit-root" class="edit-root" hidden></aside>
    </div>
  </div>
  <script type="application/json" id="edit-bootstrap">${jsonScript(bootstrap)}</script>
  <script type="module" src="assets/edit.js"></script>
</body>
</html>`;
}

function authLoggedIn(user: UserRecord, editHref: string): string {
  return `<span class="who">Signed in as <strong>${escapeHtml(user.username)}</strong></span>
    <a href="${escapeAttr(editHref)}" id="edit-enter">Edit</a>
    <a href="profile">Profile</a>
    <a href="inv">Inventory</a>
    <form method="post" action="auth/logout" class="inline">
      <button type="submit">Log out</button>
    </form>`;
}

function authLoggedOut(): string {
  return `<form method="post" action="auth/login" class="login-form">
      <label>User <input name="username" autocomplete="username" required /></label>
      <label>Pass <input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">Log in</button>
    </form>
    <details class="register">
      <summary>Register</summary>
      <form method="post" action="auth/register">
        <label>User <input name="username" autocomplete="username" required /></label>
        <label>Pass <input name="password" type="password" autocomplete="new-password" required /></label>
        <button type="submit">Create account</button>
      </form>
    </details>`;
}

export function renderSceneBodyHtml(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  /** @deprecated Links are root-relative via <base href>; kept for callers. */
  assetBase?: string;
}): string {
  const { scene, exits, artefacts, detail } = opts;

  if (detail) {
    const text = scene.details[detail];
    return `<p class="crumb"><a href="s/${scene.id}">← Scene ${scene.id}</a></p>
      <h1>${escapeHtml(scene.title ?? `Scene ${scene.id}`)} <span class="sub">detail:${escapeHtml(detail)}</span></h1>
      ${bylineHtml(scene.owner)}
      <div class="desc">${formatProse(text ?? `No detail named “${detail}”.`)}</div>`;
  }

  const detailLinks = Object.keys(scene.details)
    .sort()
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
      const goNick = `s/${scene.id}/go/${encodeURIComponent(e.nickname)}`;
      return `<li><a href="s/${scene.id}/go/${e.exitId}"><span class="exit-id">${e.exitId}</span> ${escapeHtml(e.nickname)}</a> <span class="muted">→ ${e.toSceneId}</span> <span class="muted">(<a href="${goNick}">by name</a>)</span></li>`;
    })
    .join("");

  return `<h1>${escapeHtml(scene.title ?? `Scene ${scene.id}`)} <span class="sub">#${scene.id}</span></h1>
    ${bylineHtml(scene.owner)}
    <p class="meta">${escapeHtml(scene.visibility)}${scene.isJunction ? " · junction" : ""}${
      scene.groupId ? ` · group ${escapeHtml(scene.groupId)}` : ""
    }</p>
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
    .sort()
    .map(
      (name) =>
        `<li><a href="a/${artefact.id}?${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`,
    )
    .join("");

  return `<h1>${escapeHtml(artefact.title ?? `Artefact ${artefact.id}`)} <span class="sub">#${artefact.id}</span></h1>
    ${bylineHtml(artefact.owner)}
    <p class="meta">Homed at <a href="s/${artefact.homeSceneId}">scene ${artefact.homeSceneId}</a>${
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

export function renderProfileBodyHtml(opts: {
  username: string;
  message?: string;
}): string {
  const notice = opts.message
    ? `<p class="notice" role="status">${escapeHtml(opts.message)}</p>`
    : "";
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
    </form>`;
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

function bylineHtml(owner: string): string {
  return owner ? `<p class="byline">by ${escapeHtml(owner)}</p>` : "";
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

/** JSON for a script tag: escape `<` so `</script>` in prose cannot break out. */
function jsonScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
