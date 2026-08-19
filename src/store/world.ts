import { cp, mkdir, readdir, access, rename, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { canManage, canRead, type AccessWorld } from "../access/permissions.js";
import { normalizeDenies, normalizeGrants, stripLegacyInvites } from "../access/acl.js";
import type { AlchemyRecipe, FlagValue, QuestFile } from "../model/logic.js";
import {
  alchemyGivesIds,
  alchemyRecipesForDisk,
  badgeDefsById,
  evaluateQuests,
  parseAlchemyRecipes,
  parseQuestFile,
  questFileForDisk,
  questGiveArtefactIds,
  QuestValidationError,
} from "../logic/quests.js";
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
  PeerMessage,
  SceneMeta,
  SceneRecord,
  SceneSubscriptionChangeKind,
  SceneUpdateMessage,
  SettingsFile,
  StaffFile,
  StaffRole,
  UserBadge,
  UserCache,
  UserRecord,
} from "../model/types.js";
import type { FlagRef } from "../model/logic.js";
import { appendLineAtomic, readJson, readText, writeJsonAtomic, writeTextAtomic } from "./fs.js";
import { parseProseDocument, serializeProseDocument } from "./markdown.js";
import { parseDetailWhenMap, parseOptionalFlagRef } from "../logic/pred.js";
import { logQuestFault } from "../logic/log.js";
import { mergeGrantedBadges, parseUserBadges } from "./user-badges.js";

