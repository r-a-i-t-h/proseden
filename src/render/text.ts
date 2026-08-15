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
import { entityKindLabel, entityPathPrefix } from "./entity.js";
import { relativeAge } from "./relative-age.js";
import {
  artefactPageView,
  inboxPageView,
  msgPageView,
  profilePageView,
  scenePageView,
  toText,
} from "./view/index.js";

export function renderSceneText(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  basePath?: string;
  accessSummary?: string;
  isEntrance?: boolean;
}): string {
  return toText(
    scenePageView({
      scene: opts.scene,
      exits: opts.exits,
      artefacts: opts.artefacts,
      detail: opts.detail,
      isEntrance: opts.isEntrance,
      accessSummary: opts.accessSummary,
    }).body,
    { basePath: opts.basePath },
  );
}

export function renderArtefactText(opts: {
  artefact: ArtefactRecord;
  detail?: string;
  basePath?: string;
}): string {
  return toText(
    artefactPageView({
      artefact: opts.artefact,
      detail: opts.detail,
    }).body,
    { basePath: opts.basePath },
  );
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
  return toText(profilePageView(opts).body, { basePath: opts.basePath });
}

export function renderUserProfileText(opts: {
  username: string;
  description: string;
  details: Record<string, string>;
  detail?: string;
  ownedScenes?: number;
  ownedArtefacts?: number;
  lastSeenAt?: string;
  badges?: Array<{ id: string; title: string }>;
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
    const badges = opts.badges ?? [];
    if (badges.length) {
      lines.push("Badges:");
      for (const b of badges) lines.push(`  - ${b.title} (${b.id})`);
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
  return toText(inboxPageView({ messages, message: flash, back }).body, {
    basePath,
  });
}

export function renderMsgText(
  usernames: string[],
  basePath = "",
  back?: { href: string; label: string },
  flash?: string,
): string {
  return toText(
    msgPageView({ usernames, notice: flash, back }).body,
    { basePath },
  );
}

export function renderMessageText(title: string, message: string): string {
  return `[${title}]\n\n${message}\n`;
}
