import type { ArtefactRecord, ExitRecord, SceneRecord } from "../model/types.js";

export function renderSceneText(opts: {
  scene: SceneRecord;
  exits: ExitRecord[];
  artefacts: ArtefactRecord[];
  detail?: string;
  basePath?: string;
}): string {
  const base = opts.basePath ?? "";
  const { scene, exits, artefacts, detail } = opts;
  const lines: string[] = [];

  if (detail) {
    const text = scene.details[detail];
    lines.push(`[Scene ${scene.id}${scene.title ? `: ${scene.title}` : ""} — detail:${detail}]`);
    lines.push("");
    lines.push(text ?? `(No detail named "${detail}".)`);
  } else {
    lines.push(`[Scene ${scene.id}${scene.title ? `: ${scene.title}` : ""}]`);
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
          `  ${e.exitId}. ${e.nickname} -> scene ${e.toSceneId}  ${base}/s/${e.toSceneId}`,
        );
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
    lines.push("");
    lines.push(text ?? `(No detail named "${detail}".)`);
  } else {
    lines.push(`[Artefact ${artefact.id}${artefact.title ? `: ${artefact.title}` : ""}]`);
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

export function renderInventoryText(
  items: Array<{ artefact: ArtefactRecord; tags: string[] }>,
  basePath = "",
): string {
  const lines = ["[Inventory]", ""];
  if (!items.length) {
    lines.push("(empty)");
  } else {
    for (const item of items) {
      const label = item.artefact.title ?? `artefact ${item.artefact.id}`;
      const tags = item.tags.length ? ` [${item.tags.join(", ")}]` : "";
      lines.push(`  ${item.artefact.id}. ${label}${tags}  ${basePath}/a/${item.artefact.id}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderMessageText(title: string, message: string): string {
  return `[${title}]\n\n${message}\n`;
}
