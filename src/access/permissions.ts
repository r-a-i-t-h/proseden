import type {
  ArtefactRecord,
  EntranceGroupRecord,
  ExitRecord,
  GroupRecord,
  Right,
  SceneRecord,
  StaffRole,
  UserRecord,
} from "../model/types.js";
import { grantCovers, matchesDeny } from "./acl.js";

/**
 * Lookup surface for access evaluation.
 */
export interface AccessWorld {
  getUser(username: string): UserRecord | undefined;
  getScene(id: number): SceneRecord | undefined;
  getGroup(id: string): GroupRecord | undefined;
  getEntranceGroup(id: string): EntranceGroupRecord | undefined;
  rolesFor(username: string): StaffRole[];
}

/**
 * Evaluation order:
 * 1. deny (user-level → group → scene)
 * 2. owner
 * 3. grants (scene → group → user-level), including `"*"`
 * 4. public (read only)
 * 5. staff roles
 */
export function hasRight(
  user: UserRecord | undefined,
  scene: SceneRecord,
  right: Right,
  world: AccessWorld,
): boolean {
  if (isDenied(user, scene, right, world)) return false;
  if (user && user.username === scene.owner) return true;
  if (isGranted(user, scene, right, world)) return true;
  if (right === "read" && scene.visibility === "public") return true;
  if (user && staffCovers(user, right, world)) return true;
  return false;
}

export function canRead(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  return hasRight(user, scene, "read", world);
}

export function canEdit(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return hasRight(user, scene, "edit", world);
}

export function canManage(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return hasRight(user, scene, "manage", world);
}

/**
 * Add an exit originating at `scene`.
 * Managers/topographers always may; anyone signed in may when the scene is a public junction.
 */
export function canAddExit(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (canManage(user, scene, world) || isTopographer(user, world)) return true;
  return Boolean(scene.isJunction && scene.visibility === "public");
}

/**
 * Remove an exit originating at `fromScene`.
 * Manage/topographer may remove any; on a public junction, signed-in users may only
 * remove exits that lead to a scene they own.
 */
export function canRemoveExit(
  user: UserRecord | undefined,
  fromScene: SceneRecord,
  exit: ExitRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (canManage(user, fromScene, world) || isTopographer(user, world)) return true;
  if (!canAddExit(user, fromScene, world)) return false;
  const dest = world.getScene(exit.toSceneId);
  return !!dest && dest.owner === user.username;
}

/**
 * Reorder the origin’s full exit list. Same gate as editing every exit
 * (manage or topographer) — not junction visitors with partial rights.
 */
export function canReorderExits(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return canManage(user, scene, world) || isTopographer(user, world);
}

export function canReadArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: SceneRecord,
  world: AccessWorld,
): boolean {
  return canRead(user, home, world);
}

export function canEditArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (user.username === artefact.owner) return true;
  return canEdit(user, home, world);
}

/** Owner or staff manager — a manage grant is not enough. */
export function canTransferScene(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return user.username === scene.owner || isManager(user, world);
}

/** Owner or staff manager — a manage grant is not enough. */
export function canTransferGroup(
  user: UserRecord | undefined,
  group: GroupRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return user.username === group.owner || isManager(user, world);
}

/** Manage rights on a group (owner or grant). */
export function canManageGroup(
  user: UserRecord | undefined,
  group: GroupRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (user.username === group.owner) return true;
  if (matchesDeny(world.getUser(group.owner)?.denies, user.username, "manage")) return false;
  if (matchesDeny(group.denies, user.username, "manage")) return false;
  if (grantCovers(group.grants, user.username, "manage")) return true;
  if (grantCovers(world.getUser(group.owner)?.grants, user.username, "manage")) return true;
  if (staffCovers(user, "manage", world)) return true;
  return false;
}

export function canEditGroup(
  user: UserRecord | undefined,
  group: GroupRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (user.username === group.owner) return true;
  if (matchesDeny(world.getUser(group.owner)?.denies, user.username, "edit")) return false;
  if (matchesDeny(group.denies, user.username, "edit")) return false;
  if (grantCovers(group.grants, user.username, "edit")) return true;
  if (grantCovers(world.getUser(group.owner)?.grants, user.username, "edit")) return true;
  if (staffCovers(user, "edit", world)) return true;
  return false;
}

export function canReadGroup(
  user: UserRecord | undefined,
  group: GroupRecord,
  world: AccessWorld,
): boolean {
  if (user && user.username === group.owner) return true;
  if (user && matchesDeny(world.getUser(group.owner)?.denies, user.username, "read")) return false;
  if (user && matchesDeny(group.denies, user.username, "read")) return false;
  if (grantCovers(group.grants, user?.username, "read")) return true;
  if (grantCovers(world.getUser(group.owner)?.grants, user?.username, "read")) return true;
  if (user && staffCovers(user, "read", world)) return true;
  return false;
}

function isDenied(
  user: UserRecord | undefined,
  scene: SceneRecord,
  right: Right,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  const owner = world.getUser(scene.owner);
  if (matchesDeny(owner?.denies, user.username, right)) return true;
  if (scene.groupId) {
    const group = world.getGroup(scene.groupId);
    if (group && matchesDeny(group.denies, user.username, right)) return true;
  }
  if (matchesDeny(scene.denies, user.username, right)) return true;
  return false;
}

function isGranted(
  user: UserRecord | undefined,
  scene: SceneRecord,
  right: Right,
  world: AccessWorld,
): boolean {
  const who = user?.username;
  if (grantCovers(scene.grants, who, right)) return true;
  if (scene.groupId) {
    const group = world.getGroup(scene.groupId);
    if (group && grantCovers(group.grants, who, right)) return true;
  }
  const owner = world.getUser(scene.owner);
  if (grantCovers(owner?.grants, who, right)) return true;
  return false;
}

/**
 * Staff roles:
 * - moderator: edit (prose) worldwide; may delete unacceptable content
 * - topographer: graph structure via isTopographer (not prose edit / ACL manage / delete)
 * - questor: edit own `quests/users/<username>.json` (personal flag/badge namespace)
 * - manager: full manage + personnel APIs (superset of moderator + topographer + questor)
 */
function staffCovers(user: UserRecord, right: Right, world: AccessWorld): boolean {
  const roles = world.rolesFor(user.username) ?? [];
  if (!roles.length) return false;
  if (right === "read" || right === "edit") {
    if (roles.includes("moderator") || roles.includes("manager")) {
      return true;
    }
  }
  if (right === "manage") {
    if (roles.includes("manager")) return true;
  }
  return false;
}

/** Topographers (and managers) may restructure graph worldwide. */
export function isTopographer(
  user: UserRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  const roles = world.rolesFor(user.username) ?? [];
  return roles.includes("topographer") || roles.includes("manager");
}

/** Moderators and managers may remove unacceptable content. */
export function isModerator(
  user: UserRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  const roles = world.rolesFor(user.username) ?? [];
  return roles.includes("moderator") || roles.includes("manager");
}

export function isManager(
  user: UserRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return world.rolesFor(user.username).includes("manager");
}

/** Questors (and managers) may edit their personal quest file. */
export function isQuestor(
  user: UserRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  const roles = world.rolesFor(user.username) ?? [];
  return roles.includes("questor") || roles.includes("manager");
}
