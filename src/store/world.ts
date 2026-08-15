import { cp, mkdir, readdir, access, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { AccessWorld } from "../access/permissions.js";
import { normalizeDenies, normalizeGrants, stripLegacyInvites } from "../access/acl.js";
import type {
  ArtefactMeta,
  ArtefactRecord,
  Deny,
  EditLogEntry,
  EntranceGroupRecord,
  ExitRecord,
  ExitRequestMessage,
  Grant,
  GroupRecord,
  InboxMessage,
  InviteToViewMessage,
  InventoryItem,
  MetaFile,
  NoticeMessage,
  SceneMeta,
  SceneRecord,
  StaffFile,
  StaffRole,
  UserRecord,
} from "../model/types.js";
import { appendLineAtomic, readJson, readText, writeJsonAtomic, writeTextAtomic } from "./fs.js";
import { parseProseDocument, serializeProseDocument } from "./markdown.js";

export class WorldStore implements AccessWorld {
  readonly dataDir: string;
  meta: MetaFile = {
    nextSceneId: 1,
    nextArtefactId: 1,
    nextGroupId: 1,
    nextEntranceGroupId: 1,
    nextInboxId: 1,
    entranceSceneId: 1,
  };
  users = new Map<string, UserRecord>();
  scenes = new Map<number, SceneRecord>();
  exits = new Map<number, ExitRecord[]>();
  artefacts = new Map<number, ArtefactRecord>();
  groups = new Map<string, GroupRecord>();
  entranceGroups = new Map<string, EntranceGroupRecord>();
  inbox = new Map<number, InboxMessage>();
  staff: StaffFile = { roles: {} };

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  /** Drop in-memory state and re-read everything from disk (no seed copy). */
  async reload(): Promise<void> {
    this.meta = {
      nextSceneId: 1,
      nextArtefactId: 1,
      nextGroupId: 1,
      nextEntranceGroupId: 1,
      nextInboxId: 1,
      entranceSceneId: 1,
    };
    this.staff = { roles: {} };
    this.users.clear();
    this.scenes.clear();
    this.exits.clear();
    this.artefacts.clear();
    this.groups.clear();
    this.entranceGroups.clear();
    this.inbox.clear();
    await this.load();
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
    await mkdir(join(this.dataDir, "groups"), { recursive: true });
    await mkdir(join(this.dataDir, "entrance-groups"), { recursive: true });
    await mkdir(join(this.dataDir, "inbox"), { recursive: true });

    if (await exists(metaPath)) {
      this.meta = normalizeMeta(await readJson<Record<string, unknown>>(metaPath));
    }

    const staffPath = join(this.dataDir, "staff.json");
    if (await exists(staffPath)) {
      this.staff = normalizeStaff(await readJson<Record<string, unknown>>(staffPath));
    }

    for (const file of await listFiles(join(this.dataDir, "users"), ".json")) {
      const raw = await readJson<Record<string, unknown>>(join(this.dataDir, "users", file));
      const user = normalizeUser(raw);
      this.users.set(user.username, user);
    }

    const bootstrapped = this.applyManagerBootstrap();
    if (bootstrapped || !(await exists(staffPath))) {
      await this.saveStaff();
    }

    for (const file of await listFiles(join(this.dataDir, "scenes"), ".md")) {
      const id = Number(file.replace(/\.md$/, ""));
      if (!Number.isFinite(id)) continue;
      const raw = await readText(join(this.dataDir, "scenes", file));
      const { meta, body, details } = parseProseDocument<Record<string, unknown>>(raw);
      const normalised = normalizeSceneMeta(meta, id);
      this.scenes.set(id, { ...normalised, body, details });

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

    for (const file of await listFiles(join(this.dataDir, "groups"), ".json")) {
      const group = normalizeGroup(
        await readJson<Record<string, unknown>>(join(this.dataDir, "groups", file)),
      );
      this.groups.set(group.id, group);
    }

    for (const file of await listFiles(join(this.dataDir, "entrance-groups"), ".json")) {
      const eg = normalizeEntranceGroup(
        await readJson<Record<string, unknown>>(join(this.dataDir, "entrance-groups", file)),
      );
      this.entranceGroups.set(eg.id, eg);
    }

    for (const file of await listFiles(join(this.dataDir, "inbox"), ".json")) {
      const id = Number(file.replace(/\.json$/, ""));
      if (!Number.isFinite(id)) continue;
      const msg = normalizeInboxMessage(
        await readJson<Record<string, unknown>>(join(this.dataDir, "inbox", file)),
        id,
      );
      if (msg) this.inbox.set(msg.id, msg);
    }
  }

  getGroup(id: string): GroupRecord | undefined {
    return this.groups.get(id);
  }

  getEntranceGroup(id: string): EntranceGroupRecord | undefined {
    return this.entranceGroups.get(id);
  }

  rolesFor(username: string): StaffRole[] {
    return this.staff.roles[username] ?? [];
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
    const toSave: UserRecord = {
      ...user,
      description: user.description ?? "",
      details: user.details ?? {},
    };
    this.users.set(toSave.username, toSave);
    await writeJsonAtomic(join(this.dataDir, "users", `${toSave.username}.json`), toSave);
  }

  async saveScene(scene: SceneRecord): Promise<void> {
    this.scenes.set(scene.id, scene);
    const { body, details, ...meta } = scene;
    const clean = stripLegacyInvites(meta);
    const raw = serializeProseDocument(clean, body, details);
    await writeTextAtomic(join(this.dataDir, "scenes", `${scene.id}.md`), raw);
  }

  async saveStaff(): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, "staff.json"), this.staff);
  }

  async saveGroup(group: GroupRecord): Promise<void> {
    this.groups.set(group.id, group);
    await writeJsonAtomic(join(this.dataDir, "groups", `${group.id}.json`), group);
  }

  async saveEntranceGroup(group: EntranceGroupRecord): Promise<void> {
    this.entranceGroups.set(group.id, group);
    await writeJsonAtomic(join(this.dataDir, "entrance-groups", `${group.id}.json`), group);
  }

  async updateSceneAccess(
    id: number,
    patch: { grants?: Grant[]; denies?: Deny[] },
  ): Promise<SceneRecord> {
    const existing = this.scenes.get(id);
    if (!existing) throw new Error("Scene not found");
    const updated: SceneRecord = {
      ...existing,
      grants: patch.grants ?? existing.grants ?? [],
      denies: patch.denies ?? existing.denies ?? [],
    };
    delete updated.invites;
    await this.saveScene(updated);
    return updated;
  }

  async updateUserAccess(
    username: string,
    patch: { grants?: Grant[]; denies?: Deny[] },
  ): Promise<UserRecord> {
    const existing = this.users.get(username);
    if (!existing) throw new Error("User not found");
    const updated: UserRecord = {
      ...existing,
      grants: patch.grants ?? existing.grants ?? [],
      denies: patch.denies ?? existing.denies ?? [],
    };
    await this.saveUser(updated);
    return updated;
  }

  async updateUserAppearance(
    username: string,
    patch: { description?: string; details?: Record<string, string> },
  ): Promise<UserRecord> {
    const existing = this.users.get(username);
    if (!existing) throw new Error("User not found");
    const updated: UserRecord = {
      ...existing,
      description: patch.description !== undefined ? patch.description : existing.description,
      details: patch.details !== undefined ? patch.details : existing.details,
    };
    await this.saveUser(updated);
    return updated;
  }

  async createGroup(input: {
    owner: string;
    title: string;
    grants?: Grant[];
    denies?: Deny[];
  }): Promise<GroupRecord> {
    const id = String(this.meta.nextGroupId ?? 1);
    this.meta.nextGroupId = (this.meta.nextGroupId ?? 1) + 1;
    await this.saveMeta();
    const group: GroupRecord = {
      id,
      owner: input.owner,
      title: input.title,
      sceneIds: [],
      grants: input.grants ?? [],
      denies: input.denies ?? [],
      createdAt: nowIso(),
    };
    await this.saveGroup(group);
    return group;
  }

  async updateGroup(
    id: string,
    patch: Partial<Pick<GroupRecord, "title" | "grants" | "denies">>,
  ): Promise<GroupRecord> {
    const existing = this.groups.get(id);
    if (!existing) throw new Error("Group not found");
    const updated: GroupRecord = {
      ...existing,
      ...patch,
      grants: patch.grants ?? existing.grants,
      denies: patch.denies ?? existing.denies,
    };
    await this.saveGroup(updated);
    return updated;
  }

  async updateGroupAccess(
    id: string,
    patch: { grants?: Grant[]; denies?: Deny[] },
  ): Promise<GroupRecord> {
    return this.updateGroup(id, patch);
  }

  /** Assign scene to a group exclusively (or clear with null). */
  async setSceneGroup(sceneId: number, groupId: string | null): Promise<SceneRecord> {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error("Scene not found");

    const previousId = scene.groupId ?? null;
    if (previousId === groupId) return scene;

    if (groupId) {
      const dest = this.groups.get(groupId);
      if (!dest) throw new Error("Group not found");
      if (scene.owner !== dest.owner) {
        throw new Error("Scene owner must match group owner");
      }
    }

    if (previousId) {
      const prev = this.groups.get(previousId);
      if (prev) {
        await this.saveGroup({
          ...prev,
          sceneIds: prev.sceneIds.filter((id) => id !== sceneId),
        });
      }
    }

    if (groupId) {
      const group = this.groups.get(groupId);
      if (!group) throw new Error("Group not found");
      if (!group.sceneIds.includes(sceneId)) {
        await this.saveGroup({
          ...group,
          sceneIds: [...group.sceneIds, sceneId],
        });
      }
    }

    const updated: SceneRecord = {
      ...scene,
      groupId,
    };
    await this.saveScene(updated);
    return updated;
  }

  /**
   * Reassign an ungrouped scene (and artefacts the current owner has homed there).
   * Grouped scenes must be transferred via {@link transferGroupOwner}.
   */
  async transferSceneOwner(
    sceneId: number,
    toUsername: string,
    opts?: { keepAccess?: boolean; by?: string },
  ): Promise<{ scene: SceneRecord; artefacts: ArtefactRecord[] }> {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error("Scene not found");
    if (scene.groupId) {
      throw new Error("Scene is in a group; transfer the group instead");
    }
    this.assertTransferRecipient(toUsername, scene.owner);
    return this.reassignSceneOwner(sceneId, toUsername, {
      keepAccess: opts?.keepAccess !== false,
      by: opts?.by,
    });
  }

  /**
   * Reassign a group, every member scene, and artefacts each scene owner has homed there.
   */
  async transferGroupOwner(
    groupId: string,
    toUsername: string,
    opts?: { keepAccess?: boolean; by?: string },
  ): Promise<{ group: GroupRecord; scenes: SceneRecord[]; artefacts: ArtefactRecord[] }> {
    const group = this.groups.get(groupId);
    if (!group) throw new Error("Group not found");
    this.assertTransferRecipient(toUsername, group.owner);

    const from = group.owner;
    const keepAccess = opts?.keepAccess !== false;
    const grants = keepAccess ? withManageGrant(group.grants, from) : group.grants;
    const updatedGroup: GroupRecord = {
      ...group,
      owner: toUsername,
      grants,
    };
    await this.saveGroup(updatedGroup);

    const scenes: SceneRecord[] = [];
    const artefacts: ArtefactRecord[] = [];
    for (const sceneId of group.sceneIds) {
      if (!this.scenes.has(sceneId)) continue;
      const moved = await this.reassignSceneOwner(sceneId, toUsername, {
        keepAccess: false,
        by: opts?.by,
      });
      scenes.push(moved.scene);
      artefacts.push(...moved.artefacts);
    }
    return { group: updatedGroup, scenes, artefacts };
  }

  private assertTransferRecipient(toUsername: string, currentOwner: string): void {
    const to = toUsername.trim();
    if (!to || !this.users.has(to)) throw new Error("User not found");
    if (to === currentOwner) throw new Error("Already owned by that user");
  }

  private async reassignSceneOwner(
    sceneId: number,
    toUsername: string,
    opts?: { keepAccess?: boolean; by?: string },
  ): Promise<{ scene: SceneRecord; artefacts: ArtefactRecord[] }> {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error("Scene not found");
    if (scene.owner === toUsername) return { scene, artefacts: [] };
    if (!this.users.has(toUsername)) throw new Error("User not found");

    const from = scene.owner;
    const keepAccess = opts?.keepAccess === true;
    const at = nowIso();
    const by = opts?.by ?? "unknown";
    const grants = keepAccess ? withManageGrant(scene.grants, from) : scene.grants;
    const sceneFields = ["owner"];
    if (keepAccess && grants !== scene.grants) sceneFields.push("grants");

    const updatedScene: SceneRecord = {
      ...scene,
      owner: toUsername,
      grants,
      modifiedAt: [...scene.modifiedAt, at],
    };
    await this.saveScene(updatedScene);
    await this.appendEditLog("scenes", sceneId, { at, by, fields: sceneFields });

    const artefacts: ArtefactRecord[] = [];
    for (const artefact of this.artefactsAt(sceneId)) {
      if (artefact.owner !== from) continue;
      const updatedArtefact: ArtefactRecord = {
        ...artefact,
        owner: toUsername,
        modifiedAt: [...artefact.modifiedAt, at],
      };
      await this.saveArtefact(updatedArtefact);
      await this.appendEditLog("artefacts", artefact.id, { at, by, fields: ["owner"] });
      artefacts.push(updatedArtefact);
    }
    return { scene: updatedScene, artefacts };
  }

  listGroups(): GroupRecord[] {
    return [...this.groups.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }

  async createEntranceGroup(input: {
    title: string;
    entranceSceneId: number;
    sceneIds?: number[];
  }): Promise<EntranceGroupRecord> {
    if (!this.scenes.has(input.entranceSceneId)) throw new Error("Entrance scene not found");
    const id = String(this.meta.nextEntranceGroupId ?? 1);
    this.meta.nextEntranceGroupId = (this.meta.nextEntranceGroupId ?? 1) + 1;
    await this.saveMeta();
    const sceneIds = [...new Set([input.entranceSceneId, ...(input.sceneIds ?? [])])];
    const group: EntranceGroupRecord = {
      id,
      title: input.title,
      entranceSceneId: input.entranceSceneId,
      sceneIds,
    };
    await this.saveEntranceGroup(group);
    for (const sceneId of sceneIds) {
      const scene = this.scenes.get(sceneId);
      if (!scene) continue;
      if (scene.entranceGroupId !== id) {
        await this.saveScene({ ...scene, entranceGroupId: id });
      }
    }
    return group;
  }

  async setSceneEntranceGroup(
    sceneId: number,
    entranceGroupId: string | null,
  ): Promise<SceneRecord> {
    const scene = this.scenes.get(sceneId);
    if (!scene) throw new Error("Scene not found");
    const previousId = scene.entranceGroupId ?? null;
    if (previousId === entranceGroupId) return scene;

    if (previousId) {
      const prev = this.entranceGroups.get(previousId);
      if (prev) {
        await this.saveEntranceGroup({
          ...prev,
          sceneIds: prev.sceneIds.filter((id) => id !== sceneId),
        });
      }
    }

    if (entranceGroupId) {
      const group = this.entranceGroups.get(entranceGroupId);
      if (!group) throw new Error("Entrance group not found");
      if (!group.sceneIds.includes(sceneId)) {
        await this.saveEntranceGroup({
          ...group,
          sceneIds: [...group.sceneIds, sceneId],
        });
      }
    }

    const updated: SceneRecord = { ...scene, entranceGroupId };
    await this.saveScene(updated);
    return updated;
  }

  findExit(fromSceneId: number, exitKey: string): ExitRecord | undefined {
    const exits = this.getExits(fromSceneId);
    const asNum = Number(exitKey);
    if (Number.isFinite(asNum) && String(asNum) === exitKey.trim()) {
      return exits.find((e) => e.exitId === asNum);
    }
    const needle = exitKey.trim().toLowerCase();
    return exits.find((e) => e.nickname.toLowerCase() === needle);
  }

  listEntranceGroups(): EntranceGroupRecord[] {
    return [...this.entranceGroups.values()].sort((a, b) => Number(a.id) - Number(b.id));
  }

  listScenesOwnedBy(username: string): SceneRecord[] {
    return [...this.scenes.values()]
      .filter((s) => s.owner === username)
      .sort((a, b) => a.id - b.id);
  }

  listArtefactsOwnedBy(username: string): ArtefactRecord[] {
    return [...this.artefacts.values()]
      .filter((a) => a.owner === username)
      .sort((a, b) => a.id - b.id);
  }

  listUsers(): UserRecord[] {
    return [...this.users.values()].sort((a, b) => a.username.localeCompare(b.username));
  }

  /**
   * Resolve teleport target: if destination is in an entrance group and the
   * requester is not already "inside" that group, redirect to the entrance.
   * Owners teleporting to their own scenes skip entrance-group redirection
   * (CMS / “my scenes” navigation). Live Join uses `asJoin` to land when
   * the destination is readable without bouncing to the entrance.
   */
  resolveTeleportTarget(
    requestedSceneId: number,
    fromSceneId: number | undefined,
    opts?: { asOwnerUsername?: string; asJoin?: boolean },
  ): { sceneId: number; redirected: boolean } {
    const scene = this.scenes.get(requestedSceneId);
    if (!scene?.entranceGroupId) {
      return { sceneId: requestedSceneId, redirected: false };
    }
    if (opts?.asJoin) {
      return { sceneId: requestedSceneId, redirected: false };
    }
    if (opts?.asOwnerUsername && scene.owner === opts.asOwnerUsername) {
      return { sceneId: requestedSceneId, redirected: false };
    }
    const eg = this.entranceGroups.get(scene.entranceGroupId);
    if (!eg) return { sceneId: requestedSceneId, redirected: false };

    const fromInside =
      fromSceneId !== undefined &&
      (() => {
        const from = this.scenes.get(fromSceneId);
        return from?.entranceGroupId === eg.id;
      })();

    if (fromInside) return { sceneId: requestedSceneId, redirected: false };
    if (requestedSceneId === eg.entranceSceneId) {
      return { sceneId: requestedSceneId, redirected: false };
    }
    return { sceneId: eg.entranceSceneId, redirected: true };
  }

  async setStaffRoles(username: string, roles: StaffRole[]): Promise<StaffFile> {
    if (!this.users.has(username)) throw new Error("User not found");
    const cleaned = [...new Set(roles)].filter(
      (r): r is StaffRole => r === "moderator" || r === "organiser" || r === "manager",
    );
    if (cleaned.length) this.staff.roles[username] = cleaned;
    else delete this.staff.roles[username];
    await this.saveStaff();
    return this.staff;
  }

  worldEntranceSceneId(): number {
    const id = this.meta.entranceSceneId ?? 1;
    return Number.isFinite(id) && id > 0 ? id : 1;
  }

  async deleteScene(id: number): Promise<void> {
    const scene = this.scenes.get(id);
    if (!scene) throw new Error("Scene not found");
    if (id === this.worldEntranceSceneId()) {
      throw new Error("Cannot delete the world entrance scene");
    }

    for (const eg of this.entranceGroups.values()) {
      if (eg.entranceSceneId !== id) continue;
      const remaining = eg.sceneIds.filter((s) => s !== id);
      if (remaining.length > 0) {
        throw new Error(
          `Scene ${id} is the entrance for "${eg.title}" (#${eg.id}); reassign the entrance or clear other members first`,
        );
      }
      this.entranceGroups.delete(eg.id);
      try {
        await unlink(join(this.dataDir, "entrance-groups", `${eg.id}.json`));
      } catch {
        /* ignore */
      }
    }

    for (const artefact of [...this.artefacts.values()].filter((a) => a.homeSceneId === id)) {
      await this.deleteArtefact(artefact.id);
    }

    for (const [fromId, exits] of [...this.exits.entries()]) {
      if (fromId === id) continue;
      const filtered = exits.filter((e) => e.toSceneId !== id);
      if (filtered.length !== exits.length) {
        await this.saveExits(fromId, filtered);
      }
    }

    const groupId = scene.groupId;
    const egId = scene.entranceGroupId;
    this.scenes.delete(id);
    this.exits.delete(id);

    await rm(join(this.dataDir, "scenes", `${id}.md`), { force: true });
    await rm(join(this.dataDir, "scenes", `${id}.exits.json`), { force: true });
    await rm(join(this.dataDir, "scenes", `${id}.edits.jsonl`), { force: true });
    await rm(join(this.dataDir, "scenes", `${id}.versions`), { recursive: true, force: true });

    if (groupId) {
      const g = this.groups.get(groupId);
      if (g) {
        await this.saveGroup({ ...g, sceneIds: g.sceneIds.filter((s) => s !== id) });
      }
    }
    if (egId) {
      const eg = this.entranceGroups.get(egId);
      if (eg) {
        await this.saveEntranceGroup({
          ...eg,
          sceneIds: eg.sceneIds.filter((s) => s !== id),
        });
      }
    }
  }

  async deleteArtefact(id: number): Promise<void> {
    if (!this.artefacts.has(id)) throw new Error("Artefact not found");
    this.artefacts.delete(id);
    await rm(join(this.dataDir, "artefacts", `${id}.md`), { force: true });
    await rm(join(this.dataDir, "artefacts", `${id}.edits.jsonl`), { force: true });
    await rm(join(this.dataDir, "artefacts", `${id}.versions`), { recursive: true, force: true });
    for (const user of this.users.values()) {
      if (user.inventory.some((i) => i.artefactId === id)) {
        await this.saveUser({
          ...user,
          inventory: user.inventory.filter((i) => i.artefactId !== id),
        });
      }
    }
  }

  private applyManagerBootstrap(): boolean {
    const env = process.env.PROSEDEN_MANAGERS ?? "";
    let changed = false;
    for (const name of env.split(",").map((s) => s.trim()).filter(Boolean)) {
      // Allow names that are not users yet (pre-provision via env).
      const roles = new Set(this.staff.roles[name] ?? []);
      if (!roles.has("manager")) {
        roles.add("manager");
        changed = true;
      }
      this.staff.roles[name] = [...roles];
    }
    return changed;
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
      description: "",
      details: {},
    };
    await this.saveUser(user);
    return user;
  }

  async updatePassword(
    username: string,
    passwordHash: string,
    passwordSalt: string,
  ): Promise<UserRecord> {
    const existing = this.users.get(username);
    if (!existing) throw new Error("User not found");
    const updated: UserRecord = { ...existing, passwordHash, passwordSalt };
    await this.saveUser(updated);
    return updated;
  }

  async createScene(input: {
    owner: string;
    title?: string;
    body: string;
    details?: Record<string, string>;
    visibility?: SceneRecord["visibility"];
  }): Promise<SceneRecord> {
    const id = this.meta.nextSceneId++;
    await this.saveMeta();
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
    return scene;
  }

  async updateScene(
    id: number,
    patch: Partial<
      Pick<SceneRecord, "title" | "body" | "details" | "visibility" | "isJunction">
    >,
    opts?: { by?: string; retainSnapshot?: boolean },
  ): Promise<SceneRecord> {
    const existing = this.scenes.get(id);
    if (!existing) throw new Error("Scene not found");
    const fields = changedFields(existing, patch);
    const at = nowIso();
    const updated: SceneRecord = {
      ...existing,
      ...definedEntries(patch),
      details: patch.details ?? existing.details,
      modifiedAt: [...existing.modifiedAt, at],
    };
    await this.saveScene(updated);

    const entry: EditLogEntry = {
      at,
      by: opts?.by ?? "unknown",
      fields,
    };
    if (opts?.retainSnapshot) {
      const versionId = versionIdFromIso(at);
      await this.saveSceneSnapshot(id, versionId, existing);
      entry.retained = true;
      entry.versionId = versionId;
    }
    if (fields.length || opts?.retainSnapshot) {
      await this.appendEditLog("scenes", id, entry);
    }
    return updated;
  }

  async updateArtefact(
    id: number,
    patch: Partial<Pick<ArtefactRecord, "title" | "body" | "details" | "tags" | "homeSceneId">>,
    opts?: { by?: string; retainSnapshot?: boolean },
  ): Promise<ArtefactRecord> {
    const existing = this.artefacts.get(id);
    if (!existing) throw new Error("Artefact not found");
    if (patch.homeSceneId !== undefined && !this.scenes.has(patch.homeSceneId)) {
      throw new Error("Home scene not found");
    }
    const fields = changedFields(existing, patch);
    const at = nowIso();
    const updated: ArtefactRecord = {
      ...existing,
      ...definedEntries(patch),
      details: patch.details ?? existing.details,
      tags: patch.tags ?? existing.tags,
      modifiedAt: [...existing.modifiedAt, at],
    };
    await this.saveArtefact(updated);

    const entry: EditLogEntry = {
      at,
      by: opts?.by ?? "unknown",
      fields,
    };
    if (opts?.retainSnapshot) {
      const versionId = versionIdFromIso(at);
      await this.saveArtefactSnapshot(id, versionId, existing);
      entry.retained = true;
      entry.versionId = versionId;
    }
    if (fields.length || opts?.retainSnapshot) {
      await this.appendEditLog("artefacts", id, entry);
    }
    return updated;
  }

  async listEditLog(kind: "scenes" | "artefacts", id: number): Promise<EditLogEntry[]> {
    const path = join(this.dataDir, kind, `${id}.edits.jsonl`);
    if (!(await exists(path))) return [];
    const raw = await readText(path);
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as EditLogEntry);
  }

  async getSceneSnapshot(id: number, versionId: string): Promise<SceneRecord | undefined> {
    const path = join(this.dataDir, "scenes", `${id}.versions`, `${versionId}.md`);
    if (!(await exists(path))) return undefined;
    const raw = await readText(path);
    const { meta, body, details } = parseProseDocument<Record<string, unknown>>(raw);
    return { ...normalizeSceneMeta(meta, id), body, details };
  }

  async getArtefactSnapshot(id: number, versionId: string): Promise<ArtefactRecord | undefined> {
    const path = join(this.dataDir, "artefacts", `${id}.versions`, `${versionId}.md`);
    if (!(await exists(path))) return undefined;
    const raw = await readText(path);
    const { meta, body, details } = parseProseDocument<Record<string, unknown>>(raw);
    const normalised = normalizeArtefactMeta(meta);
    return { ...normalised, id, body, details };
  }

  async restoreSceneSnapshot(
    id: number,
    versionId: string,
    by: string,
  ): Promise<SceneRecord> {
    const snap = await this.getSceneSnapshot(id, versionId);
    if (!snap) throw new Error("Snapshot not found");
    return this.updateScene(
      id,
      {
        title: snap.title,
        body: snap.body,
        details: snap.details,
        visibility: snap.visibility,
        isJunction: snap.isJunction,
      },
      { by, retainSnapshot: false },
    );
  }

  async restoreArtefactSnapshot(
    id: number,
    versionId: string,
    by: string,
  ): Promise<ArtefactRecord> {
    const snap = await this.getArtefactSnapshot(id, versionId);
    if (!snap) throw new Error("Snapshot not found");
    return this.updateArtefact(
      id,
      {
        title: snap.title,
        body: snap.body,
        details: snap.details,
        tags: snap.tags,
        homeSceneId: snap.homeSceneId,
      },
      { by, retainSnapshot: false },
    );
  }

  private async appendEditLog(
    kind: "scenes" | "artefacts",
    id: number,
    entry: EditLogEntry,
  ): Promise<void> {
    const path = join(this.dataDir, kind, `${id}.edits.jsonl`);
    await appendLineAtomic(path, JSON.stringify(entry));
  }

  private async saveSceneSnapshot(
    id: number,
    versionId: string,
    scene: SceneRecord,
  ): Promise<void> {
    const { body, details, ...meta } = scene;
    const raw = serializeProseDocument(stripLegacyInvites(meta), body, details);
    await writeTextAtomic(
      join(this.dataDir, "scenes", `${id}.versions`, `${versionId}.md`),
      raw,
    );
  }

  private async saveArtefactSnapshot(
    id: number,
    versionId: string,
    artefact: ArtefactRecord,
  ): Promise<void> {
    const { body, details, ...meta } = artefact;
    const raw = serializeProseDocument(meta, body, details);
    await writeTextAtomic(
      join(this.dataDir, "artefacts", `${id}.versions`, `${versionId}.md`),
      raw,
    );
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

  async removeExit(fromSceneId: number, exitKey: string): Promise<ExitRecord> {
    if (!this.scenes.has(fromSceneId)) throw new Error("From scene not found");
    const exit = this.findExit(fromSceneId, exitKey);
    if (!exit) throw new Error(`No exit matching "${exitKey}"`);
    const exits = this.getExits(fromSceneId).filter((e) => e.exitId !== exit.exitId);
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
    await this.saveMeta();
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
    return artefact;
  }

  async collectArtefact(username: string, artefactId: number): Promise<UserRecord> {
    const user = this.users.get(username);
    if (!user) throw new Error("User not found");
    if (!this.artefacts.has(artefactId)) throw new Error("Artefact not found");
    if (user.inventory.some((i) => i.artefactId === artefactId)) {
      return user;
    }
    const item: InventoryItem = { artefactId };
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

  getInboxMessage(id: number): InboxMessage | undefined {
    return this.inbox.get(id);
  }

  listInboxFor(username: string): InboxMessage[] {
    return [...this.inbox.values()]
      .filter((m) => m.toUser === username)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.id - a.id));
  }

  inboxCountFor(username: string): number {
    let n = 0;
    for (const m of this.inbox.values()) {
      if (m.toUser === username) n += 1;
    }
    return n;
  }

  findDuplicateExitRequest(
    toUser: string,
    fromSceneId: number,
    toSceneId: number,
    nickname: string,
  ): InboxMessage | undefined {
    const nick = nickname.toLowerCase();
    for (const m of this.inbox.values()) {
      if (
        m.type === "exit_request" &&
        m.toUser === toUser &&
        m.fromSceneId === fromSceneId &&
        m.toSceneId === toSceneId &&
        m.nickname.toLowerCase() === nick
      ) {
        return m;
      }
    }
    return undefined;
  }

  findDuplicateViewInvite(
    toUser: string,
    fromUser: string,
    sceneId: number,
  ): InviteToViewMessage | undefined {
    for (const m of this.inbox.values()) {
      if (
        m.type === "invite_to_view" &&
        m.toUser === toUser &&
        m.fromUser === fromUser &&
        m.sceneId === sceneId
      ) {
        return m;
      }
    }
    return undefined;
  }

  async createInboxMessage(
    input:
      | (Omit<ExitRequestMessage, "id" | "createdAt"> & { createdAt?: string })
      | (Omit<NoticeMessage, "id" | "createdAt"> & { createdAt?: string })
      | (Omit<InviteToViewMessage, "id" | "createdAt"> & { createdAt?: string }),
  ): Promise<InboxMessage> {
    const id = this.meta.nextInboxId ?? 1;
    this.meta.nextInboxId = id + 1;
    await this.saveMeta();
    const createdAt = input.createdAt ?? nowIso();
    let message: InboxMessage;
    if (input.type === "exit_request") {
      message = {
        id,
        type: "exit_request",
        toUser: input.toUser,
        fromUser: input.fromUser,
        createdAt,
        subject: input.subject,
        body: input.body,
        fromSceneId: input.fromSceneId,
        toSceneId: input.toSceneId,
        nickname: input.nickname,
      };
    } else if (input.type === "invite_to_view") {
      message = {
        id,
        type: "invite_to_view",
        toUser: input.toUser,
        fromUser: input.fromUser,
        createdAt,
        subject: input.subject,
        body: input.body,
        sceneId: input.sceneId,
      };
    } else {
      message = {
        id,
        type: "notice",
        toUser: input.toUser,
        fromUser: input.fromUser,
        createdAt,
        subject: input.subject,
        body: input.body,
      };
    }
    await this.saveInboxMessage(message);
    return message;
  }

  async saveInboxMessage(message: InboxMessage): Promise<void> {
    this.inbox.set(message.id, message);
    await writeJsonAtomic(join(this.dataDir, "inbox", `${message.id}.json`), message);
  }

  async deleteInboxMessage(id: number): Promise<InboxMessage> {
    const existing = this.inbox.get(id);
    if (!existing) throw new Error("Inbox message not found");
    this.inbox.delete(id);
    await unlink(join(this.dataDir, "inbox", `${id}.json`));
    return existing;
  }
}

