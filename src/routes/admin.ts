import { Hono } from "hono";
import type { Context } from "hono";
import { readFile } from "node:fs/promises";
import { isManager } from "../access/permissions.js";
import {
  apiError,
  page,
  sceneBackLink,
  wantsJson,
} from "../http.js";
import { negotiateFormat } from "../render/format.js";
import {
  escapeHtml,
  renderJsonFieldHtml,
  renderMessageBodyHtml,
  renderPageBackCrumb,
  type PageBackLink,
} from "../render/html.js";
import { renderMessageText } from "../render/text.js";
import {
  backupPath,
  createDataBackup,
  deleteBackup,
  listBackups,
  type BackupInfo,
} from "../store/backup.js";
import { formatJsonTextarea, prepareJsonTextarea } from "../json-textarea.js";
import { parseAlchemyRecipes, parseQuestFile, QuestValidationError } from "../logic/quests.js";
import { timedAsync } from "../observe.js";
import { ALCHEMY_EXAMPLE, ALCHEMY_HELP } from "../render/view/examples.js";

export const adminRoutes = new Hono();

adminRoutes.get("/", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  const backups = await listBackups(c.get("backupDir"));
  const notice = adminNotice(c.req.query("backed-up"), c.req.query("deleted"));
  const endpoints = [
    {
      method: "GET",
      path: "/data/quests",
      description: "List and edit quest JSON files",
    },
    {
      method: "GET",
      path: "/data/alchemy",
      description: "Edit alchemy recipes.json",
    },
    {
      method: "POST",
      path: "/data/backup",
      description: "Archive data/ into backup/",
    },
    {
      method: "GET",
      path: "/data/backup/:name",
      description: "Download a data archive",
    },
    {
      method: "POST",
      path: "/data/backup/:name/delete",
      description: "Delete a data archive",
    },
    {
      method: "POST",
      path: "/data/reload",
      description: "Reload the in-memory world cache from disk",
    },
  ];

  if (wantsJson(c)) return c.json({ ok: true, endpoints, backups });
  const user = c.get("user")!;
  const world = c.get("world");
  const back = sceneBackLink(user, world);
  return page(
    c,
    200,
    "Data",
    renderAdminHtml(endpoints, backups, notice, back),
    renderMessageText("Data", formatAdminText(endpoints, backups)),
  );
});

adminRoutes.post("/backup", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  const world = c.get("world");
  let created: BackupInfo;
  try {
    created = await timedAsync(c.get("timer"), "backup", () =>
      createDataBackup(world.dataDir, c.get("backupDir")),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Backup failed";
    return apiError(c, 400, message, { isManager: true });
  }

  if (wantsJson(c)) return c.json({ ok: true, ...created });
  const message = `Archived data to ${created.name} (${formatBytes(created.size)}).`;
  if (negotiateFormat(c) === "text") {
    return c.text(renderMessageText("Backup", message));
  }
  return c.redirect(`${c.get("assetBase")}/data?backed-up=${encodeURIComponent(created.name)}`);
});

adminRoutes.get("/backup/:name", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  const name = c.req.param("name");
  const path = backupPath(c.get("backupDir"), name);
  if (!path) return apiError(c, 400, "Invalid backup name", { isManager: true });

  let bytes: Buffer;
  try {
    bytes = await timedAsync(c.get("timer"), "backupRead", () => readFile(path));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return apiError(c, 404, "Backup not found", { isManager: true });
    throw err;
  }

  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
});

adminRoutes.post("/backup/:name/delete", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  const name = c.req.param("name");
  if (!backupPath(c.get("backupDir"), name)) {
    return apiError(c, 400, "Invalid backup name", { isManager: true });
  }

  const removed = await deleteBackup(c.get("backupDir"), name);
  if (!removed) return apiError(c, 404, "Backup not found", { isManager: true });

  if (wantsJson(c)) return c.json({ ok: true, deleted: name });
  if (negotiateFormat(c) === "text") {
    return c.text(renderMessageText("Backup", `Deleted ${name}.`));
  }
  return c.redirect(`${c.get("assetBase")}/data?deleted=${encodeURIComponent(name)}`);
});