export type WorldOverviewCounts = {
  users: number;
  scenes: number;
  artefacts: number;
  exits: number;
  groups: number;
  entranceGroups: number;
  quests: number;
  userQuestFiles: number;
  alchemyRecipes: number;
  userAlchemyFiles: number;
  inbox: number;
  staff: number;
};

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
  /** Per-scene subscriber usernames (`{id}.subs.json`). */
  subscriptions = new Map<number, string[]>();
  artefacts = new Map<number, ArtefactRecord>();
  groups = new Map<string, GroupRecord>();
  entranceGroups = new Map<string, EntranceGroupRecord>();
  inbox = new Map<number, InboxMessage>();
  staff: StaffFile = { roles: {} };
  settings: SettingsFile = { peerMessagingEnabled: true };
  /** username → flags */
  userFlags = new Map<string, Record<string, FlagValue>>();
  /** username → held badges */
  userBadges = new Map<string, UserBadge[]>();
  /** Manager `quests/<name>.json` files (file content). */
  masterQuests: QuestFile[] = [];
  /** Per-user `quests/users/<name>.json` file contents (no author field). */
  userQuestFiles = new Map<string, QuestFile>();
  /** Merged manager-first + users for eval (user quests have author set). */
  quests: QuestFile[] = [];
  /** Master `alchemy/recipes.json` (file content; unrestricted gives). */
  masterAlchemyRecipes: AlchemyRecipe[] = [];
  /** Per-user `alchemy/users/<name>.json` file contents (no author / id prefix). */
  userAlchemyFiles = new Map<string, AlchemyRecipe[]>();
  /** Merged master-first + users for combine (user recipes have author + prefixed id). */
  alchemyRecipes: AlchemyRecipe[] = [];

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
    this.settings = { peerMessagingEnabled: true };
    this.users.clear();
    this.scenes.clear();
    this.exits.clear();
    this.subscriptions.clear();
    this.artefacts.clear();
    this.groups.clear();
    this.entranceGroups.clear();
    this.inbox.clear();
    this.userFlags.clear();
    this.userBadges.clear();
    this.masterQuests = [];
    this.userQuestFiles.clear();
    this.quests = [];
    this.masterAlchemyRecipes = [];
    this.userAlchemyFiles.clear();
    this.alchemyRecipes = [];
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
    await mkdir(join(this.dataDir, "quests"), { recursive: true });
    await mkdir(join(this.dataDir, "quests", "users"), { recursive: true });
    await mkdir(join(this.dataDir, "alchemy"), { recursive: true });
    await mkdir(join(this.dataDir, "alchemy", "users"), { recursive: true });

    if (await exists(metaPath)) {
      this.meta = normalizeMeta(await readJson<Record<string, unknown>>(metaPath));
    }

    const staffPath = join(this.dataDir, "staff.json");
    if (await exists(staffPath)) {
      this.staff = normalizeStaff(await readJson<Record<string, unknown>>(staffPath));
    }

    const settingsPath = join(this.dataDir, "settings.json");
    if (await exists(settingsPath)) {
      this.settings = normalizeSettings(await readJson<Record<string, unknown>>(settingsPath));
    } else {
      this.settings = { peerMessagingEnabled: true };
    }

    for (const file of await listFiles(join(this.dataDir, "users"), ".json")) {
      if (file.endsWith(".flags.json") || file.endsWith(".badges.json")) continue;
      const raw = await readJson<Record<string, unknown>>(join(this.dataDir, "users", file));
      const user = normalizeUser(raw);
      this.users.set(user.username, user);
    }

    for (const file of await listFiles(join(this.dataDir, "users"), ".flags.json")) {
      const username = file.replace(/\.flags\.json$/, "");
      const raw = await readJson<Record<string, FlagValue>>(join(this.dataDir, "users", file));
      this.userFlags.set(username, raw && typeof raw === "object" ? raw : {});
    }

    for (const file of await listFiles(join(this.dataDir, "users"), ".badges.json")) {
      const username = file.replace(/\.badges\.json$/, "");
      const raw = await readJson<unknown>(join(this.dataDir, "users", file));
      this.userBadges.set(username, parseUserBadges(raw));
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

      const subsPath = join(this.dataDir, "scenes", `${id}.subs.json`);
      if (await exists(subsPath)) {
        this.subscriptions.set(id, normalizeSubs(await readJson<unknown>(subsPath)));
      } else {
        this.subscriptions.set(id, []);
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

    // After scenes/artefacts/groups: user quest/alchemy grant ACL needs them.
    await this.loadLogicFiles();

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

  /** In-memory cache bag on the user; created empty on first access. */
  private userCache(username: string): UserCache | undefined {
    const user = this.users.get(username);
    if (!user) return undefined;
    if (!user.cache) user.cache = {};
    return user.cache;
  }

  private cachedNumber(
    username: string,
    key: keyof UserCache,
    compute: () => number,
  ): number {
    const bag = this.userCache(username);
    if (!bag) return compute();
    const cur = bag[key];
    if (typeof cur === "number") return cur;
    const n = compute();
    bag[key] = n;
    return n;
  }

  private bumpCachedNumber(username: string, key: keyof UserCache, delta: number): void {
    const bag = this.users.get(username)?.cache;
    const cur = bag?.[key];
    if (!bag || typeof cur !== "number") return;
    bag[key] = cur + delta;
  }

  /** Owner-only scene count. Fills `user.cache.scenesOwned` on first get. */
  scenesOwned(username: string): number {
    return this.cachedNumber(username, "scenesOwned", () => {
      let n = 0;
      for (const s of this.scenes.values()) {
        if (s.owner === username) n += 1;
      }
      return n;
    });
  }

  async saveMeta(): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, "meta.json"), this.meta);
  }

  async saveUser(user: UserRecord): Promise<void> {
    const { cache: incomingCache, ...rest } = user;
    const existing = this.users.get(user.username);
    const toSave: UserRecord = {
      ...rest,
      description: rest.description ?? "",
      details: rest.details ?? {},
    };
    const nextCache = incomingCache ?? existing?.cache;
    if (nextCache) toSave.cache = nextCache;
    this.users.set(toSave.username, toSave);
    const onDisk: UserRecord = { ...toSave };
    delete onDisk.cache;
    await writeJsonAtomic(join(this.dataDir, "users", `${toSave.username}.json`), onDisk);
  }

  getUserFlags(username: string): Record<string, FlagValue> {
    return { ...(this.userFlags.get(username) ?? {}) };
  }

  getUserBadges(username: string): UserBadge[] {
    return (this.userBadges.get(username) ?? []).map((b) => ({ ...b }));
  }

  async saveUserFlags(username: string, flags: Record<string, FlagValue>): Promise<void> {
    this.userFlags.set(username, flags);
    await writeJsonAtomic(join(this.dataDir, "users", `${username}.flags.json`), flags);
  }

  async saveUserBadges(username: string, badges: UserBadge[]): Promise<void> {
    this.userBadges.set(username, badges.map((b) => ({ ...b })));
    await writeJsonAtomic(join(this.dataDir, "users", `${username}.badges.json`), badges);
  }

  listQuests(): QuestFile[] {
    return [...this.quests];
  }

  /** Manager quest files only (`quests/<name>.json`). */
  listMasterQuests(): QuestFile[] {
    return [...this.masterQuests];
  }

  getQuest(name: string): QuestFile | undefined {
    return this.quests.find((q) => q.name === name);
  }

  getMasterQuest(name: string): QuestFile | undefined {
    return this.masterQuests.find((q) => q.name === name);
  }

  badgeTitle(id: string): string {
    return badgeDefsById(this.quests).get(id)?.title ?? id;
  }

  async loadLogicFiles(): Promise<void> {
    await mkdir(join(this.dataDir, "quests"), { recursive: true });
    await mkdir(join(this.dataDir, "quests", "users"), { recursive: true });

    const master: QuestFile[] = [];
    const masterNames = new Set<string>();
    for (const file of await listFiles(join(this.dataDir, "quests"), ".json")) {
      try {
        const raw = await readJson<unknown>(join(this.dataDir, "quests", file));
        const quest = parseQuestFile(raw);
        master.push(quest);
        masterNames.add(quest.name);
      } catch (err) {
        logQuestFault(`load quest ${file}`, err);
      }
    }
    master.sort((a, b) => a.name.localeCompare(b.name));
    this.masterQuests = master;

    const userFiles = new Map<string, QuestFile>();
    const merged: QuestFile[] = [...master];
    const usersDir = join(this.dataDir, "quests", "users");
    for (const file of await listFiles(usersDir, ".json")) {
      const username = file.replace(/\.json$/, "");
      try {
        const parsed = parseQuestFile(await readJson<unknown>(join(usersDir, file)));
        userFiles.set(username, parsed);
        if (parsed.name !== username) {
          logQuestFault(
            `quest user ${username}: name must be username`,
            new Error(`got "${parsed.name}"`),
          );
          continue;
        }
        if (masterNames.has(parsed.name)) {
          logQuestFault(
            `quest user ${username}: skipped (manager quest owns namespace)`,
            new Error(`manager quest "${parsed.name}" already exists`),
          );
          continue;
        }
        if (!this.userQuestGrantsAllowed(username, parsed)) {
          logQuestFault(
            `quest user ${username}: grant not allowed`,
            new Error("canManage required on home scene for each giveArtefact"),
          );
          continue;
        }
        merged.push({ ...parsed, author: username });
      } catch (err) {
        logQuestFault(`load quests/users/${file}`, err);
      }
    }
    this.userQuestFiles = userFiles;
    this.quests = merged;

    await this.loadAlchemyFiles();
  }

  async loadAlchemyFiles(): Promise<void> {
    await mkdir(join(this.dataDir, "alchemy"), { recursive: true });
    await mkdir(join(this.dataDir, "alchemy", "users"), { recursive: true });

    const recipesPath = join(this.dataDir, "alchemy", "recipes.json");
    let master: AlchemyRecipe[] = [];
    if (await exists(recipesPath)) {
      try {
        master = parseAlchemyRecipes(await readJson<unknown>(recipesPath));
      } catch (err) {
        logQuestFault("load alchemy recipes.json", err);
        master = [];
      }
    } else {
      await writeJsonAtomic(recipesPath, []);
      master = [];
    }
    this.masterAlchemyRecipes = master;

    const userFiles = new Map<string, AlchemyRecipe[]>();
    const merged: AlchemyRecipe[] = [...master];
    const usersDir = join(this.dataDir, "alchemy", "users");
    for (const file of await listFiles(usersDir, ".json")) {
      const username = file.replace(/\.json$/, "");
      try {
        const parsed = parseAlchemyRecipes(await readJson<unknown>(join(usersDir, file)));
        userFiles.set(username, parsed);
        for (const recipe of parsed) {
          if (!this.userAlchemyRecipeGrantsAllowed(username, recipe)) {
            logQuestFault(
              `alchemy user ${username} recipe ${recipe.id}: grant not allowed`,
              new Error("canManage required on home scene for each gives artefact"),
            );
            continue;
          }
          merged.push({
            ...recipe,
            id: `${username}/${recipe.id}`,
            author: username,
          });
        }
      } catch (err) {
        logQuestFault(`load alchemy users/${file}`, err);
      }
    }
    // Stable order among users (listFiles is sorted); master already first.
    this.userAlchemyFiles = userFiles;
    this.alchemyRecipes = merged;
  }

  /** True when a (possibly user-authored) recipe may grant its results right now. */
  alchemyRecipeGrantsAllowed(recipe: AlchemyRecipe): boolean {
    if (!recipe.author) return true;
    return this.userAlchemyRecipeGrantsAllowed(recipe.author, recipe);
  }

  userAlchemyRecipeGrantsAllowed(username: string, recipe: AlchemyRecipe): boolean {
    const author = this.getUser(username);
    if (!author) return false;
    for (const gid of alchemyGivesIds(recipe)) {
      const artefact = this.getArtefact(gid);
      if (!artefact) return false;
      const home = this.getScene(artefact.homeSceneId);
      if (!home || !canManage(author, home, this)) return false;
    }
    return true;
  }

  assertUserAlchemyGrants(username: string, recipes: AlchemyRecipe[]): void {
    const author = this.getUser(username);
    if (!author) {
      throw new QuestValidationError(`Unknown user ${username}`);
    }
    for (const recipe of recipes) {
      for (const gid of alchemyGivesIds(recipe)) {
        const artefact = this.getArtefact(gid);
        if (!artefact) {
          throw new QuestValidationError(
            `Recipe ${recipe.id}: gives artefact ${gid} does not exist`,
          );
        }
        const home = this.getScene(artefact.homeSceneId);
        if (!home || !canManage(author, home, this)) {
          throw new QuestValidationError(
            `Recipe ${recipe.id}: can only give artefact ${gid} if you own or manage its home scene`,
          );
        }
      }
    }
  }

  getUserAlchemyRecipes(username: string): AlchemyRecipe[] {
    return this.userAlchemyFiles.get(username) ?? [];
  }

  /** True when a (possibly user-authored) quest may grant its artefacts right now. */
  userQuestGrantsAllowed(username: string, quest: QuestFile): boolean {
    const author = this.getUser(username);
    if (!author) return false;
    for (const gid of questGiveArtefactIds(quest)) {
      const artefact = this.getArtefact(gid);
      if (!artefact) return false;
      const home = this.getScene(artefact.homeSceneId);
      if (!home || !canManage(author, home, this)) return false;
    }
    return true;
  }

  assertUserQuestGrants(username: string, quest: QuestFile): void {
    const author = this.getUser(username);
    if (!author) {
      throw new QuestValidationError(`Unknown user ${username}`);
    }
    for (const gid of questGiveArtefactIds(quest)) {
      const artefact = this.getArtefact(gid);
      if (!artefact) {
        throw new QuestValidationError(`giveArtefact ${gid} does not exist`);
      }
      const home = this.getScene(artefact.homeSceneId);
      if (!home || !canManage(author, home, this)) {
        throw new QuestValidationError(
          `can only giveArtefact ${gid} if you own or manage its home scene`,
        );
      }
    }
  }

  getUserQuest(username: string): QuestFile | undefined {
    return this.userQuestFiles.get(username);
  }

  emptyUserQuest(username: string): QuestFile {
    const shell = {
      name: username,
      title: `${username}'s quests`,
      description:
        "Personal quest namespace. Flags and badges must use your username as prefix.",
      rules: [] as [],
    };
    try {
      return parseQuestFile(shell);
    } catch {
      // Username may start with a digit (allowed for accounts, not for quest names).
      return shell;
    }
  }

  async saveQuest(quest: QuestFile): Promise<void> {
    const parsed = questFileForDisk(parseQuestFile(quest));
    await writeJsonAtomic(join(this.dataDir, "quests", `${parsed.name}.json`), parsed);
    await this.loadLogicFiles();
  }

  async deleteQuest(name: string): Promise<void> {
    const path = join(this.dataDir, "quests", `${name}.json`);
    if (await exists(path)) await unlink(path);
    await this.loadLogicFiles();
  }

  /** Persist one user's quest file (namespace + ACL-checked) and rebuild the merge. */
  async saveUserQuest(username: string, quest: QuestFile): Promise<void> {
    const parsed = questFileForDisk(parseQuestFile(quest));
    if (parsed.name !== username) {
      throw new QuestValidationError(
        `Quest name must be your username ("${username}")`,
      );
    }
    if (this.getMasterQuest(username)) {
      throw new QuestValidationError(
        `Namespace "${username}" is owned by a manager quest; ask a manager to register an official name`,
      );
    }
    this.assertUserQuestGrants(username, parsed);
    await mkdir(join(this.dataDir, "quests", "users"), { recursive: true });
    await writeJsonAtomic(join(this.dataDir, "quests", "users", `${username}.json`), parsed);
    await this.loadLogicFiles();
  }

  /** Persist master alchemy file and rebuild the in-memory merge. */
  async saveAlchemyRecipes(recipes: AlchemyRecipe[]): Promise<void> {
    const parsed = alchemyRecipesForDisk(parseAlchemyRecipes(recipes));
    await writeJsonAtomic(join(this.dataDir, "alchemy", "recipes.json"), parsed);
    await this.loadAlchemyFiles();
  }

  /** Persist one user's alchemy file (ACL-checked) and rebuild the in-memory merge. */
  async saveUserAlchemy(username: string, recipes: AlchemyRecipe[]): Promise<void> {
    const parsed = alchemyRecipesForDisk(parseAlchemyRecipes(recipes));
    this.assertUserAlchemyGrants(username, parsed);
    await mkdir(join(this.dataDir, "alchemy", "users"), { recursive: true });
    await writeJsonAtomic(join(this.dataDir, "alchemy", "users", `${username}.json`), parsed);
    await this.loadAlchemyFiles();
  }

  predContextFor(username: string, atSceneId?: number) {
    const user = this.getUser(username);
    const inventoryIds = new Set((user?.inventory ?? []).map((i) => i.artefactId));
    const artefactTags = new Map<number, readonly string[]>();
    for (const a of this.artefacts.values()) artefactTags.set(a.id, a.tags);
    return { inventoryIds, artefactTags, atSceneId, scenesOwned: this.scenesOwned(username) };
  }

  /**
   * Run quest evaluation for a user (cascade). Persists flags/badges and grants artefacts.
   * Newly earned badges get an inbox notice. Never throws to callers — faults are logged.
   */
  async evaluateQuestsForUser(username: string, atSceneId?: number): Promise<UserRecord | undefined> {
    const user = this.getUser(username);
    if (!user) return undefined;
    try {
      const sceneId = atSceneId ?? user.lastSceneId;
      const priorBadges = this.getUserBadges(username);
      const priorIds = priorBadges.map((b) => b.badge);
      const result = evaluateQuests({
        quests: this.quests,
        flags: this.getUserFlags(username),
        badges: priorIds,
        predContext: this.predContextFor(username, sceneId),
      });
      await this.saveUserFlags(username, result.flags);
      await this.saveUserBadges(
        username,
        mergeGrantedBadges(priorBadges, result.badges, nowIso()),
      );
      const hadBadge = new Set(priorIds);
      for (const badgeId of result.badges) {
        if (hadBadge.has(badgeId)) continue;
        try {
          await this.notifyBadgeEarned(username, badgeId);
        } catch (err) {
          logQuestFault(`badge notice ${badgeId} for ${username}`, err);
        }
      }
      let updated = user;
      for (const artefactId of result.grantedArtefactIds) {
        try {
          if (!this.getArtefact(artefactId)) continue;
          if (updated.inventory.some((i) => i.artefactId === artefactId)) continue;
          updated = await this.collectArtefact(username, artefactId);
        } catch (err) {
          logQuestFault(`giveArtefact ${artefactId} to ${username}`, err);
        }
      }
      return this.getUser(username) ?? updated;
    } catch (err) {
      logQuestFault(`evaluateQuestsForUser ${username}`, err);
      return user;
    }
  }

  /** Inbox notice when a badge is newly granted via quest knock-on. */
  async notifyBadgeEarned(username: string, badgeId: string): Promise<InboxMessage> {
    const def = badgeDefsById(this.quests).get(badgeId);
    const title = def?.title ?? badgeId;
    const description = def?.description?.trim() ?? "";
    return this.createInboxMessage({
      type: "notice",
      toUser: username,
      fromUser: "Proseden",
      subject: `You've earned a badge ${title}`,
      body: description,
    });
  }

  async saveScene(scene: SceneRecord): Promise<void> {
    const prev = this.scenes.get(scene.id);
    this.scenes.set(scene.id, scene);
    if (!prev) {
      this.bumpCachedNumber(scene.owner, "scenesOwned", 1);
    } else if (prev.owner !== scene.owner) {
      this.bumpCachedNumber(prev.owner, "scenesOwned", -1);
      this.bumpCachedNumber(scene.owner, "scenesOwned", 1);
    }
    const { body, details, ...meta } = scene;
    const clean = stripLegacyInvites(meta);
    const raw = serializeProseDocument(clean, body, details);
    await writeTextAtomic(join(this.dataDir, "scenes", `${scene.id}.md`), raw);
  }

  async saveStaff(): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, "staff.json"), this.staff);
  }

  async saveSettings(): Promise<void> {
    await writeJsonAtomic(join(this.dataDir, "settings.json"), this.settings);
  }

  isPeerMessagingEnabled(): boolean {
    return this.settings.peerMessagingEnabled !== false;
  }

  async setPeerMessagingEnabled(enabled: boolean): Promise<SettingsFile> {
    this.settings = { ...this.settings, peerMessagingEnabled: enabled };
    await this.saveSettings();
    return this.settings;
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

  /** In-memory entity totals for the manager dashboard. */
  overviewCounts(): WorldOverviewCounts {
    let exits = 0;
    for (const list of this.exits.values()) exits += list.length;
    return {
      users: this.users.size,
      scenes: this.scenes.size,
      artefacts: this.artefacts.size,
      exits,
      groups: this.groups.size,
      entranceGroups: this.entranceGroups.size,
      quests: this.masterQuests.length,
      userQuestFiles: this.userQuestFiles.size,
      alchemyRecipes: this.masterAlchemyRecipes.length,
      userAlchemyFiles: this.userAlchemyFiles.size,
      inbox: this.inbox.size,
      staff: Object.keys(this.staff.roles).length,
    };
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
      (r): r is StaffRole =>
        r === "moderator" || r === "topographer" || r === "manager" || r === "questor",
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
      await this.deleteArtefact(artefact.id, { notify: false });
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
    this.bumpCachedNumber(scene.owner, "scenesOwned", -1);
    this.exits.delete(id);
    this.subscriptions.delete(id);

    await rm(join(this.dataDir, "scenes", `${id}.md`), { force: true });
    await rm(join(this.dataDir, "scenes", `${id}.exits.json`), { force: true });
    await rm(join(this.dataDir, "scenes", `${id}.subs.json`), { force: true });
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

  async deleteArtefact(
    id: number,
    opts?: { by?: string; notify?: boolean },
  ): Promise<void> {
    const existing = this.artefacts.get(id);
    if (!existing) throw new Error("Artefact not found");
    const homeSceneId = existing.homeSceneId;
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
    if (opts?.notify !== false && opts?.by) {
      await this.notifySceneSubscribers(homeSceneId, ["artefacts"], opts.by);
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

  getSubscribers(sceneId: number): string[] {
    return this.subscriptions.get(sceneId) ?? [];
  }

  isSubscribed(sceneId: number, username: string): boolean {
    return this.getSubscribers(sceneId).includes(username);
  }

  async saveSubs(sceneId: number, usernames: string[]): Promise<void> {
    const cleaned = [...new Set(usernames.map((u) => u.trim()).filter(Boolean))].sort();
    this.subscriptions.set(sceneId, cleaned);
    await writeJsonAtomic(join(this.dataDir, "scenes", `${sceneId}.subs.json`), cleaned);
  }

  async subscribeScene(sceneId: number, username: string): Promise<string[]> {
    if (!this.scenes.has(sceneId)) throw new Error("Scene not found");
    if (!this.users.has(username)) throw new Error("User not found");
    const current = this.getSubscribers(sceneId);
    if (current.includes(username)) return current;
    await this.saveSubs(sceneId, [...current, username]);
    return this.getSubscribers(sceneId);
  }

  async unsubscribeScene(sceneId: number, username: string): Promise<string[]> {
    const current = this.getSubscribers(sceneId);
    if (!current.includes(username)) return current;
    await this.saveSubs(
      sceneId,
      current.filter((u) => u !== username),
    );
    return this.getSubscribers(sceneId);
  }

  /**
   * Fan out (or coalesce) scene_update notices to subscribers.
   * Skips the editor; drops recipients who no longer canRead (and prunes them).
   */
  async notifySceneSubscribers(
    sceneId: number,
    kinds: SceneSubscriptionChangeKind[],
    byUsername: string,
  ): Promise<void> {
    const mergedKinds = mergeChangeKinds(kinds);
    if (!mergedKinds.length) return;
    const scene = this.scenes.get(sceneId);
    if (!scene) return;

    const subscribers = this.getSubscribers(sceneId);
    if (!subscribers.length) return;

    const kept: string[] = [];
    let pruned = false;
    for (const username of subscribers) {
      if (username === byUsername) {
        kept.push(username);
        continue;
      }
      const user = this.users.get(username);
      if (!user || !canRead(user, scene, this)) {
        pruned = true;
        continue;
      }
      kept.push(username);
      await this.deliverSceneUpdate(user.username, scene, mergedKinds, byUsername);
    }
    if (pruned) {
      await this.saveSubs(sceneId, kept);
    }
  }

  private async deliverSceneUpdate(
    toUser: string,
    scene: SceneRecord,
    kinds: SceneSubscriptionChangeKind[],
    byUsername: string,
  ): Promise<void> {
    const sceneName = sceneTitleForNotice(scene);
    const subject = `Subscribed scene change: ${sceneName}`;
    const body = `Changed: ${kinds.join(", ")}`;
    const existing = this.findDuplicateSceneUpdate(toUser, scene.id);
    if (existing) {
      const changeKinds = mergeChangeKinds([...existing.changeKinds, ...kinds]);
      await this.saveInboxMessage({
        ...existing,
        createdAt: nowIso(),
        fromUser: byUsername,
        subject,
        body: `Changed: ${changeKinds.join(", ")}`,
        changeKinds,
      });
      return;
    }
    await this.createInboxMessage({
      type: "scene_update",
      toUser,
      fromUser: byUsername,
      subject,
      body,
      sceneId: scene.id,
      changeKinds: kinds,
    });
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
    this.subscriptions.set(id, []);
    return scene;
  }

  async updateScene(
    id: number,
    patch: Partial<
      Pick<
        SceneRecord,
        | "title"
        | "body"
        | "details"
        | "visibility"
        | "isJunction"
        | "when"
        | "whenDenied"
        | "detailWhen"
      >
    >,
    opts?: { by?: string; retainSnapshot?: boolean; clearGates?: Array<"when" | "whenDenied" | "detailWhen"> },
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
    for (const key of opts?.clearGates ?? []) {
      delete updated[key];
      if (!fields.includes(key)) fields.push(key);
    }
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

    const notifyKinds = sceneContentChangeKinds(fields);
    if (notifyKinds.length && opts?.by) {
      await this.notifySceneSubscribers(id, notifyKinds, opts.by);
    }
    return updated;
  }

  async updateArtefact(
    id: number,
    patch: Partial<
      Pick<ArtefactRecord, "title" | "body" | "details" | "tags" | "homeSceneId" | "when" | "detailWhen">
    >,
    opts?: { by?: string; retainSnapshot?: boolean; clearGates?: Array<"when" | "detailWhen"> },
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
    for (const key of opts?.clearGates ?? []) {
      delete updated[key];
      if (!fields.includes(key)) fields.push(key);
    }
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

    if (fields.length && opts?.by) {
      const homes = new Set<number>([existing.homeSceneId, updated.homeSceneId]);
      for (const homeId of homes) {
        await this.notifySceneSubscribers(homeId, ["artefacts"], opts.by);
      }
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
    gates?: { when?: FlagRef; whenDenied?: string; hidden?: boolean },
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
      when: gates?.when,
      whenDenied: gates?.whenDenied,
      hidden: gates?.hidden,
    };
    exits.push(exit);
    await this.saveExits(fromSceneId, exits);
    return exit;
  }

  async updateExit(
    fromSceneId: number,
    exitId: number,
    patch: Partial<Pick<ExitRecord, "nickname" | "toSceneId" | "when" | "whenDenied" | "hidden">>,
    opts?: { clearGates?: Array<"when" | "whenDenied" | "hidden"> },
  ): Promise<ExitRecord> {
    if (!this.scenes.has(fromSceneId)) throw new Error("From scene not found");
    const exits = [...this.getExits(fromSceneId)];
    const idx = exits.findIndex((e) => e.exitId === exitId);
    if (idx < 0) throw new Error(`No exit ${exitId}`);
    if (patch.toSceneId !== undefined && !this.scenes.has(patch.toSceneId)) {
      throw new Error("Destination scene not found");
    }
    const existing = exits[idx]!;
    const updated: ExitRecord = {
      ...existing,
      ...definedEntries(patch),
    };
    for (const key of opts?.clearGates ?? []) {
      delete updated[key];
    }
    exits[idx] = updated;
    await this.saveExits(fromSceneId, exits);
    return updated;
  }

  async removeExit(fromSceneId: number, exitKey: string): Promise<ExitRecord> {
    if (!this.scenes.has(fromSceneId)) throw new Error("From scene not found");
    const exit = this.findExit(fromSceneId, exitKey);
    if (!exit) throw new Error(`No exit matching "${exitKey}"`);
    const exits = this.getExits(fromSceneId).filter((e) => e.exitId !== exit.exitId);
    await this.saveExits(fromSceneId, exits);
    return exit;
  }

  async reorderExits(fromSceneId: number, orderedIds: number[]): Promise<ExitRecord[]> {
    if (!this.scenes.has(fromSceneId)) throw new Error("From scene not found");
    const current = this.getExits(fromSceneId);
    if (!isExitIdPermutation(orderedIds, current)) {
      throw new Error("exitIds must be a permutation of the current exits");
    }
    const byId = new Map(current.map((e) => [e.exitId, e]));
    const exits = orderedIds.map((id) => byId.get(id)!);
    await this.saveExits(fromSceneId, exits);
    return exits;
  }

  async createArtefact(input: {
    owner: string;
    homeSceneId: number;
    title?: string;
    body: string;
    details?: Record<string, string>;
    tags?: string[];
    when?: FlagRef;
    detailWhen?: Record<string, FlagRef>;
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
      when: input.when,
      detailWhen: input.detailWhen,
    };
    await this.saveArtefact(artefact);
    await this.notifySceneSubscribers(input.homeSceneId, ["artefacts"], input.owner);
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

  findDuplicateSceneUpdate(toUser: string, sceneId: number): SceneUpdateMessage | undefined {
    for (const m of this.inbox.values()) {
      if (m.type === "scene_update" && m.toUser === toUser && m.sceneId === sceneId) {
        return m;
      }
    }
    return undefined;
  }

  async createInboxMessage(
    input:
      | (Omit<ExitRequestMessage, "id" | "createdAt"> & { createdAt?: string })
      | (Omit<NoticeMessage, "id" | "createdAt"> & { createdAt?: string })
      | (Omit<PeerMessage, "id" | "createdAt"> & { createdAt?: string })
      | (Omit<InviteToViewMessage, "id" | "createdAt"> & { createdAt?: string })
      | (Omit<SceneUpdateMessage, "id" | "createdAt"> & { createdAt?: string }),
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
    } else if (input.type === "scene_update") {
      message = {
        id,
        type: "scene_update",
        toUser: input.toUser,
        fromUser: input.fromUser,
        createdAt,
        subject: input.subject,
        body: input.body,
        sceneId: input.sceneId,
        changeKinds: mergeChangeKinds(input.changeKinds),
      };
    } else if (input.type === "message") {
      message = {
        id,
        type: "message",
        toUser: input.toUser,
        fromUser: input.fromUser,
        createdAt,
        subject: input.subject,
        body: input.body,
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

  /** Delete every inbox message sent by username (all types). Returns deleted count. */
  async deleteInboxFromUser(username: string): Promise<number> {
    const ids: number[] = [];
    for (const m of this.inbox.values()) {
      if (m.fromUser === username) ids.push(m.id);
    }
    for (const id of ids) {
      await this.deleteInboxMessage(id);
    }
    return ids.length;
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

/** Persistable user fields only. Disk `cache` (if present) is ignored. */
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
    when: parseOptionalFlagRef(raw.when),
    whenDenied: raw.whenDenied !== undefined ? String(raw.whenDenied) : undefined,
    detailWhen: parseDetailWhenMap(raw.detailWhen),
    detailSwap:
      raw.detailSwap && typeof raw.detailSwap === "object"
        ? Object.fromEntries(
            Object.entries(raw.detailSwap as Record<string, unknown>).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.map(String) : [],
            ]),
          )
        : undefined,
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
  if (type === "scene_update") {
    const sceneId = Number(raw.sceneId);
    if (!Number.isFinite(sceneId)) return undefined;
    return {
      ...base,
      type: "scene_update",
      sceneId,
      changeKinds: normalizeChangeKinds(raw.changeKinds),
    };
  }
  if (type === "notice") {
    return { ...base, type: "notice" };
  }
  if (type === "message") {
    return { ...base, type: "message" };
  }
  return undefined;
}

function normalizeSettings(raw: Record<string, unknown>): SettingsFile {
  return {
    peerMessagingEnabled: raw.peerMessagingEnabled !== false,
  };
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
      if (s === "organiser") cleaned.push("topographer");
      else if (
        s === "moderator" ||
        s === "topographer" ||
        s === "manager" ||
        s === "questor"
      ) {
        cleaned.push(s);
      }
    }
    if (cleaned.length) roles[username] = [...new Set(cleaned)];
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
    when: parseOptionalFlagRef(raw.when),
    whenDenied: raw.whenDenied !== undefined ? String(raw.whenDenied) : undefined,
    hidden: raw.hidden !== undefined ? Boolean(raw.hidden) : undefined,
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
    when: parseOptionalFlagRef(raw.when),
    detailWhen: parseDetailWhenMap(raw.detailWhen),
    detailSwap:
      raw.detailSwap && typeof raw.detailSwap === "object"
        ? Object.fromEntries(
            Object.entries(raw.detailSwap as Record<string, unknown>).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.map(String) : [],
            ]),
          )
        : undefined,
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

const SCENE_CHANGE_KIND_ORDER: SceneSubscriptionChangeKind[] = [
  "title",
  "description",
  "details",
  "artefacts",
];

function sceneContentChangeKinds(fields: string[]): SceneSubscriptionChangeKind[] {
  const kinds: SceneSubscriptionChangeKind[] = [];
  if (fields.includes("title")) kinds.push("title");
  if (fields.includes("body")) kinds.push("description");
  if (fields.includes("details")) kinds.push("details");
  return kinds;
}

function mergeChangeKinds(
  kinds: readonly SceneSubscriptionChangeKind[],
): SceneSubscriptionChangeKind[] {
  const set = new Set(kinds);
  return SCENE_CHANGE_KIND_ORDER.filter((k) => set.has(k));
}

function normalizeChangeKinds(raw: unknown): SceneSubscriptionChangeKind[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(SCENE_CHANGE_KIND_ORDER);
  const kinds: SceneSubscriptionChangeKind[] = [];
  for (const item of raw) {
    const s = String(item);
    if (allowed.has(s)) kinds.push(s as SceneSubscriptionChangeKind);
  }
  return mergeChangeKinds(kinds);
}

function normalizeSubs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  ].sort();
}

function sceneTitleForNotice(scene: { id: number; title?: string }): string {
  const title = scene.title?.trim();
  return title || `scene ${scene.id}`;
}

function isExitIdPermutation(orderedIds: number[], current: ExitRecord[]): boolean {
  if (orderedIds.length !== current.length) return false;
  const currentIds = new Set(current.map((e) => e.exitId));
  const seen = new Set<number>();
  for (const id of orderedIds) {
    if (!Number.isInteger(id) || !currentIds.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
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