function normalizeMeta(raw: Record<string, unknown>): MetaFile {
  const nextSceneId = Number(raw.nextSceneId ?? raw.nextNodeId ?? 1);
  const nextArtefactId = Number(raw.nextArtefactId ?? 1);
  const nextGroupId = Number(raw.nextGroupId ?? 1);
  const nextEntranceGroupId = Number(raw.nextEntranceGroupId ?? 1);
  const nextInboxId = Number(raw.nextInboxId ?? 1);
  const entranceSceneId = Number(raw.entranceSceneId ?? 1);
  const schemaVersion = Number(raw.schemaVersion);
  const meta: MetaFile = {
    nextSceneId: Number.isFinite(nextSceneId) ? nextSceneId : 1,
    nextArtefactId: Number.isFinite(nextArtefactId) ? nextArtefactId : 1,
    nextGroupId: Number.isFinite(nextGroupId) ? nextGroupId : 1,
    nextEntranceGroupId: Number.isFinite(nextEntranceGroupId) ? nextEntranceGroupId : 1,
    nextInboxId: Number.isFinite(nextInboxId) ? nextInboxId : 1,
    entranceSceneId:
      Number.isFinite(entranceSceneId) && entranceSceneId > 0 ? entranceSceneId : 1,
  };
  if (Number.isFinite(schemaVersion)) {
    meta.schemaVersion = schemaVersion;
  }
  return meta;
}

