/**
 * Adventure pack export/import: densify on export, offset on import.
 * Pack = scenes, artefacts, manager quests, master alchemy, groups.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripLegacyInvites } from "../access/acl.js";
import type { AlchemyRecipe, QuestFile } from "../model/logic.js";
import type {
  ArtefactRecord,
  EntranceGroupRecord,
  ExitRecord,
  GroupRecord,
  SceneRecord,
} from "../model/types.js";
import {
  alchemyRecipesForDisk,
  isManagerQuestName,
  parseAlchemyRecipes,
  parseQuestFile,
  questFileForDisk,
} from "../logic/quests.js";
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from "./fs.js";
import { parseProseDocument, serializeProseDocument } from "./markdown.js";
import {
  buildDenseIdMap,
  buildDenseStringIdMap,
  buildOffsetIdMap,
  buildOffsetStringIdMap,
  PackRemapError,
  remapAlchemyRecipes,
  remapArtefact,
  remapEntranceGroup,
  remapExit,
  remapGroup,
  remapQuest,
  remapScene,
} from "./pack-remap.js";
import type { WorldStore } from "./world.js";

export const PACK_FORMAT_VERSION = 1 as const;

export interface AdventurePackManifest {
  formatVersion: typeof PACK_FORMAT_VERSION;
  title?: string;
  exportedAt: string;
  scenes: number;
  artefacts: number;
  quests: string[];
  alchemyRecipes: number;
  groups: number;
  entranceGroups: number;
  /** Dense local entrance scene id when present among exported scenes. */
  entranceSceneId?: number;
}

export interface ExportAdventurePackResult {
  buffer: Buffer;
  filename: string;
  manifest: AdventurePackManifest;
}

export interface ImportAdventurePackResult {
  manifest: AdventurePackManifest;
  sceneIds: number[];
  artefactIds: number[];
  questNames: string[];
  questRenames: Record<string, string>;
  alchemyRecipesAdded: number;
  groups: number;
  entranceGroups: number;
}

export interface ImportAdventurePackOptions {
  /** Explicit old→new manager quest names. */
  questRenames?: Record<string, string>;
  /** When a quest name collides, auto-suffix `_2`, `_3`, … (default true). */
  autoRenameQuests?: boolean;
  /** Reassign scene/artefact/group owners to this username. */
  owner?: string;
  /** Optional title override stored only in result messaging (manifest stays as packed). */
  title?: string;
}

function utcStamp(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${y}${m}${d}T${hh}${mm}${ss}Z`;
}

function slugify(title: string | undefined): string {
  const s = (title ?? "adventure")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "adventure";
}

async function tarDirectory(sourceDir: string, archivePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-czf", archivePath, "-C", sourceDir, "."], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited ${code}`));
    });
  });
}

