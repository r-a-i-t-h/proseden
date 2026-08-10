import type {
  ArtefactRecord,
  EntranceGroupRecord,
  GroupRecord,
  Right,
  SceneRecord,
  StaffRole,
  UserRecord,
} from "../model/types.js";
import { grantCovers, matchesDeny } from "./acl.js";

/**
 * Lookup surface for access evaluation.
 * Groups / entrance groups / staff plug in as phases land.
 */
export interface AccessWorld {
  getUser(username: string): UserRecord | undefined;
  getGroup?(id: string): GroupRecord | undefined;
  getEntranceGroup?(id: string): EntranceGroupRecord | undefined;
  rolesFor?(username: string): StaffRole[];
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
 * Managers/organisers always may; anyone signed in may when the scene is a public junction.
 */
export function canAddExit(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (canManage(user, scene, world) || canOrganise(user, world)) return true;
  return Boolean(scene.isJunction && scene.visibility === "public");
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
  if (scene.groupId && world.getGroup) {
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
  if (scene.groupId && world.getGroup) {
    const group = world.getGroup(scene.groupId);
    if (group && grantCovers(group.grants, who, right)) return true;
  }
  const owner = world.getUser(scene.owner);
  if (grantCovers(owner?.grants, who, right)) return true;
  return false;
}

/**
 * Staff roles (Phase 5):
 * - moderator: edit (prose) worldwide, not manage / restructure
 * - organiser: graph structure via canOrganise (not full ACL manage)
 * - manager: full manage + personnel APIs
 */
function staffCovers(user: UserRecord, right: Right, world: AccessWorld): boolean {
  const roles = world.rolesFor?.(user.username) ?? [];
  if (!roles.length) return false;
  if (right === "read" || right === "edit") {
    if (roles.includes("moderator") || roles.includes("organiser") || roles.includes("manager")) {
      return true;
    }
  }
  if (right === "manage") {
    if (roles.includes("manager")) return true;
  }
  return false;
}

/** Organisers (and managers) may restructure graph worldwide. */
export function canOrganise(
  user: UserRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  const roles = world.rolesFor?.(user.username) ?? [];
  return roles.includes("organiser") || roles.includes("manager");
}

export function isModerator(
  user: UserRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  const roles = world.rolesFor?.(user.username) ?? [];
  return (
    roles.includes("moderator") ||
    roles.includes("organiser") ||
    roles.includes("manager")
  );
}

export function isManager(
  user: UserRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return (world.rolesFor?.(user.username) ?? []).includes("manager");
}
