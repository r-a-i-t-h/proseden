import type { ArtefactRecord, ExitRecord, NodeRecord, UserRecord } from "../model/types.js";

export interface HtmlShellOptions {
  title: string;
  bodyHtml: string;
  user?: UserRecord;
  assetBase?: string;
  manage?: ManageContext;
  flash?: string;
}

export interface ManageContext {
  kind: "node" | "artefact" | "inventory" | "home";
  node?: NodeRecord;
  artefact?: ArtefactRecord;
  canEdit?: boolean;
  collected?: boolean;
}

export function renderHtmlPage(opts: HtmlShellOptions): string {
  const assetBase = opts.assetBase ?? ".";
  const user = opts.user;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)} — Proseden</title>
  <link rel="stylesheet" href="${assetBase}/assets/styles.css" />
</head>
<body>
  <div class="app">
    <header class="top">
      <a class="brand" href="${assetBase}/">Proseden</a>
      <div class="auth" id="auth-panel">
        ${user ? authLoggedIn(user, assetBase) : authLoggedOut(assetBase)}
      </div>
    </header>
    <div class="layout${user ? " with-manage" : ""}">
      <main class="prose">
        ${opts.flash ? `<p class="flash">${escapeHtml(opts.flash)}</p>` : ""}
        ${opts.bodyHtml}
      </main>
      ${user ? manageSidebar(opts.manage, assetBase) : ""}
    </div>
  </div>
  <script type="module" src="${assetBase}/assets/manage.js"></script>
</body>
</html>`;
}

function authLoggedIn(user: UserRecord, assetBase: string): string {
  return `<span class="who">Signed in as <strong>${escapeHtml(user.username)}</strong></span>
    <a href="${assetBase}/inv">Inventory</a>
    <form method="post" action="${assetBase}/auth/logout" class="inline">
      <button type="submit">Log out</button>
    </form>`;
}

function authLoggedOut(assetBase: string): string {
  return `<form method="post" action="${assetBase}/auth/login" class="login-form">
      <label>User <input name="username" autocomplete="username" required /></label>
      <label>Pass <input name="password" type="password" autocomplete="current-password" required /></label>
      <button type="submit">Log in</button>
    </form>
    <details class="register">
      <summary>Register</summary>
      <form method="post" action="${assetBase}/auth/register">
        <label>User <input name="username" autocomplete="username" required /></label>
        <label>Pass <input name="password" type="password" autocomplete="new-password" required /></label>
        <button type="submit">Create account</button>
      </form>
    </details>`;
}

function manageSidebar(manage: ManageContext | undefined, assetBase: string): string {
  const sections: string[] = [];
  sections.push(`<h2>Manage</h2>
    <form method="post" action="${assetBase}/n" class="stack">
      <h3>New node</h3>
      <label>Title <input name="title" /></label>
      <label>Body <textarea name="body" rows="4" required></textarea></label>
      <label><input type="checkbox" name="visibility" value="public" /> Public</label>
      <button type="submit">Create node</button>
    </form>`);

  if (manage?.kind === "node" && manage.node) {
    const node = manage.node;
    if (manage.canEdit) {
      sections.push(`<form method="post" action="${assetBase}/n/${node.id}" class="stack" data-method="PUT">
        <h3>Edit node ${node.id}</h3>
        <label>Title <input name="title" value="${escapeAttr(node.title ?? "")}" /></label>
        <label>Body <textarea name="body" rows="8" required>${escapeHtml(node.body)}</textarea></label>
        <label>Details (JSON map) <textarea name="detailsJson" rows="4">${escapeHtml(JSON.stringify(node.details, null, 2))}</textarea></label>
        <label><input type="checkbox" name="visibility" value="public" ${node.visibility === "public" ? "checked" : ""} /> Public</label>
        <button type="submit">Save node</button>
      </form>`);
      sections.push(`<form method="post" action="${assetBase}/n/${node.id}/exits" class="stack">
        <h3>Add exit</h3>
        <label>Nickname <input name="nickname" required /></label>
        <label>To node id <input name="toNodeId" type="number" min="1" required /></label>
        <button type="submit">Add exit</button>
      </form>`);
      sections.push(`<form method="post" action="${assetBase}/a" class="stack">
        <h3>New artefact here</h3>
        <input type="hidden" name="homeNodeId" value="${node.id}" />
        <label>Title <input name="title" /></label>
        <label>Body <textarea name="body" rows="4" required></textarea></label>
        <label>Tags (comma) <input name="tags" /></label>
        <button type="submit">Create artefact</button>
      </form>`);
    } else {
      sections.push(`<p class="muted">You can read this node but not edit it.</p>`);
    }
  }

  if (manage?.kind === "artefact" && manage.artefact) {
    const a = manage.artefact;
    if (manage.collected) {
      sections.push(`<form method="post" action="${assetBase}/a/${a.id}/collect/drop" class="stack">
        <button type="submit">Remove from inventory</button>
      </form>`);
    } else {
      sections.push(`<form method="post" action="${assetBase}/a/${a.id}/collect" class="stack">
        <label>Tags (comma) <input name="tags" /></label>
        <button type="submit">Collect</button>
      </form>`);
    }
    if (manage.canEdit) {
      sections.push(`<form method="post" action="${assetBase}/a/${a.id}" class="stack" data-method="PUT">
        <h3>Edit artefact ${a.id}</h3>
        <label>Title <input name="title" value="${escapeAttr(a.title ?? "")}" /></label>
        <label>Body <textarea name="body" rows="6" required>${escapeHtml(a.body)}</textarea></label>
        <label>Home node <input name="homeNodeId" type="number" value="${a.homeNodeId}" required /></label>
        <label>Tags (comma) <input name="tags" value="${escapeAttr(a.tags.join(", "))}" /></label>
        <label>Details (JSON map) <textarea name="detailsJson" rows="4">${escapeHtml(JSON.stringify(a.details, null, 2))}</textarea></label>
        <button type="submit">Save artefact</button>
      </form>`);
    }
  }

  sections.push(`<p class="muted"><a href="${assetBase}/inv">Open inventory</a></p>`);

  return `<aside class="manage" id="manage-sidebar">${sections.join("\n")}</aside>`;
}

export function renderNodeBodyHtml(opts: {
  node: NodeRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  assetBase?: string;
}): string {
  const base = opts.assetBase ?? "";
  const { node, exits, artefacts, detail } = opts;

  if (detail) {
    const text = node.details[detail];
    return `<p class="crumb"><a href="${base}/n/${node.id}">← Node ${node.id}</a></p>
      <h1>${escapeHtml(node.title ?? `Node ${node.id}`)} <span class="sub">detail:${escapeHtml(detail)}</span></h1>
      <div class="desc">${formatProse(text ?? `No detail named “${detail}”.`)}</div>`;
  }

  const detailLinks = Object.keys(node.details)
    .sort()
    .map(
      (name) =>
        `<li><a href="${base}/n/${node.id}?${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`,
    )
    .join("");

  const artefactLinks = artefacts
    .map((a) => {
      const label = a.title ?? `Artefact ${a.id}`;
      return `<li><a href="${base}/a/${a.id}">${escapeHtml(label)}</a></li>`;
    })
    .join("");

  const exitLinks = exits
    .map((e) => {
      return `<li><a href="${base}/n/${e.toNodeId}"><span class="exit-id">${e.exitId}</span> ${escapeHtml(e.nickname)}</a></li>`;
    })
    .join("");

  return `<h1>${escapeHtml(node.title ?? `Node ${node.id}`)} <span class="sub">#${node.id}</span></h1>
    <p class="meta">${escapeHtml(node.visibility)}</p>
    <div class="desc">${formatProse(node.body)}</div>
    ${detailLinks ? `<section><h2>Details</h2><ul class="link-list">${detailLinks}</ul></section>` : ""}
    ${artefactLinks ? `<section><h2>Artefacts</h2><ul class="link-list">${artefactLinks}</ul></section>` : ""}
    ${exitLinks ? `<section><h2>Exits</h2><ul class="link-list">${exitLinks}</ul></section>` : ""}`;
}

