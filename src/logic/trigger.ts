import type { Context } from "hono";
import type { UserRecord } from "../model/types.js";
import { logQuestFault } from "./log.js";

/** Evaluate quests after a state-changing event; refresh c.set("user"). Never throws. */
export async function triggerQuestEval(
  c: Context,
  user: UserRecord,
  atSceneId?: number,
): Promise<UserRecord> {
  try {
    const world = c.get("world");
    const updated = await world.evaluateQuestsForUser(user.username, atSceneId);
    const next = updated ?? world.getUser(user.username) ?? user;
    c.set("user", next);
    return next;
  } catch (err) {
    logQuestFault(`trigger (${user.username})`, err);
    c.set("user", user);
    return user;
  }
}
