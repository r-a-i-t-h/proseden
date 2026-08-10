import { cp, mkdir, readdir, access, rename } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtefactMeta,
  ArtefactRecord,
  ExitRecord,
  InventoryItem,
  MetaFile,
  SceneMeta,
  SceneRecord,
  UserRecord,
} from "../model/types.js";
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from "./fs.js";
import { parseProseDocument, serializeProseDocument } from "./markdown.js";

export class WorldStore {
  readonly dataDir: string;
  meta: MetaFile = { nextSceneId: 1, nextArtefactId: 1 };
  users = new Map<string, UserRecord>();
  scenes = new Map<number, SceneRecord>();
  exits = new Map<number, ExitRecord[]>();
  artefacts = new Map<number, ArtefactRecord>();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async load(seedDir?: string): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const metaPath = join(this.dataDir, "meta.json");
    const hasMeta = await exists(metaPath);
    if (!hasMeta && seedDir) {
      await cp(seedDir, this.dataDir, { recursive: true });
    }

    await this.migrateLegacyLayout();

    await mkdir(join(this.dataDir, "users"), { recursive: true });
    await mkdir(join(this.dataDir, "scenes"), { recursive: true });
    await mkdir(join(this.dataDir, "artefacts"), { recursive: true });

    if (await exists(metaPath)) {
      this.meta = normalizeMeta(await readJson<Record<string, unknown>>(metaPath));
    }

    for (const file of await listFiles(join(this.dataDir, "users"), ".json")) {
      const user = await readJson<UserRecord>(join(this.dataDir, "users", file));
      this.users.set(user.username, user);
    }

    for (const file of await listFiles(join(this.dataDir, "scenes"), ".md")) {
      const id = Number(file.replace(/\.md$/, ""));
      if (!Number.isFinite(id)) continue;
      const raw = await readText(join(this.dataDir, "scenes", file));
      const { meta, body, details } = parseProseDocument<SceneMeta>(raw);
      this.scenes.set(id, { ...meta, id, body, details });

      const exitsPath = join(this.dataDir, "scenes", `${id}.exits.json`);
      if (await exists(exitsPath)) {
        const rawExits = await readJson<Array<Record<string, unknown>>>(exitsPath);
        this.exits.set(id, rawExits.map(normalizeExit));
      } else {
        this.exits.set(id, []);
      }
    }

