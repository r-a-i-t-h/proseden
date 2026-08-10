import type { ArtefactRecord, ExitRecord, SceneRecord, UserRecord } from "../model/types.js";

export interface HtmlShellOptions {
  title: string;
  bodyHtml: string;
  user?: UserRecord;
  assetBase?: string;
  manage?: ManageContext;
  flash?: string;
}

export interface ManageContext {
  kind: "scene" | "artefact" | "inventory" | "home";
  scene?: SceneRecord;
  artefact?: ArtefactRecord;
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
}

export function renderHtmlPage(opts: HtmlShellOptions): string {
  const assetBase = opts.assetBase ?? "";
  // Resolve all relative href/src/action against the mount path ("" → "/", "/garden" → "/garden/")
  const baseHref = `${assetBase}/`;
  const user = opts.user;
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
        ${user ? authLoggedIn(user) : authLoggedOut()}
      </div>
    </header>
    <div class="layout${user ? " with-manage" : ""}">
      <main class="prose">
        ${opts.flash ? `<p class="flash">${escapeHtml(opts.flash)}</p>` : ""}
        ${opts.bodyHtml}
      </main>
      ${user ? manageSidebar(opts.manage, user) : ""}
    </div>
  </div>
  <script type="module" src="assets/manage.js"></script>
</body>
</html>`;
}

function authLoggedIn(user: UserRecord): string {
  return `<span class="who">Signed in as <strong>${escapeHtml(user.username)}</strong></span>
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

function manageSidebar(
  manage: ManageContext | undefined,
  user?: UserRecord,
): string {
  const sections: string[] = [];
  sections.push(`<h2>Manage</h2>
    <form method="post" action="s" class="stack">
      <h3>New scene</h3>
      <label>Title <input name="title" /></label>
      <label>Body <textarea name="body" rows="4" required></textarea></label>
      <label><input type="checkbox" name="visibility" value="public" /> Public</label>
      <button type="submit">Create scene</button>
    </form>`);

  if (manage?.kind === "scene" && manage.scene) {
    const scene = manage.scene;
    if (manage.canEdit) {
      sections.push(`<form method="post" action="s/${scene.id}" class="stack" data-method="PUT">
        <h3>Edit scene ${scene.id}</h3>
        <label>Title <input name="title" value="${escapeAttr(scene.title ?? "")}" /></label>
        <label>Body <textarea name="body" rows="8" required>${escapeHtml(scene.body)}</textarea></label>
        <label>Details (JSON map) <textarea name="detailsJson" rows="4">${escapeHtml(JSON.stringify(scene.details, null, 2))}</textarea></label>
        <label><input type="checkbox" name="visibility" value="public" ${scene.visibility === "public" ? "checked" : ""} /> Public</label>
        ${
          manage.canManage
            ? `<label><input type="checkbox" name="isJunction" value="true" ${scene.isJunction ? "checked" : ""} /> Public junction</label>`
            : ""
        }
        <label><input type="checkbox" name="retainSnapshot" value="true" /> Keep version snapshot</label>
        <button type="submit">Save scene</button>
      </form>`);
      sections.push(`<p class="muted"><a href="s/${scene.id}/history">Scene history</a></p>`);
      sections.push(`<form method="post" action="a" class="stack">
        <h3>New artefact here</h3>
        <input type="hidden" name="homeSceneId" value="${scene.id}" />
        <label>Title <input name="title" /></label>
        <label>Body <textarea name="body" rows="4" required></textarea></label>
        <label>Tags (comma) <input name="tags" /></label>
        <button type="submit">Create artefact</button>
      </form>`);
    } else {
      sections.push(`<p class="muted">You can read this scene but not edit it.</p>`);
    }
    if (manage.canAddExit) {
      sections.push(`<form method="post" action="s/${scene.id}/exits" class="stack">
        <h3>Add exit</h3>
        <label>Nickname <input name="nickname" required /></label>
        <label>To scene id <input name="toSceneId" type="number" min="1" required /></label>
        <button type="submit">Add exit</button>
      </form>`);
    }
    if (manage.canManage) {
      sections.push(`<form method="post" action="s/${scene.id}/access" class="stack" data-method="PUT">
        <h3>Scene access</h3>
        <p class="muted">Grants: who + rights (read/edit/manage). Use <code>*</code> for everyone.</p>
        <label>Grants (JSON) <textarea name="grantsJson" rows="5">${escapeHtml(JSON.stringify(scene.grants ?? [], null, 2))}</textarea></label>
        <label>Denies (JSON) <textarea name="deniesJson" rows="4">${escapeHtml(JSON.stringify(scene.denies ?? [], null, 2))}</textarea></label>
        <button type="submit">Save access</button>
      </form>`);
      const groupOptions = [
        `<option value="none"${!scene.groupId ? " selected" : ""}>(none)</option>`,
        ...(manage.groups ?? []).map(
          (g) =>
            `<option value="${escapeAttr(g.id)}"${scene.groupId === g.id ? " selected" : ""}>${escapeHtml(g.title)} (#${escapeHtml(g.id)})</option>`,
        ),
      ].join("");
      sections.push(`<form method="post" action="s/${scene.id}/group" class="stack">
        <h3>Scene group</h3>
        <label>Group <select name="groupId">${groupOptions}</select></label>
        <button type="submit">Assign group</button>
      </form>`);
      sections.push(`<form method="post" action="g" class="stack">
        <h3>New group</h3>
        <label>Title <input name="title" required /></label>
        <button type="submit">Create group</button>
      </form>`);
      sections.push(`<form method="post" action="eg" class="stack">
        <h3>Entrance group</h3>
        <p class="muted">Teleporting into this set from outside lands at the entrance scene.</p>
        <label>Title <input name="title" required /></label>
        <input type="hidden" name="entranceSceneId" value="${scene.id}" />
        <button type="submit">Create with this scene as entrance</button>
      </form>`);
    } else if (manage.canOrganise) {
      sections.push(`<form method="post" action="g" class="stack">
        <h3>New group</h3>
        <label>Title <input name="title" required /></label>
        <button type="submit">Create group</button>
      </form>`);
      sections.push(`<form method="post" action="eg" class="stack">
        <h3>Entrance group</h3>
        <label>Title <input name="title" required /></label>
        <input type="hidden" name="entranceSceneId" value="${scene.id}" />
        <button type="submit">Create with this scene as entrance</button>
      </form>`);
    }
    if (manage.canDelete) {
      sections.push(`<form method="post" action="s/${scene.id}/delete" class="stack">
        <h3>Delete scene</h3>
        <button type="submit">Delete scene ${scene.id}</button>
      </form>`);
    }
  }

  if (manage?.kind === "artefact" && manage.artefact) {
    const a = manage.artefact;
    if (manage.collected) {
      sections.push(`<form method="post" action="a/${a.id}/collect/drop" class="stack">
        <button type="submit">Remove from inventory</button>
      </form>`);
    } else {
      sections.push(`<form method="post" action="a/${a.id}/collect" class="stack">
        <label>Tags (comma) <input name="tags" /></label>
        <button type="submit">Collect</button>
      </form>`);
    }
    if (manage.canEdit) {
      sections.push(`<form method="post" action="a/${a.id}" class="stack" data-method="PUT">
        <h3>Edit artefact ${a.id}</h3>
        <label>Title <input name="title" value="${escapeAttr(a.title ?? "")}" /></label>
        <label>Body <textarea name="body" rows="6" required>${escapeHtml(a.body)}</textarea></label>
        <label>Home scene <input name="homeSceneId" type="number" value="${a.homeSceneId}" required /></label>
        <label>Tags (comma) <input name="tags" value="${escapeAttr(a.tags.join(", "))}" /></label>
        <label>Details (JSON map) <textarea name="detailsJson" rows="4">${escapeHtml(JSON.stringify(a.details, null, 2))}</textarea></label>
        <label><input type="checkbox" name="retainSnapshot" value="true" /> Keep version snapshot</label>
        <button type="submit">Save artefact</button>
      </form>`);
      sections.push(`<p class="muted"><a href="a/${a.id}/history">Artefact history</a></p>`);
    }
    if (manage.canDelete) {
      sections.push(`<form method="post" action="a/${a.id}/delete" class="stack">
        <button type="submit">Delete artefact</button>
      </form>`);
    }
  }

  if (user) {
    sections.push(`<form method="post" action="u/${encodeURIComponent(user.username)}/access" class="stack" data-method="PUT">
      <h3>Share all my work</h3>
      <p class="muted">User-level grants/denies apply to every scene and group you own.</p>
      <label>Grants (JSON) <textarea name="grantsJson" rows="4">${escapeHtml(JSON.stringify(manage?.userGrants ?? user.grants ?? [], null, 2))}</textarea></label>
      <label>Denies (JSON) <textarea name="deniesJson" rows="3">${escapeHtml(JSON.stringify(manage?.userDenies ?? user.denies ?? [], null, 2))}</textarea></label>
      <button type="submit">Save share-all</button>
    </form>`);
  }

  if (manage?.isManager) {
    sections.push(`<form method="post" action="staff/" class="stack" id="staff-form">
      <h3>Assign staff role</h3>
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
    </script>`);
  }

  sections.push(`<p class="muted"><a href="inv">Open inventory</a></p>`);

  return `<aside class="manage" id="manage-sidebar">${sections.join("\n")}</aside>`;
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
}): string {
  const { artefact, detail } = opts;

  if (detail) {
    const text = artefact.details[detail];
    return `<p class="crumb"><a href="a/${artefact.id}">← Artefact ${artefact.id}</a></p>
      <h1>${escapeHtml(artefact.title ?? `Artefact ${artefact.id}`)} <span class="sub">detail:${escapeHtml(detail)}</span></h1>
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
    <p class="meta">Homed at <a href="s/${artefact.homeSceneId}">scene ${artefact.homeSceneId}</a>${
      artefact.tags.length ? ` · ${escapeHtml(artefact.tags.join(", "))}` : ""
    }</p>
    <div class="desc">${formatProse(artefact.body)}</div>
    ${detailLinks ? `<section><h2>Details</h2><ul class="link-list">${detailLinks}</ul></section>` : ""}`;
}

export function renderInventoryBodyHtml(
  items: Array<{ artefact: ArtefactRecord; tags: string[] }>,
  _assetBase = "",
): string {
  if (!items.length) {
    return `<h1>Inventory</h1><p class="muted">Empty — collect artefacts you love.</p>`;
  }
  const list = items
    .map((item) => {
      const label = item.artefact.title ?? `Artefact ${item.artefact.id}`;
      const tags = item.tags.length ? ` <span class="muted">(${escapeHtml(item.tags.join(", "))})</span>` : "";
      return `<li><a href="a/${item.artefact.id}">${escapeHtml(label)}</a>${tags}</li>`;
    })
    .join("");
  return `<h1>Inventory</h1><ul class="link-list">${list}</ul>`;
}

export function renderMessageBodyHtml(title: string, message: string): string {
  return `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`;
}

function formatProse(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
