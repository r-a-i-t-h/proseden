import {
  canEdit,
  canManage,
  isModerator,
  isTopographer,
  type AccessWorld,
} from "./permissions.js";
import type { SceneRecord, UserRecord } from "../model/types.js";

/**
 * Owner / edit / manage / staff may enter a FlagRef-gated scene without passing
 * the condition (CMS and moderation). Grant-read and public readers must pass.
 */
export function bypassesSceneFlagGate(
  user: UserRecord | undefined,
  scene: SceneRecord,
  world: AccessWorld,
): boolean {
  if (!user) return false;
  if (user.username === scene.owner) return true;
  if (canEdit(user, scene, world) || canManage(user, scene, world)) return true;
  if (isModerator(user, world) || isTopographer(user, world)) return true;
  return false;
}