function normalizeUser(raw: Record<string, unknown>): UserRecord {
  const lastSceneId = Number(raw.lastSceneId);
  return {
    username: String(raw.username ?? ""),
    passwordHash: String(raw.passwordHash ?? ""),
    passwordSalt: String(raw.passwordSalt ?? ""),
    createdAt: String(raw.createdAt ?? nowIso()),
    inventory: Array.isArray(raw.inventory)
      ? (raw.inventory as InventoryItem[]).map((i) => ({
          artefactId: Number(i.artefactId),
        }))
      : [],
    description: String(raw.description ?? ""),
    details: normalizeUserDetails(raw.details),
    grants: normalizeGrants(raw.grants),
    denies: normalizeDenies(raw.denies),
    lastSceneId: Number.isFinite(lastSceneId) && lastSceneId > 0 ? lastSceneId : undefined,
    lastSeenAt: raw.lastSeenAt !== undefined ? String(raw.lastSeenAt) : undefined,
  };
}

function normalizeUserDetails(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = String(v);
  }
  return out;
}

function normalizeSceneMeta(raw: Record<string, unknown>, id: number): SceneMeta {
  const grants = normalizeGrants(raw.grants, raw.invites);
  const denies = normalizeDenies(raw.denies);
  return {
    id,
    owner: String(raw.owner ?? ""),
    visibility: raw.visibility === "public" ? "public" : "private",
    title: raw.title !== undefined ? String(raw.title) : undefined,
    createdAt: String(raw.createdAt ?? nowIso()),
    modifiedAt: Array.isArray(raw.modifiedAt) ? raw.modifiedAt.map(String) : [],
    groupId: raw.groupId != null && raw.groupId !== "" ? String(raw.groupId) : null,
    grants,
    denies,
    entranceGroupId:
      raw.entranceGroupId != null && raw.entranceGroupId !== ""
        ? String(raw.entranceGroupId)
        : null,
    isJunction: Boolean(raw.isJunction),
  };
}

