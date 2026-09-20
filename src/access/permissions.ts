import type {
  ArtefactRecord,
  Deny,
  EntranceGroupRecord,
  ExitRecord,
  Grant,
  GroupRecord,
  Right,
  SceneRecord,
  StaffRole,
  UserRecord,
  Visibility,
} from "../model/types.js";
import { grantCovers, matchesDeny } from "./acl.js";

/** Owner + grants/denies, with optional public-read and inherited bags. */
export interface AclSubject {
  owner: string;
  grants?: Grant[];
  denies?: Deny[];
  /** When set, anonymous/`*` readers get this visibility's public-read. */
  visibility?: Visibility;
  /** Inherited ACL bags: group, then owner share-all (deny walks reverse). */
  parents?: Array<{ grants?: Grant[]; denies?: Deny[] }>;
}

export function sceneAclSubject(scene: SceneRecord, world: AccessWorld): AclSubject {
  const parents: NonNullable<AclSubject["parents"]> = [];
  if (scene.groupId) {
    const group = world.getGroup(scene.groupId);
    if (group) parents.push({ grants: group.grants, denies: group.denies });
  }
  const owner = world.getUser(scene.owner);
  if (owner) parents.push({ grants: owner.grants, denies: owner.denies });
  return {
    owner: scene.owner,
    grants: scene.grants,
    denies: scene.denies,
    visibility: scene.visibility,
    parents,
  };
}

export function groupAclSubject(group: GroupRecord, world: AccessWorld): AclSubject {
  const owner = world.getUser(group.owner);
  return {
    owner: group.owner,
    grants: group.grants,
    denies: group.denies,
    parents: owner ? [{ grants: owner.grants, denies: owner.denies }] : [],
  };
}

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
export function hasRightOn(
  user: UserRecord | undefined,
  subject: AclSubject,
  right: Right,
  world: AccessWorld,
): boolean {
  if (isDeniedSubject(user, subject, right)) return false;
  if (user && user.username === subject.owner) return true;
  if (isGrantedSubject(user, subject, right)) return true;
  if (right === "read" && subject.visibility === "public") return true;
  if (user && staffCovers(user, right, world)) return true;
  return false;
}

export function hasRight(
  user: UserRecord | undefined,
  scene: SceneRecord,
  right: Right,
  world: AccessWorld,
): boolean {
  return hasRightOn(user, sceneAclSubject(scene, world), right, world);
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

/**
 * Create an artefact in or move one to `scene`.
 * Edit rights on the scene, or any signed-in user when the scene is a public repository.
 */
export function canPlaceArtefact(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (canEdit(user, scene, world)) return true;
  return Boolean(scene.isRepository && scene.visibility === "public");
}

/**
 * Return a guest artefact to its owner's home scene.
 * Home-scene managers may eject; artefact owners use re-home instead.
 */
export function canEjectArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (user.username === artefact.owner) return false;
  return canManage(user, home, world);
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
  return hasRightOn(user, groupAclSubject(group, world), "manage", world);
}

export function canReadGroup(
  user: UserRecord | undefined,
  group: GroupRecord,
  world: AccessWorld,
): boolean {
  return hasRightOn(user, groupAclSubject(group, world), "read", world);
}

/** Scene owner, manage grant, or moderator. */
export function canDeleteScene(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  return canManage(user, scene, world) || isModerator(user, world);
}

/** Artefact owner, home-scene manager, or moderator. */
export function canDeleteArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: SceneRecord | undefined,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (user.username === artefact.owner) return true;
  if (isModerator(user, world)) return true;
  return !!home && canManage(user, home, world);
}

function isDeniedSubject(user: UserRecord | undefined, subject: AclSubject, right: Right): boolean {
  if (!user) return false;
  // Deny walks inherited bags in reverse of grant order (owner → group → subject).
  const bags = [...(subject.parents ?? [])].reverse();
  bags.push({ denies: subject.denies });
  for (const bag of bags) {
    if (matchesDeny(bag.denies, user.username, right)) return true;
  }
  return false;
}

function isGrantedSubject(
  user: UserRecord | undefined,
  subject: AclSubject,
  right: Right,
): boolean {
  const who = user?.username;
  if (grantCovers(subject.grants, who, right)) return true;
  for (const parent of subject.parents ?? []) {
    if (grantCovers(parent.grants, who, right)) return true;
  }
  return false;
}

/**
 * Staff roles:
 * - moderator: edit (prose) worldwide; may delete unacceptable content
 * - topographer: graph structure via isTopographer (not prose edit / ACL manage / delete)
 * - questor: edit own `quests/users/<username>.json` (personal `user.<username>.*` namespace)
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
