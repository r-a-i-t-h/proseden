import { Hono } from "hono";
import type { Context } from "hono";
import { readFile } from "node:fs/promises";
import {
  apiError,
  isResponse,
  page,
  readRequestBody,
  requireManager,
  respondMutation,
  sceneBackLink,
  wantsJson,
} from "../http.js";
import { negotiateFormat } from "../render/format.js";
import {
  adminDataPageView,
  adminQuestsIndexPageView,
  formatPlainMessage,
  jsonFileEditorPageView,
  messagePageView,
} from "../render/view/index.js";
import { editorBackCrumb } from "../render/view/pages/json-editor.js";
import {
  backupPath,
  createDataBackup,
  deleteBackup,
  listBackups,
  restoreDataBackup,
  type BackupInfo,
} from "../store/backup.js";
import {
  exportAdventurePack,
  importAdventurePack,
  PackRemapError,
} from "../store/adventure-pack.js";
import { displayJsonTextarea, prepareJsonTextarea } from "../json-textarea.js";
import { parseAlchemyRecipes, parseQuestFile, QuestValidationError } from "../logic/quests.js";
import { timedAsync } from "../observe.js";
import { ALCHEMY_EXAMPLE, ALCHEMY_HELP, QUEST_EXAMPLE, QUEST_HELP } from "../render/view/examples.js";

export const adminRoutes = new Hono();

adminRoutes.get("/", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;

  const backups = await listBackups(c.get("backupDir"));
  const notice = adminNotice(
    c.req.query("backed-up"),
    c.req.query("deleted"),
    c.req.query("restored"),
    c.req.query("safety"),
    c.req.query("imported"),
  );
  const endpoints = [
    {
      method: "GET",
      path: "/data/quests",
      description: "List and edit quest JSON files (manager + personal)",
    },
    {
      method: "GET",
      path: "/data/alchemy",
      description: "Edit alchemy recipes.json",
    },
    {
      method: "GET",
      path: "/data/pack/export",
      description: "Download densified adventure pack (scenes, artefacts, quests, alchemy)",
    },
    {
      method: "POST",
      path: "/data/pack/import",
      description: "Import an adventure pack into this world (offsets ids)",
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
      path: "/data/backup/:name/restore",
      description: "Replace data/ from a data archive",
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
    adminDataPageView({ endpoints, backups, notice, back }),
  );
});

adminRoutes.get("/pack/export", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;

  const world = c.get("world");
  let result: Awaited<ReturnType<typeof exportAdventurePack>>;
  try {
    result = await timedAsync(c.get("timer"), "packExport", () =>
      exportAdventurePack(world, { title: c.req.query("title") ?? undefined }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return apiError(c, 400, message, { isManager: true });
  }

  if (wantsJson(c)) {
    return c.json({
      ok: true,
      filename: result.filename,
      manifest: result.manifest,
      size: result.buffer.length,
    });
  }

  return new Response(Uint8Array.from(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/gzip",
      "Content-Length": String(result.buffer.length),
      "Content-Disposition": `attachment; filename="${result.filename}"`,
    },
  });
});

