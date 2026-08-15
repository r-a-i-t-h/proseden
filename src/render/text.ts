import { formatAccessSummary } from "../access/acl.js";
import type {
  ArtefactRecord,
  Deny,
  EditLogEntry,
  EntityKind,
  ExitRecord,
  Grant,
  InboxMessage,
  SceneRecord,
} from "../model/types.js";
import { relativeAge } from "./relative-age.js";

function bylineText(owner: string | undefined, base: string): string | undefined {
  if (!owner) return undefined;
  return `by ${owner}  ${base}/u/${encodeURIComponent(owner)}`;
}

function entityKindLabel(kind: EntityKind): string {
  return kind === "scene" ? "Scene" : "Artefact";
}

function entityPathPrefix(kind: EntityKind): string {
  return kind === "scene" ? "s" : "a";
}

function entityTextTitle(
  kind: EntityKind,
  id: number,
  title?: string,
  detail?: string,
): string {
  const name = title ? `: ${title}` : "";
  const kindCap = entityKindLabel(kind);
  if (detail) return `[${kindCap} ${id}${name} — detail:${detail}]`;
  return `[${kindCap} ${id}${name}]`;
}

function appendDetailLines(
  lines: string[],
  kind: EntityKind,
  id: number,
  details: Record<string, string>,
  base: string,
): void {
  const detailNames = Object.keys(details);
  if (!detailNames.length) return;
  const prefix = entityPathPrefix(kind);
  lines.push("Details:");
  for (const name of detailNames) {
    lines.push(`  - ${name}  ${base}/${prefix}/${id}?${encodeURIComponent(name)}`);
  }
  lines.push("");
}