async function extractTar(archivePath: string, destDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archivePath, "-C", destDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited ${code}`));
    });
  });
}

function collectPackSnapshot(world: WorldStore): {
  scenes: SceneRecord[];
  exitsByScene: Map<number, ExitRecord[]>;
  artefacts: ArtefactRecord[];
  quests: QuestFile[];
  alchemy: AlchemyRecipe[];
  groups: GroupRecord[];
  entranceGroups: EntranceGroupRecord[];
} {
  // User home scenes are account scaffolding, not adventure content.
  const scenes = [...world.scenes.values()]
    .filter((s) => !world.isUserHomeScene(s.id))
    .sort((a, b) => a.id - b.id);
  const sceneIds = new Set(scenes.map((s) => s.id));
  const artefacts = [...world.artefacts.values()]
    .filter((a) => sceneIds.has(a.homeSceneId))
    .sort((a, b) => a.id - b.id);
  const quests = world.listMasterQuests().map((q) => questFileForDisk(q));
  const alchemy = alchemyRecipesForDisk(world.masterAlchemyRecipes);
  const groups = [...world.groups.values()]
    .map((g) => ({
      ...g,
      sceneIds: g.sceneIds.filter((id) => sceneIds.has(id)),
    }))
    .filter((g) => g.sceneIds.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const entranceGroups = [...world.entranceGroups.values()]
    .map((g) => ({
      ...g,
      sceneIds: g.sceneIds.filter((id) => sceneIds.has(id)),
    }))
    .filter((g) => sceneIds.has(g.entranceSceneId) && g.sceneIds.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));
  const exitsByScene = new Map<number, ExitRecord[]>();
  for (const scene of scenes) {
    const exits = (world.exits.get(scene.id) ?? []).filter((e) => sceneIds.has(e.toSceneId));
    if (exits.length) exitsByScene.set(scene.id, exits.map((e) => ({ ...e })));
  }
  return { scenes, exitsByScene, artefacts, quests, alchemy, groups, entranceGroups };
}

async function writePackTree(
  root: string,
  data: {
    manifest: AdventurePackManifest;
    scenes: SceneRecord[];
    exitsByScene: Map<number, ExitRecord[]>;
    artefacts: ArtefactRecord[];
    quests: QuestFile[];
    alchemy: AlchemyRecipe[];
    groups: GroupRecord[];
    entranceGroups: EntranceGroupRecord[];
  },
): Promise<void> {
  await mkdir(join(root, "scenes"), { recursive: true });
  await mkdir(join(root, "artefacts"), { recursive: true });
  await mkdir(join(root, "quests"), { recursive: true });
  await mkdir(join(root, "alchemy"), { recursive: true });
  await mkdir(join(root, "groups"), { recursive: true });
  await mkdir(join(root, "entrance-groups"), { recursive: true });

  await writeJsonAtomic(join(root, "pack.json"), data.manifest);

  for (const scene of data.scenes) {
    const { body, details, ...meta } = scene;
    const raw = serializeProseDocument(stripLegacyInvites(meta), body, details);
    await writeTextAtomic(join(root, "scenes", `${scene.id}.md`), raw);
    const exits = data.exitsByScene.get(scene.id);
    if (exits?.length) {
      await writeJsonAtomic(join(root, "scenes", `${scene.id}.exits.json`), exits);
    }
  }

  for (const artefact of data.artefacts) {
    const { body, details, ...meta } = artefact;
    const raw = serializeProseDocument(meta, body, details);
    await writeTextAtomic(join(root, "artefacts", `${artefact.id}.md`), raw);
  }

  for (const quest of data.quests) {
    await writeJsonAtomic(join(root, "quests", `${quest.name}.json`), questFileForDisk(quest));
  }

  if (data.alchemy.length) {
    await writeJsonAtomic(join(root, "alchemy", "recipes.json"), data.alchemy);
  }

  for (const group of data.groups) {
    await writeJsonAtomic(join(root, "groups", `${group.id}.json`), group);
  }
  for (const group of data.entranceGroups) {
    await writeJsonAtomic(join(root, "entrance-groups", `${group.id}.json`), group);
  }
}

/** Export the world content subset as a densified adventure pack tar.gz. */
export async function exportAdventurePack(
  world: WorldStore,
  opts?: { title?: string },
): Promise<ExportAdventurePackResult> {
  const snap = collectPackSnapshot(world);
  if (!snap.scenes.length) {
    throw new PackRemapError("Cannot export an empty adventure (no non-home scenes)");
  }

  const sceneMap = buildDenseIdMap(snap.scenes.map((s) => s.id));
  const artefactMap = buildDenseIdMap(snap.artefacts.map((a) => a.id));
  const groupMap = buildDenseStringIdMap(snap.groups.map((g) => g.id));
  const entranceGroupMap = buildDenseStringIdMap(snap.entranceGroups.map((g) => g.id));

  const scenes = snap.scenes.map((s) =>
    remapScene(s, sceneMap, artefactMap, groupMap, entranceGroupMap),
  );
  const artefacts = snap.artefacts.map((a) => remapArtefact(a, sceneMap, artefactMap));
  const quests = snap.quests.map((q) => remapQuest(q, sceneMap, artefactMap));
  const alchemy = remapAlchemyRecipes(snap.alchemy, artefactMap);
  const groups = snap.groups.map((g) => remapGroup(g, sceneMap, groupMap));
  const entranceGroups = snap.entranceGroups.map((g) =>
    remapEntranceGroup(g, sceneMap, entranceGroupMap),
  );

  const exitsByScene = new Map<number, ExitRecord[]>();
  for (const [oldSceneId, exits] of snap.exitsByScene) {
    const newSceneId = sceneMap.get(oldSceneId);
    if (newSceneId === undefined) continue;
    exitsByScene.set(
      newSceneId,
      exits.map((e) => remapExit(e, sceneMap, artefactMap)),
    );
  }

  const sourceEntrance = world.meta.entranceSceneId;
  const denseEntrance =
    sourceEntrance !== undefined && sceneMap.has(sourceEntrance)
      ? sceneMap.get(sourceEntrance)
      : undefined;

  const manifest: AdventurePackManifest = {
    formatVersion: PACK_FORMAT_VERSION,
    ...(opts?.title ? { title: opts.title } : {}),
    exportedAt: new Date().toISOString(),
    scenes: scenes.length,
    artefacts: artefacts.length,
    quests: quests.map((q) => q.name).sort(),
    alchemyRecipes: alchemy.length,
    groups: groups.length,
    entranceGroups: entranceGroups.length,
    ...(denseEntrance !== undefined ? { entranceSceneId: denseEntrance } : {}),
  };

  const staging = await mkdtemp(join(tmpdir(), "proseden-pack-export-"));
  const partial = join(tmpdir(), `proseden-pack-${utcStamp()}.tar.gz.partial`);
  try {
    await writePackTree(staging, {
      manifest,
      scenes,
      exitsByScene,
      artefacts,
      quests,
      alchemy,
      groups,
      entranceGroups,
    });
    await tarDirectory(staging, partial);
    const buffer = await readFile(partial);
    const filename = `${slugify(opts?.title ?? manifest.title)}-${utcStamp()}.tar.gz`;
    return { buffer, filename, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
    await rm(partial, { force: true });
  }
}

async function listJsonNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

async function listMdIds(dir: string): Promise<number[]> {
  try {
    return (await readdir(dir))
      .filter((f) => f.endsWith(".md") && !f.includes(".versions"))
      .map((f) => Number(f.replace(/\.md$/, "")))
      .filter((id) => Number.isFinite(id) && id > 0)
      .sort((a, b) => a - b);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }
}

async function readPackFromDir(root: string): Promise<{
  manifest: AdventurePackManifest;
  scenes: SceneRecord[];
  exitsByScene: Map<number, ExitRecord[]>;
  artefacts: ArtefactRecord[];
  quests: QuestFile[];
  alchemy: AlchemyRecipe[];
  groups: GroupRecord[];
  entranceGroups: EntranceGroupRecord[];
}> {
  let manifest: AdventurePackManifest;
  try {
    manifest = await readJson<AdventurePackManifest>(join(root, "pack.json"));
  } catch {
    throw new PackRemapError("Archive is not a valid adventure pack (missing pack.json)");
  }
  if (manifest.formatVersion !== PACK_FORMAT_VERSION) {
    throw new PackRemapError(
      `Unsupported pack formatVersion ${String(manifest.formatVersion)} (expected ${PACK_FORMAT_VERSION})`,
    );
  }

  const sceneIds = await listMdIds(join(root, "scenes"));
  const artefactIds = await listMdIds(join(root, "artefacts"));
  const scenes: SceneRecord[] = [];
  const exitsByScene = new Map<number, ExitRecord[]>();

  for (const id of sceneIds) {
    const raw = await readText(join(root, "scenes", `${id}.md`));
    const { meta, body, details } = parseProseDocument<Record<string, unknown>>(raw);
    scenes.push({
      ...(meta as unknown as SceneRecord),
      id,
      body,
      details,
    });
    const exitsPath = join(root, "scenes", `${id}.exits.json`);
    try {
      await stat(exitsPath);
      const exits = await readJson<ExitRecord[]>(exitsPath);
      if (Array.isArray(exits) && exits.length) exitsByScene.set(id, exits);
    } catch {
      // no exits file
    }
  }

  const artefacts: ArtefactRecord[] = [];
  for (const id of artefactIds) {
    const raw = await readText(join(root, "artefacts", `${id}.md`));
    const { meta, body, details } = parseProseDocument<Record<string, unknown>>(raw);
    artefacts.push({
      ...(meta as unknown as ArtefactRecord),
      id,
      body,
      details,
    });
  }

  const quests: QuestFile[] = [];
  for (const name of await listJsonNames(join(root, "quests"))) {
    const raw = await readJson<unknown>(join(root, "quests", `${name}.json`));
    const quest = parseQuestFile(raw);
    if (!isManagerQuestName(quest.name)) {
      throw new PackRemapError(`Pack quest "${quest.name}" is not a manager quest name`);
    }
    quests.push(questFileForDisk(quest));
  }

  let alchemy: AlchemyRecipe[] = [];
  const alchemyPath = join(root, "alchemy", "recipes.json");
  try {
    await stat(alchemyPath);
    alchemy = alchemyRecipesForDisk(parseAlchemyRecipes(await readJson<unknown>(alchemyPath)));
  } catch {
    alchemy = [];
  }

  const groups: GroupRecord[] = [];
  for (const id of await listJsonNames(join(root, "groups"))) {
    groups.push(await readJson<GroupRecord>(join(root, "groups", `${id}.json`)));
  }
  const entranceGroups: EntranceGroupRecord[] = [];
  for (const id of await listJsonNames(join(root, "entrance-groups"))) {
    entranceGroups.push(
      await readJson<EntranceGroupRecord>(join(root, "entrance-groups", `${id}.json`)),
    );
  }

  return { manifest, scenes, exitsByScene, artefacts, quests, alchemy, groups, entranceGroups };
}

function resolveQuestRenames(
  packQuestNames: string[],
  taken: Set<string>,
  opts: ImportAdventurePackOptions,
): Map<string, string> {
  const auto = opts.autoRenameQuests !== false;
  const explicit = opts.questRenames ?? {};
  const renames = new Map<string, string>();
  const claimed = new Set(taken);

  for (const oldName of packQuestNames) {
    let next = explicit[oldName] ?? oldName;
    if (!isManagerQuestName(next)) {
      throw new PackRemapError(`Invalid quest rename target "${next}" for "${oldName}"`);
    }
    if (claimed.has(next)) {
      if (!auto) {
        throw new PackRemapError(`Quest name conflict: "${next}" already exists`);
      }
      let n = 2;
      let candidate = `${next}_${n}`;
      while (claimed.has(candidate) || !isManagerQuestName(candidate)) {
        n += 1;
        candidate = `${next}_${n}`;
        if (n > 10_000) throw new PackRemapError(`Could not auto-rename quest "${oldName}"`);
      }
      next = candidate;
    }
    renames.set(oldName, next);
    claimed.add(next);
  }
  return renames;
}

function applyOwner<T extends { owner: string }>(record: T, owner: string | undefined): T {
  return owner ? { ...record, owner } : record;
}

/** Import a densified adventure pack into the host world (offset ids, merge content). */
export async function importAdventurePack(
  world: WorldStore,
  archive: Buffer | string,
  opts: ImportAdventurePackOptions = {},
): Promise<ImportAdventurePackResult> {
  const extractRoot = await mkdtemp(join(tmpdir(), "proseden-pack-import-"));
  let archivePath: string | undefined;
  try {
    if (typeof archive === "string") {
      archivePath = archive;
    } else {
      archivePath = join(extractRoot, "upload.tar.gz");
      await writeFile(archivePath, archive);
    }
    const contentDir = join(extractRoot, "content");
    await mkdir(contentDir, { recursive: true });
    await extractTar(archivePath, contentDir);

    const pack = await readPackFromDir(contentDir);
    if (!pack.scenes.length) {
      throw new PackRemapError("Pack contains no scenes");
    }

    const denseSceneCount = Math.max(...pack.scenes.map((s) => s.id), 0);
    const denseArtefactCount = pack.artefacts.length
      ? Math.max(...pack.artefacts.map((a) => a.id), 0)
      : 0;
    const denseGroupCount = pack.groups.length
      ? Math.max(...pack.groups.map((g) => Number(g.id) || 0), pack.groups.length)
      : 0;
    const denseEntranceGroupCount = pack.entranceGroups.length
      ? Math.max(
          ...pack.entranceGroups.map((g) => Number(g.id) || 0),
          pack.entranceGroups.length,
        )
      : 0;

    // Prefer count from max dense id (handles densified 1..N).
    const sceneCount = denseSceneCount;
    const artefactCount = denseArtefactCount;
    const groupCount = pack.groups.length ? denseGroupCount : 0;
    const entranceGroupCount = pack.entranceGroups.length ? denseEntranceGroupCount : 0;

    const sceneBase = world.meta.nextSceneId;
    const artefactBase = world.meta.nextArtefactId;
    const groupBase = world.meta.nextGroupId ?? 1;
    const entranceGroupBase = world.meta.nextEntranceGroupId ?? 1;

    const sceneMap = buildOffsetIdMap(sceneCount, sceneBase);
    const artefactMap =
      artefactCount > 0 ? buildOffsetIdMap(artefactCount, artefactBase) : new Map<number, number>();
    const groupMap =
      groupCount > 0
        ? buildOffsetStringIdMap(groupCount, groupBase)
        : new Map<string, string>();
    const entranceGroupMap =
      entranceGroupCount > 0
        ? buildOffsetStringIdMap(entranceGroupCount, entranceGroupBase)
        : new Map<string, string>();

    const takenQuests = new Set(world.listMasterQuests().map((q) => q.name));
    const questRenames = resolveQuestRenames(
      pack.quests.map((q) => q.name),
      takenQuests,
      opts,
    );

    const owner = opts.owner?.trim() || undefined;
    const scenes = pack.scenes.map((s) =>
      applyOwner(
        remapScene(s, sceneMap, artefactMap, groupMap, entranceGroupMap, questRenames),
        owner,
      ),
    );
    const artefacts = pack.artefacts.map((a) =>
      applyOwner(remapArtefact(a, sceneMap, artefactMap, questRenames), owner),
    );
    const quests = pack.quests.map((q) =>
      questFileForDisk(remapQuest(q, sceneMap, artefactMap, questRenames)),
    );
    const alchemy = remapAlchemyRecipes(pack.alchemy, artefactMap);
    const groups = pack.groups.map((g) =>
      applyOwner(remapGroup(g, sceneMap, groupMap), owner),
    );
    const entranceGroups = pack.entranceGroups.map((g) =>
      remapEntranceGroup(g, sceneMap, entranceGroupMap),
    );

    const exitsByScene = new Map<number, ExitRecord[]>();
    for (const [denseSceneId, exits] of pack.exitsByScene) {
      const newSceneId = sceneMap.get(denseSceneId);
      if (newSceneId === undefined) {
        throw new PackRemapError(`Dangling exits for scene ${denseSceneId}`);
      }
      exitsByScene.set(
        newSceneId,
        exits.map((e) => remapExit(e, sceneMap, artefactMap, questRenames)),
      );
    }

    // Write into host data dir, then bump meta and reload.
    await mkdir(join(world.dataDir, "scenes"), { recursive: true });
    await mkdir(join(world.dataDir, "artefacts"), { recursive: true });
    await mkdir(join(world.dataDir, "quests"), { recursive: true });
    await mkdir(join(world.dataDir, "alchemy"), { recursive: true });
    await mkdir(join(world.dataDir, "groups"), { recursive: true });
    await mkdir(join(world.dataDir, "entrance-groups"), { recursive: true });

    for (const scene of scenes) {
      const { body, details, ...meta } = scene;
      const raw = serializeProseDocument(stripLegacyInvites(meta), body, details);
      await writeTextAtomic(join(world.dataDir, "scenes", `${scene.id}.md`), raw);
      const exits = exitsByScene.get(scene.id) ?? [];
      if (exits.length) {
        await writeJsonAtomic(join(world.dataDir, "scenes", `${scene.id}.exits.json`), exits);
      }
    }

    for (const artefact of artefacts) {
      const { body, details, ...meta } = artefact;
      const raw = serializeProseDocument(meta, body, details);
      await writeTextAtomic(join(world.dataDir, "artefacts", `${artefact.id}.md`), raw);
    }

    for (const quest of quests) {
      await writeJsonAtomic(
        join(world.dataDir, "quests", `${quest.name}.json`),
        questFileForDisk(quest),
      );
    }

    let alchemyRecipesAdded = 0;
    if (alchemy.length) {
      const existingIds = new Set(world.masterAlchemyRecipes.map((r) => r.id));
      const merged = alchemyRecipesForDisk([...world.masterAlchemyRecipes]);
      const packSlug = slugify(opts.title ?? pack.manifest.title);
      for (const recipe of alchemy) {
        let id = recipe.id;
        if (existingIds.has(id)) {
          id = `${packSlug}-${recipe.id}`;
          let n = 2;
          while (existingIds.has(id)) {
            id = `${packSlug}-${recipe.id}-${n}`;
            n += 1;
          }
        }
        existingIds.add(id);
        merged.push({ ...recipe, id });
        alchemyRecipesAdded += 1;
      }
      await writeJsonAtomic(join(world.dataDir, "alchemy", "recipes.json"), merged);
    }

    for (const group of groups) {
      await writeJsonAtomic(join(world.dataDir, "groups", `${group.id}.json`), group);
    }
    for (const group of entranceGroups) {
      await writeJsonAtomic(
        join(world.dataDir, "entrance-groups", `${group.id}.json`),
        group,
      );
    }

    world.meta.nextSceneId = Math.max(world.meta.nextSceneId, sceneBase + sceneCount);
    world.meta.nextArtefactId = Math.max(
      world.meta.nextArtefactId,
      artefactBase + artefactCount,
    );
    world.meta.nextGroupId = Math.max(world.meta.nextGroupId ?? 1, groupBase + groupCount);
    world.meta.nextEntranceGroupId = Math.max(
      world.meta.nextEntranceGroupId ?? 1,
      entranceGroupBase + entranceGroupCount,
    );
    await world.saveMeta();
    await world.reload();

    const renameRecord: Record<string, string> = {};
    for (const [from, to] of questRenames) {
      if (from !== to) renameRecord[from] = to;
    }

    return {
      manifest: pack.manifest,
      sceneIds: scenes.map((s) => s.id),
      artefactIds: artefacts.map((a) => a.id),
      questNames: quests.map((q) => q.name),
      questRenames: renameRecord,
      alchemyRecipesAdded,
      groups: groups.length,
      entranceGroups: entranceGroups.length,
    };
  } finally {
    await rm(extractRoot, { recursive: true, force: true });
  }
}

export { PackRemapError };
