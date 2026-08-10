import type { ArtefactRecord, SceneRecord, UserRecord } from "../model/types.js";

/**
 * Forward-compatible access checks.
 * Evaluation order (later features plug in without reordering callers):
 * 1. deny lists (scene / reserved user-level)
 * 2. grants / invites
 * 3. group rights (reserved)
 * 4. user-level rights (reserved)
 * 5. public / private + ownership
 */
export function canRead(user: UserRecord | undefined, scene: SceneRecord): boolean {
  if (isDenied(user, scene)) return false;
  if (isGranted(user, scene)) return true;
  if (scene.visibility === "public") return true;
  if (user && user.username === scene.owner) return true;
  return false;
}

export function canEdit(user: UserRecord | undefined, scene: SceneRecord): boolean {
  if (!user) return false;
  if (isDenied(user, scene)) return false;
  // v1: owner only (invites/manage grants later)
  return user.username === scene.owner;
}

export function canReadArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: SceneRecord,
): boolean {
  return canRead(user, home);
}

export function canEditArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: SceneRecord,
): boolean {
  if (!user) return false;
  if (user.username === artefact.owner) return true;
  return canEdit(user, home);
}

function isDenied(user: UserRecord | undefined, scene: SceneRecord): boolean {
  if (!user) return false;
  if (scene.denies?.includes(user.username)) return true;
  if (user.denies?.includes(scene.owner)) return true;
  return false;
}

function isGranted(user: UserRecord | undefined, scene: SceneRecord): boolean {
  if (!user) return false;
  if (scene.invites?.includes(user.username)) return true;
  if (user.grants?.includes(scene.owner)) return true;
  return false;
}