function normalizeGroup(raw: Record<string, unknown>): GroupRecord {
  return {
    id: String(raw.id ?? ""),
    owner: String(raw.owner ?? ""),
    title: String(raw.title ?? ""),
    sceneIds: Array.isArray(raw.sceneIds) ? raw.sceneIds.map(Number).filter(Number.isFinite) : [],
    grants: normalizeGrants(raw.grants),
    denies: normalizeDenies(raw.denies),
    createdAt: String(raw.createdAt ?? nowIso()),
  };
}

function normalizeEntranceGroup(raw: Record<string, unknown>): EntranceGroupRecord {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    entranceSceneId: Number(raw.entranceSceneId),
    sceneIds: Array.isArray(raw.sceneIds) ? raw.sceneIds.map(Number).filter(Number.isFinite) : [],
  };
}

function normalizeInboxMessage(
  raw: Record<string, unknown>,
  fallbackId: number,
): InboxMessage | undefined {
  const id = Number(raw.id ?? fallbackId);
  if (!Number.isFinite(id)) return undefined;
  const type = String(raw.type ?? "");
  const base = {
    id,
    toUser: String(raw.toUser ?? ""),
    fromUser: String(raw.fromUser ?? ""),
    createdAt: String(raw.createdAt ?? nowIso()),
    subject: String(raw.subject ?? ""),
    body: String(raw.body ?? ""),
  };
  if (type === "exit_request") {
    const fromSceneId = Number(raw.fromSceneId);
    const toSceneId = Number(raw.toSceneId);
    if (!Number.isFinite(fromSceneId) || !Number.isFinite(toSceneId)) return undefined;
    return {
      ...base,
      type: "exit_request",
      fromSceneId,
      toSceneId,
      nickname: String(raw.nickname ?? ""),
    };
  }
  if (type === "invite_to_view") {
    const sceneId = Number(raw.sceneId);
    if (!Number.isFinite(sceneId)) return undefined;
    return { ...base, type: "invite_to_view", sceneId };
  }
  if (type === "notice") {
    return { ...base, type: "notice" };
  }
  return undefined;
}