export function renderSceneText(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  basePath?: string;
  accessSummary?: string;
  /** True when this scene is the landing scene of an entrance group. */
  isEntrance?: boolean;
}): string {
  const base = opts.basePath ?? "";
  const { scene, exits, artefacts, detail } = opts;
  const lines: string[] = [];

  if (detail) {
    const text = scene.details[detail];
    lines.push(entityTextTitle("scene", scene.id, scene.title, detail));
    if (scene.owner) lines.push(bylineText(scene.owner, base)!);
    lines.push("");
    lines.push(text ?? `(No detail named "${detail}".)`);
  } else {
    lines.push(entityTextTitle("scene", scene.id, scene.title));
    if (scene.owner) lines.push(bylineText(scene.owner, base)!);
    {
      const tags: string[] = [scene.visibility];
      if (scene.isJunction && scene.visibility === "public") tags.push("junction");
      if (opts.isEntrance) tags.push("entrance");
      lines.push(`visibility: ${tags.join(" · ")}`);
    }
    lines.push("");
    lines.push(scene.body);
    lines.push("");
    appendDetailLines(lines, "scene", scene.id, scene.details, base);
    if (artefacts.length) {
      lines.push("Artefacts:");
      for (const a of artefacts) {
        const label = a.title ?? `artefact ${a.id}`;
        lines.push(`  ${a.id}. ${label}  ${base}/a/${a.id}`);
      }
      lines.push("");
    }
    if (exits.length) {
      lines.push("Exits:");
      for (const e of exits) {
        lines.push(`  - ${e.nickname}  ${base}/s/${scene.id}/go/${e.exitId}`);
      }
      lines.push("");
    }
    lines.push("Actions:");
    lines.push(`  Teleport: GET ${base}/s/<id>?from=${scene.id}`);
    lines.push(`  Invite to view: POST ${base}/s/${scene.id}/view-invites`);
    lines.push("");
    if (opts.accessSummary) {
      lines.push("Access:");
      for (const line of opts.accessSummary.split("\n")) {
        lines.push(`  ${line}`);
      }
      lines.push("");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderArtefactText(opts: {
  artefact: ArtefactRecord;
  detail?: string;
  basePath?: string;
}): string {
  const base = opts.basePath ?? "";
  const { artefact, detail } = opts;
  const lines: string[] = [];

  if (detail) {
    const text = artefact.details[detail];
    lines.push(entityTextTitle("artefact", artefact.id, artefact.title, detail));
    if (artefact.owner) lines.push(bylineText(artefact.owner, base)!);
    lines.push("");
    lines.push(text ?? `(No detail named "${detail}".)`);
  } else {
    lines.push(entityTextTitle("artefact", artefact.id, artefact.title));
    if (artefact.owner) lines.push(bylineText(artefact.owner, base)!);
    lines.push(`home: ${base}/s/${artefact.homeSceneId}?from=${artefact.homeSceneId}`);
    if (artefact.tags.length) lines.push(`tags: ${artefact.tags.join(", ")}`);
    lines.push("");
    lines.push(artefact.body);
    lines.push("");
    appendDetailLines(lines, "artefact", artefact.id, artefact.details, base);
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderEditHistoryText(opts: {
  kind: EntityKind;
  id: number;
  log: EditLogEntry[];
  basePath?: string;
}): string {
  const base = opts.basePath ?? "";
  const prefix = entityPathPrefix(opts.kind);
  const title = `History · ${entityKindLabel(opts.kind)} ${opts.id}`;
  const lines = opts.log.length
    ? opts.log
        .map((e) => {
          const snap = e.versionId
            ? `  snapshot: ${base}/${prefix}/${opts.id}/history/${encodeURIComponent(e.versionId)}`
            : "";
          return `${e.at} by ${e.by}  ${base}/u/${encodeURIComponent(e.by)} [${e.fields.join(", ") || "—"}]${e.retained ? " (retained)" : ""}${snap ? `\n${snap}` : ""}`;
        })
        .join("\n")
    : "(no edits logged)";
  return renderMessageText(title, lines);
}

export function renderSnapshotText(opts: {
  kind: EntityKind;
  id: number;
  versionId: string;
  body: string;
  title?: string;
}): string {
  const message =
    opts.kind === "scene"
      ? `${opts.title ?? `Scene ${opts.id}`}\n\n${opts.body}\n`
      : opts.body;
  return renderMessageText(`Snapshot ${opts.versionId}`, message);
}

export function renderProfileText(opts: {
  username: string;
  message?: string;
  description?: string;
  details?: Record<string, string>;
  basePath?: string;
  grants?: Grant[];
  denies?: Deny[];
  back?: { href: string; label: string };
}): string {
  const base = opts.basePath ?? "";
  const lines = ["[Profile]", ""];
  if (opts.back) {
    lines.push(`${opts.back.label}  ${base}/${opts.back.href.replace(/^\.\//, "")}`, "");
  }
  lines.push(`Signed in as ${opts.username}`, "");
  if (opts.message) {
    lines.push(opts.message, "");
  }
  lines.push("Appearance:");
  if (opts.description?.trim()) {
    lines.push(opts.description, "");
  }
  const detailNames = Object.keys(opts.details ?? {});
  if (detailNames.length) {
    lines.push("Details:");
    for (const name of detailNames) {
      lines.push(`  - ${name}`);
    }
    lines.push("");
  }
  lines.push(`  POST ${base}/profile`);
  lines.push("  description, detailsJson");
  lines.push("");
  lines.push("Password:");
  lines.push(`  POST ${base}/auth/password`);
  lines.push("  currentPassword, newPassword, confirmPassword");
  lines.push("");
  lines.push("Sharing (every scene and group you own):");
  lines.push(`  POST ${base}/u/${opts.username}/access`);
  lines.push("  grantsJson, deniesJson");
  lines.push("");
  lines.push(formatAccessSummary(opts.grants, opts.denies));
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderUserProfileText(opts: {
  username: string;
  description: string;
  details: Record<string, string>;
  detail?: string;
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
  basePath?: string;
  back?: { href: string; label: string };
}): string {
  const base = opts.basePath ?? "";
  const path = `${base}/u/${encodeURIComponent(opts.username)}`;
  const lines: string[] = [];
  if (opts.detail) {
    lines.push(`[User ${opts.username} — detail:${opts.detail}]`);
    if (opts.back) {
      lines.push(`${opts.back.label}  ${base}/${opts.back.href.replace(/^\.\//, "")}`);
    }
    lines.push(`← ${opts.username}  ${path}`, "");
    lines.push(opts.details[opts.detail] ?? `(No detail named "${opts.detail}".)`);
  } else {
    lines.push(`[User ${opts.username}]`);
    if (opts.back) {
      lines.push(`${opts.back.label}  ${base}/${opts.back.href.replace(/^\.\//, "")}`);
    }
    const meta = userProfileMetaText(opts);
    if (meta) lines.push(meta);
    lines.push("");
    lines.push(opts.description.trim() || "(No description yet.)");
    lines.push("");
    const detailNames = Object.keys(opts.details);
    if (detailNames.length) {
      lines.push("Details:");
      for (const name of detailNames) {
        lines.push(`  - ${name}  ${path}?${encodeURIComponent(name)}`);
      }
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function userProfileMetaText(opts: {
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
}): string {
  const parts: string[] = [];
  if (opts.ownedScenes !== undefined) {
    parts.push(`${opts.ownedScenes} ${opts.ownedScenes === 1 ? "scene" : "scenes"}`);
  }
  if (opts.ownedArtefacts !== undefined) {
    parts.push(`${opts.ownedArtefacts} ${opts.ownedArtefacts === 1 ? "artefact" : "artefacts"}`);
  }
  if (opts.lastSeenAt) {
    parts.push(`last seen ${relativeAge(opts.lastSeenAt)}`);
  }
  return parts.join(" · ");
}

export function renderGroupsIndexText(
  managed: Array<{ id: string; title: string; owner: string; sceneCount: number }>,
  readable: Array<{ id: string; title: string; owner: string; sceneCount: number }>,
  basePath = "",
  back?: { href: string; label: string },
): string {
  const lines = ["[Groups]", ""];
  if (back) lines.push(`${back.label}  ${basePath}/${back.href.replace(/^\.\//, "")}`, "");
  const pushList = (heading: string, groups: typeof managed) => {
    if (!groups.length) return;
    lines.push(heading);
    for (const group of groups) {
      lines.push(
        `  ${group.id}. ${group.title} (${group.owner}, ${group.sceneCount} scenes)  ${basePath}/g/${group.id}`,
      );
    }
    lines.push("");
  };
  pushList("Manage:", managed);
  pushList("Also visible:", readable);
  if (!managed.length && !readable.length) lines.push("(none)");
  lines.push(`Create: POST ${basePath}/g  title`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderInventoryText(
  items: ArtefactRecord[],
  basePath = "",
  back?: { href: string; label: string },
): string {
  const lines = ["[Inventory]", ""];
  if (back) lines.push(`${back.label}  ${basePath}/${back.href.replace(/^\.\//, "")}`, "");
  if (!items.length) {
    lines.push("(empty)");
  } else {
    for (const artefact of items) {
      const label = artefact.title ?? `artefact ${artefact.id}`;
      const tags = artefact.tags.length ? ` [${artefact.tags.join(", ")}]` : "";
      lines.push(`  ${artefact.id}. ${label}${tags}  ${basePath}/a/${artefact.id}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderInboxText(
  messages: InboxMessage[],
  basePath = "",
  back?: { href: string; label: string },
  flash?: string,
): string {
  const lines = ["[Inbox]", ""];
  if (back) lines.push(`${back.label}  ${basePath}/${back.href.replace(/^\.\//, "")}`, "");
  if (flash) lines.push(flash, "");
  if (!messages.length) {
    lines.push("(empty)");
  } else {
    for (const msg of messages) {
      lines.push(`— ${msg.createdAt} from ${msg.fromUser}`);
      lines.push(msg.subject);
      lines.push(msg.body);
      if (msg.type === "exit_request") {
        lines.push(`  Confirm: POST ${basePath}/inbox/${msg.id}/confirm`);
      }
      if (msg.type === "invite_to_view") {
        lines.push(`  View: GET ${basePath}/s/${msg.sceneId}`);
      }
      lines.push(`  Delete: POST ${basePath}/inbox/${msg.id}/delete`);
      lines.push("");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderMsgText(
  usernames: string[],
  basePath = "",
  back?: { href: string; label: string },
  flash?: string,
): string {
  const lines = ["[Msg]", ""];
  if (back) lines.push(`${back.label}  ${basePath}/${back.href.replace(/^\.\//, "")}`, "");
  if (flash) lines.push(flash, "");
  lines.push("Send a free-text note to one reader or everyone.");
  lines.push(
    "Line breaks and prose adornments are kept: _emphasis_, *bold*, ~strike~, ---, and [links](https://…).",
  );
  lines.push("");
  lines.push(`POST ${basePath}/msg`);
  lines.push("  to: username or * (ALL users)");
  lines.push("  body: message text");
  lines.push("");
  lines.push("Users:");
  if (!usernames.length) lines.push("  (none)");
  else for (const name of usernames) lines.push(`  ${name}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderMessageText(title: string, message: string): string {
  return `[${title}]\n\n${message}\n`;
}