adminRoutes.post("/pack/import", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;

  const world = c.get("world");
  const user = c.get("user")!;
  let archive: Buffer | undefined;
  let title: string | undefined;
  let owner: string | undefined = user.username;

  const contentType = c.req.header("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await c.req.json()) as {
        archiveBase64?: string;
        title?: string;
        owner?: string;
        autoRenameQuests?: boolean;
        questRenames?: Record<string, string>;
      };
      if (!body.archiveBase64) {
        return apiError(c, 400, "archiveBase64 required", { isManager: true });
      }
      archive = Buffer.from(body.archiveBase64, "base64");
      title = body.title;
      if (body.owner !== undefined) owner = body.owner || undefined;
      const result = await timedAsync(c.get("timer"), "packImport", () =>
        importAdventurePack(world, archive!, {
          title,
          owner,
          autoRenameQuests: body.autoRenameQuests,
          questRenames: body.questRenames,
        }),
      );
      return c.json({ ok: true, ...result });
    }

    const form = await c.req.parseBody();
    const file = form.pack;
    title = typeof form.title === "string" ? form.title.trim() || undefined : undefined;
    if (typeof form.owner === "string" && form.owner.trim()) {
      owner = form.owner.trim();
    }
    if (file instanceof File) {
      archive = Buffer.from(await file.arrayBuffer());
    } else if (typeof file === "string" && file) {
      archive = Buffer.from(file, "base64");
    }
    if (!archive?.length) {
      return apiError(c, 400, "Upload a pack archive (field pack)", { isManager: true });
    }

    const result = await timedAsync(c.get("timer"), "packImport", () =>
      importAdventurePack(world, archive!, { title, owner }),
    );

    if (wantsJson(c)) return c.json({ ok: true, ...result });
    const message = `Imported ${result.sceneIds.length} scenes, ${result.artefactIds.length} artefacts, quests: ${result.questNames.join(", ") || "(none)"}.`;
    if (negotiateFormat(c) === "text") {
      return c.text(formatPlainMessage("Adventure pack", message));
    }
    return c.redirect(
      `${c.get("assetBase")}/data?imported=${encodeURIComponent(String(result.sceneIds.length))}`,
    );
  } catch (err) {
    const message =
      err instanceof PackRemapError || err instanceof Error ? err.message : "Import failed";
    return apiError(c, 400, message, { isManager: true });
  }
});

adminRoutes.post("/backup", async (c) => {
  const denied = denyIfNotManager(c);
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
    return c.text(formatPlainMessage("Backup", message));
  }
  return c.redirect(`${c.get("assetBase")}/data?backed-up=${encodeURIComponent(created.name)}`);
});

adminRoutes.get("/backup/:name", async (c) => {
  const denied = denyIfNotManager(c);
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
  const denied = denyIfNotManager(c);
  if (denied) return denied;

  const name = c.req.param("name");
  if (!backupPath(c.get("backupDir"), name)) {
    return apiError(c, 400, "Invalid backup name", { isManager: true });
  }

  const removed = await deleteBackup(c.get("backupDir"), name);
  if (!removed) return apiError(c, 404, "Backup not found", { isManager: true });

  if (wantsJson(c)) return c.json({ ok: true, deleted: name });
  if (negotiateFormat(c) === "text") {
    return c.text(formatPlainMessage("Backup", `Deleted ${name}.`));
  }
  return c.redirect(`${c.get("assetBase")}/data?deleted=${encodeURIComponent(name)}`);
});

adminRoutes.post("/backup/:name/restore", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;

  const name = c.req.param("name");
  if (!backupPath(c.get("backupDir"), name)) {
    return apiError(c, 400, "Invalid backup name", { isManager: true });
  }

  const world = c.get("world");
  let result: { restored: string; safetyBackup: string };
  try {
    result = await timedAsync(c.get("timer"), "restore", () =>
      restoreDataBackup(world.dataDir, c.get("backupDir"), name),
    );
    await timedAsync(c.get("timer"), "reload", () => world.reload());
  } catch (err) {
    const message = err instanceof Error ? err.message : "Restore failed";
    return apiError(c, 400, message, { isManager: true });
  }

  if (wantsJson(c)) return c.json({ ok: true, ...result });
  const message = `Restored data from ${result.restored}. Previous data archived as ${result.safetyBackup}.`;
  if (negotiateFormat(c) === "text") {
    return c.text(formatPlainMessage("Restore", message));
  }
  return c.redirect(
    `${c.get("assetBase")}/data?restored=${encodeURIComponent(result.restored)}&safety=${encodeURIComponent(result.safetyBackup)}`,
  );
});

adminRoutes.post("/reload", async (c) => {
  const denied = denyIfNotManager(c);
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
  return page(c, 200, messagePageView("Reload", message));
});