    for (const file of await listFiles(join(this.dataDir, "artefacts"), ".md")) {
      const id = Number(file.replace(/\.md$/, ""));
      if (!Number.isFinite(id)) continue;
      const raw = await readText(join(this.dataDir, "artefacts", file));
      const { meta, body, details } = parseProseDocument<Record<string, unknown>>(raw);
      const normalised = normalizeArtefactMeta(meta);
      this.artefacts.set(id, {
        ...normalised,
        id,
        tags: normalised.tags ?? [],
        body,
        details,
      });
    }
  }

  /** One-time rename from v1 "nodes" layout if present. */
  private async migrateLegacyLayout(): Promise<void> {
    const legacy = join(this.dataDir, "nodes");
    const next = join(this.dataDir, "scenes");
    if ((await exists(legacy)) && !(await exists(next))) {
      await rename(legacy, next);
    }
  }

  getScene(id: number): SceneRecord | undefined {
    return this.scenes.get(id);
  }

  getArtefact(id: number): ArtefactRecord | undefined {
    return this.artefacts.get(id);
  }

  getExits(fromSceneId: number): ExitRecord[] {
    return this.exits.get(fromSceneId) ?? [];
  }

  artefactsAt(sceneId: number): ArtefactRecord[] {
    return [...this.artefacts.values()].filter((a) => a.homeSceneId === sceneId);
  }

  getUser(username: string): UserRecord | undefined {
    return this.users.get(username);
  }

  async saveMeta(): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, "meta.json"), this.meta);
  }

  async saveUser(user: UserRecord): Promise<void> {
    this.users.set(user.username, user);
    await writeJsonAtomic(join(this.dataDir, "users", `${user.username}.json`), user);
  }

  async saveScene(scene: SceneRecord): Promise<void> {
    this.scenes.set(scene.id, scene);
    const { body, details, ...meta } = scene;
    const raw = serializeProseDocument(meta, body, details);
    await writeTextAtomic(join(this.dataDir, "scenes", `${scene.id}.md`), raw);
  }

  async saveExits(fromSceneId: number, exits: ExitRecord[]): Promise<void> {
    this.exits.set(fromSceneId, exits);
    await writeJsonAtomic(join(this.dataDir, "scenes", `${fromSceneId}.exits.json`), exits);
  }

  async saveArtefact(artefact: ArtefactRecord): Promise<void> {
    this.artefacts.set(artefact.id, artefact);
    const { body, details, ...meta } = artefact;
    const raw = serializeProseDocument(meta, body, details);
    await writeTextAtomic(join(this.dataDir, "artefacts", `${artefact.id}.md`), raw);
  }

  async createUser(username: string, passwordHash: string, passwordSalt: string): Promise<UserRecord> {
    if (this.users.has(username)) {
      throw new Error("Username already taken");
    }
    const user: UserRecord = {
      username,
      passwordHash,
      passwordSalt,
      createdAt: nowIso(),
      inventory: [],
    };
    await this.saveUser(user);
    return user;
  }

  async createScene(input: {
    owner: string;
    title?: string;
    body: string;
    details?: Record<string, string>;
    visibility?: SceneRecord["visibility"];
  }): Promise<SceneRecord> {
    const id = this.meta.nextSceneId++;
    const createdAt = nowIso();
    const scene: SceneRecord = {
      id,
      owner: input.owner,
      title: input.title,
      visibility: input.visibility ?? "private",
      createdAt,
      modifiedAt: [],
      body: input.body,
      details: input.details ?? {},
    };
    await this.saveScene(scene);
    await this.saveExits(id, []);
    await this.saveMeta();
    return scene;
  }

  async updateScene(
    id: number,
    patch: Partial<Pick<SceneRecord, "title" | "body" | "details" | "visibility">>,
  ): Promise<SceneRecord> {
    const existing = this.scenes.get(id);
    if (!existing) throw new Error("Scene not found");
    const updated: SceneRecord = {
      ...existing,
      ...patch,
      details: patch.details ?? existing.details,
      modifiedAt: [...existing.modifiedAt, nowIso()],
    };
    await this.saveScene(updated);
    return updated;
  }

  async addExit(
    fromSceneId: number,
    nickname: string,
    toSceneId: number,
  ): Promise<ExitRecord> {
    if (!this.scenes.has(fromSceneId)) throw new Error("From scene not found");
    if (!this.scenes.has(toSceneId)) throw new Error("To scene not found");
    const exits = [...this.getExits(fromSceneId)];
    const exitId = exits.reduce((max, e) => Math.max(max, e.exitId), 0) + 1;
    const exit: ExitRecord = {
      exitId,
      nickname,
      toSceneId,
      createdAt: nowIso(),
    };
    exits.push(exit);
    await this.saveExits(fromSceneId, exits);
    return exit;
  }

  async createArtefact(input: {
    owner: string;
    homeSceneId: number;
    title?: string;
    body: string;
    details?: Record<string, string>;
    tags?: string[];
  }): Promise<ArtefactRecord> {
    if (!this.scenes.has(input.homeSceneId)) throw new Error("Home scene not found");
    const id = this.meta.nextArtefactId++;
    const createdAt = nowIso();
    const artefact: ArtefactRecord = {
      id,
      owner: input.owner,
      homeSceneId: input.homeSceneId,
      title: input.title,
      tags: input.tags ?? [],
      createdAt,
      modifiedAt: [],
      body: input.body,
      details: input.details ?? {},
    };
    await this.saveArtefact(artefact);
    await this.saveMeta();
    return artefact;
  }

  async updateArtefact(
    id: number,
    patch: Partial<Pick<ArtefactRecord, "title" | "body" | "details" | "tags" | "homeSceneId">>,
  ): Promise<ArtefactRecord> {
    const existing = this.artefacts.get(id);
    if (!existing) throw new Error("Artefact not found");
    if (patch.homeSceneId !== undefined && !this.scenes.has(patch.homeSceneId)) {
      throw new Error("Home scene not found");
    }
    const updated: ArtefactRecord = {
      ...existing,
      ...patch,
      details: patch.details ?? existing.details,
      tags: patch.tags ?? existing.tags,
      modifiedAt: [...existing.modifiedAt, nowIso()],
    };
    await this.saveArtefact(updated);
    return updated;
  }

  async collectArtefact(username: string, artefactId: number, tags: string[] = []): Promise<UserRecord> {
    const user = this.users.get(username);
    if (!user) throw new Error("User not found");
    if (!this.artefacts.has(artefactId)) throw new Error("Artefact not found");
    if (user.inventory.some((i) => i.artefactId === artefactId)) {
      return user;
    }
    const item: InventoryItem = { artefactId, tags };
    const updated: UserRecord = {
      ...user,
      inventory: [...user.inventory, item],
    };
    await this.saveUser(updated);
    return updated;
  }

  async dropArtefact(username: string, artefactId: number): Promise<UserRecord> {
    const user = this.users.get(username);
    if (!user) throw new Error("User not found");
    const updated: UserRecord = {
      ...user,
      inventory: user.inventory.filter((i) => i.artefactId !== artefactId),
    };
    await this.saveUser(updated);
    return updated;
  }
}

function normalizeMeta(raw: Record<string, unknown>): MetaFile {
  const nextSceneId = Number(raw.nextSceneId ?? raw.nextNodeId ?? 1);
  const nextArtefactId = Number(raw.nextArtefactId ?? 1);
  return {
    nextSceneId: Number.isFinite(nextSceneId) ? nextSceneId : 1,
    nextArtefactId: Number.isFinite(nextArtefactId) ? nextArtefactId : 1,
  };
}

function normalizeExit(raw: Record<string, unknown>): ExitRecord {
  const toSceneId = Number(raw.toSceneId ?? raw.toNodeId);
  return {
    exitId: Number(raw.exitId),
    nickname: String(raw.nickname ?? ""),
    toSceneId,
    createdAt: String(raw.createdAt ?? nowIso()),
  };
}

function normalizeArtefactMeta(raw: Record<string, unknown>): ArtefactMeta {
  const homeSceneId = Number(raw.homeSceneId ?? raw.homeNodeId);
  return {
    id: Number(raw.id),
    owner: String(raw.owner ?? ""),
    homeSceneId,
    title: raw.title !== undefined ? String(raw.title) : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    createdAt: String(raw.createdAt ?? nowIso()),
    modifiedAt: Array.isArray(raw.modifiedAt) ? raw.modifiedAt.map(String) : [],
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(dir: string, ext: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith(ext)).sort();
  } catch {
    return [];
  }
}
