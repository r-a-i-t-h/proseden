import { formatAccessSummary } from "../access/acl.js";
import type { ArtefactRecord, Deny, ExitRecord, Grant, SceneRecord } from "../model/types.js";

export function renderSceneText(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  basePath?: string;
  accessSummary?: string;
}): string {
  const base = opts.basePath ?? "";
  const { scene, exits, artefacts, detail } = opts;
  const lines: string[] = [];

  if (detail) {
    const text = scene.details[detail];
    lines.push(`[Scene ${scene.id}${scene.title ? `: ${scene.title}` : ""} — detail:${detail}]`);
    if (scene.owner) lines.push(`by ${scene.owner}`);
    lines.push("");
    lines.push(text ?? `(No detail named "${detail}".)`);
  } else {
    lines.push(`[Scene ${scene.id}${scene.title ? `: ${scene.title}` : ""}]`);
    if (scene.owner) lines.push(`by ${scene.owner}`);
    lines.push(`visibility: ${scene.visibility}`);
    lines.push("");
    lines.push(scene.body);
    lines.push("");
    const detailNames = Object.keys(scene.details).sort();
    if (detailNames.length) {
      lines.push("Details:");
      for (const name of detailNames) {
        lines.push(`  - ${name}  ${base}/s/${scene.id}?${encodeURIComponent(name)}`);
      }
      lines.push("");
    }
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
        lines.push(
          `  ${e.exitId}. ${e.nickname} -> scene ${e.toSceneId}  ${base}/s/${scene.id}/go/${e.exitId}`,
        );
        lines.push(
          `     also: ${base}/s/${scene.id}/go/${encodeURIComponent(e.nickname)}`,
        );
      }
      lines.push("");
    }
    lines.push(`Travel: GET ${base}/s/<id>?from=${scene.id}`);
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
    lines.push(
      `[Artefact ${artefact.id}${artefact.title ? `: ${artefact.title}` : ""} — detail:${detail}]`,
    );
    if (artefact.owner) lines.push(`by ${artefact.owner}`);
    lines.push("");
    lines.push(text ?? `(No detail named "${detail}".)`);
  } else {
    lines.push(`[Artefact ${artefact.id}${artefact.title ? `: ${artefact.title}` : ""}]`);
    if (artefact.owner) lines.push(`by ${artefact.owner}`);
    lines.push(`home: ${base}/s/${artefact.homeSceneId}`);
    if (artefact.tags.length) lines.push(`tags: ${artefact.tags.join(", ")}`);
    lines.push("");
    lines.push(artefact.body);
    lines.push("");
    const detailNames = Object.keys(artefact.details).sort();
    if (detailNames.length) {
      lines.push("Details:");
      for (const name of detailNames) {
        lines.push(
          `  - ${name}  ${base}/a/${artefact.id}?${encodeURIComponent(name)}`,
        );
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderProfileText(opts: {
  username: string;
  message?: string;
  basePath?: string;
  grants?: Grant[];
  denies?: Deny[];
}): string {
  const base = opts.basePath ?? "";
  const lines = ["[Profile]", "", `Signed in as ${opts.username}`, ""];
  if (opts.message) {
    lines.push(opts.message, "");
  }
  lines.push("Change password:");
  lines.push(`  POST ${base}/auth/password`);
  lines.push("  currentPassword, newPassword, confirmPassword");
  lines.push("");
  lines.push("Share-all (every scene and group you own):");
  lines.push(`  POST ${base}/u/${opts.username}/access`);
  lines.push("  grantsJson, deniesJson");
  lines.push("");
  lines.push(formatAccessSummary(opts.grants, opts.denies));
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderInventoryText(items: ArtefactRecord[], basePath = ""): string {
  const lines = ["[Inventory]", ""];
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

export function renderMessageText(title: string, message: string): string {
  return `[${title}]\n\n${message}\n`;
}