adminRoutes.post("/reload", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;

  const world = c.get("world");
  await timedAsync(c.get("timer"), "reload", () => world.reload());

  const summary = {
    ok: true as const,
    users: world.users.size,
    scenes: world.scenes.size,
    artefacts: world.artefacts.size,
    groups: world.groups.size,
    entranceGroups: world.entranceGroups.size,
  };

  if (wantsJson(c)) return c.json(summary);
  const message = `Reloaded from disk: ${summary.scenes} scenes, ${summary.artefacts} artefacts, ${summary.users} users.`;
  return page(
    c,
    200,
    "Reload",
    renderMessageBodyHtml("Reload", message),
    renderMessageText("Reload", message),
  );
});

adminRoutes.get("/quests", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const quests = world.listMasterQuests();
  const back = sceneBackLink(c.get("user")!, world);
  const notice = c.req.query("saved")
    ? "Quest saved."
    : c.req.query("deleted")
      ? "Quest deleted."
      : "";
  if (wantsJson(c)) return c.json({ quests: quests.map((q) => q.name) });
  const links = quests.length
    ? `<ul class="link-list">${quests
        .map((q) => `<li><a href="data/quests/${encodeURIComponent(q.name)}">${escapeHtml(q.name)}</a></li>`)
        .join("")}</ul>`
    : `<p class="muted">No quests yet.</p>`;
  return page(
    c,
    200,
    "Quests",
    `${renderPageBackCrumb(back)}<h1>Quests</h1>
      <p class="muted">Manager quest files in <code>quests/&lt;name&gt;.json</code>. Evaluated before questor personal files.</p>
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
      ${links}
      <h2>New quest</h2>
      <form method="post" action="data/quests" class="stack">
        <label>Name <input name="name" pattern="[A-Za-z][A-Za-z0-9_-]*" required /></label>
        <button type="submit">Create</button>
      </form>
      <p class="crumb"><a href="data">← Data</a></p>`,
    renderMessageText("Quests", quests.map((q) => q.name).join("\n") || "(none)"),
  );
});

adminRoutes.post("/quests", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const body = await c.req.parseBody();
  const name = String(body.name ?? "").trim();
  try {
    const quest = parseQuestFile({
      name,
      rules: [],
      description: "New quest",
    });
    if (world.getMasterQuest(name)) return apiError(c, 400, "Quest already exists");
    await world.saveQuest(quest);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Invalid quest");
  }
  return c.redirect(`${c.get("assetBase")}/data/quests/${encodeURIComponent(name)}?saved=1`);
});

adminRoutes.get("/quests/:name", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const name = c.req.param("name");
  const quest = world.getMasterQuest(name);
  if (!quest) return apiError(c, 404, "Quest not found");
  const back = sceneBackLink(c.get("user")!, world);
  const notice = c.req.query("saved") ? "Saved." : "";
  const json = formatJsonTextarea(quest);
  return page(
    c,
    200,
    `Quest ${name}`,
    `${renderPageBackCrumb(back)}<h1>Quest <code>${escapeHtml(name)}</code></h1>
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
      <form method="post" action="data/quests/${encodeURIComponent(name)}" class="stack">
        <label>JSON
          <textarea name="json" rows="28" data-editor="json">${escapeHtml(json)}</textarea>
        </label>
        <button type="submit">Save</button>
      </form>
      <form method="post" action="data/quests/${encodeURIComponent(name)}/delete" class="stack"
        onsubmit="return confirm('Delete quest ${escapeHtml(name)}?');">
        <button type="submit">Delete quest</button>
      </form>
      <p class="crumb"><a href="data/quests">← Quests</a></p>`,
    renderMessageText(`Quest ${name}`, json),
  );
});

adminRoutes.post("/quests/:name", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const name = c.req.param("name");
  const body = await c.req.parseBody();
  try {
    const prepared = prepareJsonTextarea(String(body.json ?? ""));
    const parsed = parseQuestFile(JSON.parse(prepared));
    if (parsed.name !== name) {
      return apiError(c, 400, `JSON name must remain "${name}"`);
    }
    await world.saveQuest(parsed);
  } catch (err) {
    const msg =
      err instanceof QuestValidationError || err instanceof SyntaxError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Save failed";
    return apiError(c, 400, msg);
  }
  return c.redirect(`${c.get("assetBase")}/data/quests/${encodeURIComponent(name)}?saved=1`);
});

