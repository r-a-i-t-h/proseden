import { cp, mkdir, readdir, access } from "node:fs/promises";
import { join } from "node:path";
import type {
  ArtefactMeta,
  ArtefactRecord,
  ExitRecord,
  InventoryItem,
  MetaFile,
  NodeMeta,
  NodeRecord,
  UserRecord,
} from "../model/types.js";
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from "./fs.js";
import { parseProseDocument, serializeProseDocument } from "./markdown.js";

export class WorldStore {
  readonly dataDir: string;
  meta: MetaFile = { nextNodeId: 1, nextArtefactId: 1 };
  users = new Map<string, UserRecord>();
  nodes = new Map<number, NodeRecord>();
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

    await mkdir(join(this.dataDir, "users"), { recursive: true });
    await mkdir(join(this.dataDir, "nodes"), { recursive: true });
    await mkdir(join(this.dataDir, "artefacts"), { recursive: true });

    if (await exists(metaPath)) {
      this.meta = await readJson<MetaFile>(metaPath);
    }

    for (const file of await listFiles(join(this.dataDir, "users"), ".json")) {
      const user = await readJson<UserRecord>(join(this.dataDir, "users", file));
      this.users.set(user.username, user);
    }

    for (const file of await listFiles(join(this.dataDir, "nodes"), ".md")) {
      const id = Number(file.replace(/\.md$/, ""));
      if (!Number.isFinite(id)) continue;
      const raw = await readText(join(this.dataDir, "nodes", file));
      const { meta, body, details } = parseProseDocument<NodeMeta>(raw);
      this.nodes.set(id, { ...meta, id, body, details });

      const exitsPath = join(this.dataDir, "nodes", `${id}.exits.json`);
      if (await exists(exitsPath)) {
        this.exits.set(id, await readJson<ExitRecord[]>(exitsPath));
      } else {
        this.exits.set(id, []);
      }
    }

    for (const file of await listFiles(join(this.dataDir, "artefacts"), ".md")) {
      const id = Number(file.replace(/\.md$/, ""));
      if (!Number.isFinite(id)) continue;
      const raw = await readText(join(this.dataDir, "artefacts", file));
      const { meta, body, details } = parseProseDocument<ArtefactMeta>(raw);
      this.artefacts.set(id, {
        ...meta,
        id,
        tags: meta.tags ?? [],
        body,
        details,
      });
    }
  }

  getNode(id: number): NodeRecord | undefined {
    return this.nodes.get(id);
  }

  getArtefact(id: number): ArtefactRecord | undefined {
    return this.artefacts.get(id);
  }

  getExits(fromNodeId: number): ExitRecord[] {
    return this.exits.get(fromNodeId) ?? [];
  }

  artefactsAt(nodeId: number): ArtefactRecord[] {
    return [...this.artefacts.values()].filter((a) => a.homeNodeId === nodeId);
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

  async saveNode(node: NodeRecord): Promise<void> {
    this.nodes.set(node.id, node);
    const { body, details, ...meta } = node;
    const raw = serializeProseDocument(meta, body, details);
    await writeTextAtomic(join(this.dataDir, "nodes", `${node.id}.md`), raw);
  }

  async saveExits(fromNodeId: number, exits: ExitRecord[]): Promise<void> {
    this.exits.set(fromNodeId, exits);
    await writeJsonAtomic(join(this.dataDir, "nodes", `${fromNodeId}.exits.json`), exits);
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

  async createNode(input: {
    owner: string;
    title?: string;
    body: string;
    details?: Record<string, string>;
    visibility?: NodeRecord["visibility"];
  }): Promise<NodeRecord> {
    const id = this.meta.nextNodeId++;
    const createdAt = nowIso();
    const node: NodeRecord = {
      id,
      owner: input.owner,
      title: input.title,
      visibility: input.visibility ?? "private",
      createdAt,
      modifiedAt: [],
      body: input.body,
      details: input.details ?? {},
    };
    await this.saveNode(node);
    await this.saveExits(id, []);
    await this.saveMeta();
    return node;
  }

  async updateNode(
    id: number,
    patch: Partial<Pick<NodeRecord, "title" | "body" | "details" | "visibility">>,
  ): Promise<NodeRecord> {
    const existing = this.nodes.get(id);
    if (!existing) throw new Error("Node not found");
    const updated: NodeRecord = {
      ...existing,
      ...patch,
      details: patch.details ?? existing.details,
      modifiedAt: [...existing.modifiedAt, nowIso()],
    };
    await this.saveNode(updated);
    return updated;
  }

  async addExit(
    fromNodeId: number,
    nickname: string,
    toNodeId: number,
  ): Promise<ExitRecord> {
    if (!this.nodes.has(fromNodeId)) throw new Error("From node not found");
    if (!this.nodes.has(toNodeId)) throw new Error("To node not found");
    const exits = [...this.getExits(fromNodeId)];
    const exitId = exits.reduce((max, e) => Math.max(max, e.exitId), 0) + 1;
    const exit: ExitRecord = {
      exitId,
      nickname,
      toNodeId,
      createdAt: nowIso(),
    };
    exits.push(exit);
    await this.saveExits(fromNodeId, exits);
    return exit;
  }

  async createArtefact(input: {
    owner: string;
    homeNodeId: number;
    title?: string;
    body: string;
    details?: Record<string, string>;
    tags?: string[];
  }): Promise<ArtefactRecord> {
    if (!this.nodes.has(input.homeNodeId)) throw new Error("Home node not found");
    const id = this.meta.nextArtefactId++;
    const createdAt = nowIso();
    const artefact: ArtefactRecord = {
      id,
      owner: input.owner,
      homeNodeId: input.homeNodeId,
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
    patch: Partial<Pick<ArtefactRecord, "title" | "body" | "details" | "tags" | "homeNodeId">>,
  ): Promise<ArtefactRecord> {
    const existing = this.artefacts.get(id);
    if (!existing) throw new Error("Artefact not found");
    if (patch.homeNodeId !== undefined && !this.nodes.has(patch.homeNodeId)) {
      throw new Error("Home node not found");
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
