import type { ArtefactRecord, NodeRecord, UserRecord } from "../model/types.js";

/**
 * Forward-compatible access checks.
 * Evaluation order (later features plug in without reordering callers):
 * 1. deny lists (node / reserved user-level)
 * 2. grants / invites
 * 3. group rights (reserved)
 * 4. user-level rights (reserved)
 * 5. public / private + ownership
 */
export function canRead(user: UserRecord | undefined, node: NodeRecord): boolean {
  if (isDenied(user, node)) return false;
  if (isGranted(user, node)) return true;
  if (node.visibility === "public") return true;
  if (user && user.username === node.owner) return true;
  return false;
}

export function canEdit(user: UserRecord | undefined, node: NodeRecord): boolean {
  if (!user) return false;
  if (isDenied(user, node)) return false;
  // v1: owner only (invites/manage grants later)
  return user.username === node.owner;
}

export function canReadArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: NodeRecord,
): boolean {
  return canRead(user, home);
}

export function canEditArtefact(
  user: UserRecord | undefined,
  artefact: ArtefactRecord,
  home: NodeRecord,
): boolean {
  if (!user) return false;
  if (user.username === artefact.owner) return true;
  return canEdit(user, home);
}

function isDenied(user: UserRecord | undefined, node: NodeRecord): boolean {
  if (!user) return false;
  if (node.denies?.includes(user.username)) return true;
  if (user.denies?.includes(node.owner)) return true;
  return false;
}

function isGranted(user: UserRecord | undefined, node: NodeRecord): boolean {
  if (!user) return false;
  if (node.invites?.includes(user.username)) return true;
  if (user.grants?.includes(node.owner)) return true;
  return false;
}