export function renderArtefactBodyHtml(opts: {
  artefact: ArtefactRecord;
  detail?: string;
  assetBase?: string;
}): string {
  const base = opts.assetBase ?? "";
  const { artefact, detail } = opts;

  if (detail) {
    const text = artefact.details[detail];
    return `<p class="crumb"><a href="${base}/a/${artefact.id}">← Artefact ${artefact.id}</a></p>
      <h1>${escapeHtml(artefact.title ?? `Artefact ${artefact.id}`)} <span class="sub">detail:${escapeHtml(detail)}</span></h1>
      <div class="desc">${formatProse(text ?? `No detail named “${detail}”.`)}</div>`;
  }

  const detailLinks = Object.keys(artefact.details)
    .sort()
    .map(
      (name) =>
        `<li><a href="${base}/a/${artefact.id}?${encodeURIComponent(name)}">${escapeHtml(name)}</a></li>`,
    )
    .join("");

  return `<h1>${escapeHtml(artefact.title ?? `Artefact ${artefact.id}`)} <span class="sub">#${artefact.id}</span></h1>
    <p class="meta">Homed at <a href="${base}/n/${artefact.homeNodeId}">node ${artefact.homeNodeId}</a>${
      artefact.tags.length ? ` · ${escapeHtml(artefact.tags.join(", "))}` : ""
    }</p>
    <div class="desc">${formatProse(artefact.body)}</div>
    ${detailLinks ? `<section><h2>Details</h2><ul class="link-list">${detailLinks}</ul></section>` : ""}`;
}

export function renderInventoryBodyHtml(
  items: Array<{ artefact: ArtefactRecord; tags: string[] }>,
  assetBase = "",
): string {
  if (!items.length) {
    return `<h1>Inventory</h1><p class="muted">Empty — collect artefacts you love.</p>`;
  }
  const list = items
    .map((item) => {
      const label = item.artefact.title ?? `Artefact ${item.artefact.id}`;
      const tags = item.tags.length ? ` <span class="muted">(${escapeHtml(item.tags.join(", "))})</span>` : "";
      return `<li><a href="${assetBase}/a/${item.artefact.id}">${escapeHtml(label)}</a>${tags}</li>`;
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