adminRoutes.get("/quests", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const quests = world.listMasterQuests();
  const userQuests = world.listUserQuestUsernames();
  const back = sceneBackLink(c.get("user")!, world);
  const notice = c.req.query("saved")
    ? "Quest saved."
    : c.req.query("deleted")
      ? "Quest deleted."
      : "";
  if (wantsJson(c)) {
    return c.json({ quests: quests.map((q) => q.name), userQuests });
  }
  return page(
    c,
    200,
    adminQuestsIndexPageView({
      names: quests.map((q) => q.name),
      userQuests,
      notice,
      back,
    }),
  );
});

adminRoutes.post("/quests", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const body = await readRequestBody(c);
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
  return respondMutation(c, {
    json: { ok: true, name },
    redirect: `/data/quests/${encodeURIComponent(name)}`,
    status: 201,
    flash: { saved: "1" },
  });
});

adminRoutes.get("/quests/users/:username", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const username = c.req.param("username");
  const quest = world.getUserQuest(username);
  if (!quest) return apiError(c, 404, "Personal quest file not found");
  const back = sceneBackLink(c.get("user")!, world);
  const notice = c.req.query("saved") ? "Saved." : "";
  const ns = `user.${username}`;
  const example = QUEST_EXAMPLE.replaceAll("YOUR_USERNAME", ns);
  const help = `${QUEST_HELP} Personal file for ${username}: flags/badges/vars use the ${ns}.* prefix. giveArtefact still requires that user to manage the artefact home.`;
  const raw = await world.readUserQuestText(username);
  return page(
    c,
    200,
    jsonFileEditorPageView({
      title: `Quest ${ns}`,
      heading: `Quest ${ns}`,
      intro: `Personal file quests/users/${username}.json. Evaluated after manager quests.`,
      notice,
      action: `data/quests/users/${encodeURIComponent(username)}`,
      fieldLabel: "Quest JSON",
      fieldName: "json",
      value: quest,
      example,
      note: help,
      rawText: raw !== undefined ? displayJsonTextarea(raw) : undefined,
      rows: 28,
      back,
      extra: [
        {
          type: "form",
          method: "post",
          action: `data/quests/users/${encodeURIComponent(username)}/delete`,
          class: "stack",
          children: [{ type: "button", label: "Delete quest file" }],
        },
        editorBackCrumb("data/quests", "← Quests"),
      ],
    }),
  );
});

adminRoutes.post("/quests/users/:username", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const username = c.req.param("username");
  if (!world.getUser(username)) return apiError(c, 404, "User not found");
  const body = await readRequestBody(c);
  try {
    const prepared = prepareJsonTextarea(String(body.json ?? ""));
    const parsed = parseQuestFile(JSON.parse(prepared));
    await world.saveUserQuest(username, parsed, prepared);
  } catch (err) {
    const msg =
      err instanceof QuestValidationError || err instanceof SyntaxError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Save failed";
    return apiError(c, 400, msg);
  }
  return respondMutation(c, {
    json: { ok: true, username },
    redirect: `/data/quests/users/${encodeURIComponent(username)}`,
    flash: { saved: "1" },
  });
});

adminRoutes.post("/quests/users/:username/delete", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const username = c.req.param("username");
  await c.get("world").deleteUserQuest(username);
  return respondMutation(c, {
    json: { ok: true, deleted: username },
    redirect: "/data/quests",
    flash: { deleted: "1" },
  });
});