adminRoutes.post("/quests/:name/delete", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  await c.get("world").deleteQuest(c.req.param("name"));
  return c.redirect(`${c.get("assetBase")}/data/quests?deleted=1`);
});

adminRoutes.get("/alchemy", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const back = sceneBackLink(c.get("user")!, world);
  const notice = c.req.query("saved") ? "Recipes saved." : "";
  const field = renderJsonFieldHtml(
    "Recipes",
    "recipesJson",
    24,
    world.masterAlchemyRecipes,
    ALCHEMY_EXAMPLE,
    ALCHEMY_HELP,
  );
  return page(
    c,
    200,
    "Alchemy",
    `${renderPageBackCrumb(back)}<h1>Alchemy recipes</h1>
      <p class="muted">Master recipes (manager). Unrestricted gives. Checked before user recipes on combine.</p>
      ${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
      <form method="post" action="data/alchemy" class="stack">
        ${field}
        <button type="submit">Save</button>
      </form>
      <p class="crumb"><a href="data">← Data</a></p>`,
    renderMessageText("Alchemy", JSON.stringify(world.masterAlchemyRecipes, null, 2)),
  );
});

adminRoutes.post("/alchemy", async (c) => {
  const denied = requireManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const body = await c.req.parseBody();
  try {
    const prepared = prepareJsonTextarea(String(body.recipesJson ?? body.json ?? ""));
    const recipes = parseAlchemyRecipes(JSON.parse(prepared));
    await world.saveAlchemyRecipes(recipes);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Save failed");
  }
  return c.redirect(`${c.get("assetBase")}/data/alchemy?saved=1`);
});

function requireManager(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required", { isManager: false });
  }
  return null;
}

function formatAdminText(
  endpoints: Array<{ method: string; path: string; description: string }>,
  backups: BackupInfo[],
): string {
  const lines = endpoints.map((e) => `${e.method} ${e.path} — ${e.description}`);
  lines.push("", "Backups:");
  if (!backups.length) lines.push("  (none)");
  else {
    for (const b of backups) {
      lines.push(`  ${b.name}  ${formatBytes(b.size)}  ${b.mtime}`);
    }
  }
  return lines.join("\n");
}

function adminNotice(backedUp?: string, deleted?: string): string {
  if (backedUp) return `Archived data to ${backedUp}.`;
  if (deleted) return `Deleted ${deleted}.`;
  return "";
}

function renderAdminHtml(
  endpoints: Array<{ method: string; path: string; description: string }>,
  backups: BackupInfo[],
  notice = "",
  back?: PageBackLink,
): string {
  const list = endpoints
    .map((e) => `<li><code>${escapeHtml(e.method)} ${escapeHtml(e.path)}</code> — ${escapeHtml(e.description)}</li>`)
    .join("");

  const rows = backups.length
    ? backups
        .map((b) => {
          const href = `data/backup/${encodeURIComponent(b.name)}`;
          return `<tr>
            <td><code>${escapeHtml(b.name)}</code></td>
            <td>${escapeHtml(formatBytes(b.size))}</td>
            <td>${escapeHtml(b.mtime)}</td>
            <td class="backup-actions">
              <a href="${href}">Download</a>
              <form method="post" action="${href}/delete" class="inline">
                <button type="submit">Delete</button>
              </form>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="muted">No archives yet.</td></tr>`;

  const flash = notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : "";
  return `${renderPageBackCrumb(back)}<h1>Data</h1>
    ${flash}
    <p class="muted"><a href="data/quests">Quests</a> · <a href="data/alchemy">Alchemy recipes</a></p>
    <ul class="link-list">${list}</ul>
    <h2>Data backups</h2>
    <p class="muted">Archives <code>data/</code> only (not the app). Updates also write one here first.</p>
    <form method="post" action="data/backup" class="stack">
      <button type="submit">Backup now</button>
    </form>
    <table class="backup-table">
      <thead>
        <tr><th>File</th><th>Size</th><th>Modified</th><th></th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>World cache</h2>
    <form method="post" action="data/reload" class="stack">
      <button type="submit">Reload world from disk</button>
    </form>`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
