/**
 * Shared helpers for samples/* generators.
 */
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TS = "2026-08-24T17:00:00.000Z";
export const OWNER = "admin";

export function escapeHashLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => (line.startsWith("#") ? `\\${line}` : line))
    .join("\n");
}

export function serializeProse(meta, body, details = {}) {
  const detailBlocks = Object.entries(details)
    .map(([slug, text]) => `## detail:${slug}\n${escapeHashLines(text.trim())}`)
    .join("\n\n");
  const content = [escapeHashLines(body.trim()), detailBlocks].filter(Boolean).join("\n\n");
  const cleanMeta = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) cleanMeta[key] = value;
  }
  return matter.stringify(`${content}\n`, cleanMeta);
}

export async function prepareSampleRoot(sampleName) {
  const root = join(REPO, "samples", sampleName);
  await mkdir(join(root, "scenes"), { recursive: true });
  await mkdir(join(root, "artefacts"), { recursive: true });
  await mkdir(join(root, "quests"), { recursive: true });
  await mkdir(join(root, "alchemy"), { recursive: true });
  await mkdir(join(root, "entrance-groups"), { recursive: true });
  await mkdir(join(root, "users"), { recursive: true });
  await cp(join(REPO, "seed/users/admin.json"), join(root, "users/admin.json"));
  await cp(join(REPO, "seed/staff.json"), join(root, "staff.json"));
  await cp(join(REPO, "seed/alchemy/recipes.json"), join(root, "alchemy/recipes.json"));
  await cp(join(REPO, "seed/quests/builders.json"), join(root, "quests/builders.json"));
  await cp(join(REPO, "seed/quests/proseden.json"), join(root, "quests/proseden.json"));
  return root;
}

export async function writeWorld(root, { scenes, exits, artefacts, quest, entranceGroup, meta, readme }) {
  let exitId = 1;
  const buildExits = (list) =>
    (list ?? []).map(([nickname, toSceneId, opts = {}]) => {
      const rec = { exitId: exitId++, nickname, toSceneId, createdAt: TS };
      if (opts.when) rec.when = opts.when;
      if (opts.whenDenied) rec.whenDenied = opts.whenDenied;
      if (opts.hidden) rec.hidden = true;
      return rec;
    });

  for (const s of scenes) {
    const { id, title, body, details, detailWhen, when, whenDenied } = s;
    const sceneMeta = {
      id,
      owner: OWNER,
      visibility: "public",
      title,
      createdAt: TS,
      modifiedAt: [],
      entranceGroupId: entranceGroup.id,
      ...(detailWhen ? { detailWhen } : {}),
      ...(when ? { when } : {}),
      ...(whenDenied ? { whenDenied } : {}),
    };
    await writeFile(join(root, "scenes", `${id}.md`), serializeProse(sceneMeta, body, details ?? {}), "utf8");
    await writeFile(
      join(root, "scenes", `${id}.exits.json`),
      `${JSON.stringify(buildExits(exits[id]), null, 2)}\n`,
      "utf8",
    );
  }

  for (const a of artefacts) {
    const { id, homeSceneId, title, body, details, tags, when } = a;
    const artMeta = {
      id,
      owner: OWNER,
      homeSceneId,
      title,
      tags: tags ?? [],
      createdAt: TS,
      modifiedAt: [],
      ...(when ? { when } : {}),
    };
    await writeFile(
      join(root, "artefacts", `${id}.md`),
      serializeProse(artMeta, body, details ?? {}),
      "utf8",
    );
  }

  await writeFile(join(root, "quests", `${quest.name}.json`), `${JSON.stringify(quest, null, 2)}\n`, "utf8");
  await writeFile(join(root, "entrance-groups", `${entranceGroup.id}.json`), `${JSON.stringify(entranceGroup, null, 2)}\n`, "utf8");
  await writeFile(join(root, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await writeFile(join(root, "README.md"), readme, "utf8");
}