adminRoutes.get("/quests/:name", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const name = c.req.param("name");
  const quest = world.getMasterQuest(name);
  if (!quest) return apiError(c, 404, "Quest not found");
  const back = sceneBackLink(c.get("user")!, world);
  const notice = c.req.query("saved") ? "Saved." : "";
  const example = QUEST_EXAMPLE.replaceAll("YOUR_USERNAME", name);
  const help = `${QUEST_HELP} Manager file: flags/badges/vars use this quest’s name prefix (not "user").`;
  const raw = await world.readMasterQuestText(name);
  return page(
    c,
    200,
    jsonFileEditorPageView({
      title: `Quest ${name}`,
      heading: `Quest ${name}`,
      notice,
      action: `data/quests/${encodeURIComponent(name)}`,
      fieldLabel: "Quest JSON",
      fieldName: "json",
      value: quest,
      example,
      note: help,
      rawText: raw !== undefined ? displayJsonTextarea(raw) : undefined,
      rows: 28,
      back,
      extra: [
        {
          type: "form",
          method: "post",
          action: `data/quests/${encodeURIComponent(name)}/delete`,
          class: "stack",
          children: [{ type: "button", label: "Delete quest" }],
        },
        editorBackCrumb("data/quests", "← Quests"),
      ],
    }),
  );
});

adminRoutes.post("/quests/:name", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const name = c.req.param("name");
  const body = await readRequestBody(c);
  try {
    const prepared = prepareJsonTextarea(String(body.json ?? ""));
    const parsed = parseQuestFile(JSON.parse(prepared));
    if (parsed.name !== name) {
      return apiError(c, 400, `JSON name must remain "${name}"`);
    }
    await world.saveQuest(parsed, prepared);
  } catch (err) {
    const msg =
      err instanceof QuestValidationError || err instanceof SyntaxError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Save failed";
    return apiError(c, 400, msg);
  }
  return respondMutation(c, {
    json: { ok: true, name },
    redirect: `/data/quests/${encodeURIComponent(name)}`,
    flash: { saved: "1" },
  });
});

adminRoutes.post("/quests/:name/delete", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const name = c.req.param("name");
  await c.get("world").deleteQuest(name);
  return respondMutation(c, {
    json: { ok: true, deleted: name },
    redirect: "/data/quests",
    flash: { deleted: "1" },
  });
});

adminRoutes.get("/alchemy", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const back = sceneBackLink(c.get("user")!, world);
  const notice = c.req.query("saved") ? "Recipes saved." : "";
  const raw = await world.readAlchemyRecipesText();
  return page(
    c,
    200,
    jsonFileEditorPageView({
      title: "Alchemy",
      heading: "Alchemy recipes",
      intro: "Master recipes (manager). Unrestricted gives. Checked before user recipes on combine.",
      notice,
      action: "data/alchemy",
      fieldLabel: "Recipes",
      fieldName: "recipesJson",
      value: world.masterAlchemyRecipes,
      example: ALCHEMY_EXAMPLE,
      note: ALCHEMY_HELP,
      rawText: raw !== undefined ? displayJsonTextarea(raw) : undefined,
      back,
      extra: [editorBackCrumb("data", "← Data")],
    }),
  );
});

adminRoutes.post("/alchemy", async (c) => {
  const denied = denyIfNotManager(c);
  if (denied) return denied;
  const world = c.get("world");
  const body = await readRequestBody(c);
  try {
    const prepared = prepareJsonTextarea(String(body.recipesJson ?? body.json ?? ""));
    const recipes = parseAlchemyRecipes(JSON.parse(prepared));
    await world.saveAlchemyRecipes(recipes, prepared);
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Save failed");
  }
  return respondMutation(c, {
    json: { ok: true },
    redirect: "/data/alchemy",
    flash: { saved: "1" },
  });
});

function denyIfNotManager(c: Context) {
  const user = requireManager(c);
  return isResponse(user) ? user : undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function adminNotice(
  backedUp?: string,
  deleted?: string,
  restored?: string,
  safety?: string,
  imported?: string,
): string {
  if (backedUp) return `Archived data to ${backedUp}.`;
  if (deleted) return `Deleted ${deleted}.`;
  if (restored) {
    const safetyNote = safety ? ` Previous data archived as ${safety}.` : "";
    return `Restored data from ${restored}.${safetyNote}`;
  }
  if (imported) return `Imported adventure pack (${imported} scenes).`;
  return "";
}