function normalizeStaff(raw: Record<string, unknown>): StaffFile {
  const roles: Record<string, StaffRole[]> = {};
  const src = (raw.roles && typeof raw.roles === "object" ? raw.roles : raw) as Record<
    string,
    unknown
  >;
  for (const [username, value] of Object.entries(src)) {
    if (username === "roles") continue;
    const list = Array.isArray(value) ? value : [value];
    const cleaned: StaffRole[] = [];
    for (const r of list) {
      const s = String(r);
      if (s === "moderator" || s === "organiser" || s === "manager") cleaned.push(s);
    }
    if (cleaned.length) roles[username] = cleaned;
  }
  return { roles };
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

function withManageGrant(grants: Grant[] | undefined, who: string): Grant[] {
  const list = grants ?? [];
  const existing = list.find((g) => g.who === who);
  if (existing?.rights.includes("manage")) return list;
  if (existing) {
    return list.map((g) =>
      g.who === who ? { ...g, rights: [...new Set([...g.rights, "manage" as const])] } : g,
    );
  }
  return [...list, { who, rights: ["manage"] }];
}

function nowIso(): string {
  return new Date().toISOString();
}

function versionIdFromIso(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function changedFields(
  existing: object,
  patch: object,
): string[] {
  const fields: string[] = [];
  const prev = existing as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue;
    if (JSON.stringify(prev[key]) !== JSON.stringify(value)) fields.push(key);
  }
  return fields;
}

function definedEntries<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
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
