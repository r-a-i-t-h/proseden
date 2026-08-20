import type { Context } from "hono";
import type { QuestWake } from "../model/logic.js";
import type { UserRecord } from "../model/types.js";
import { timedAsync } from "../observe.js";
import { logQuestFault } from "./log.js";

export type QuestEvalOutcome = {
  user: UserRecord;
  actionMatched: boolean;
  actionOk?: string;
};

/** Evaluate quests after a state-changing event; refresh c.set("user"). Never throws. */
export async function triggerQuestEval(
  c: Context,
  user: UserRecord,
  atSceneId?: number,
  evalOpts?: {
    wake?: QuestWake;
    useArtefactId?: number;
    inputPhrase?: string;
    wakeGained?: number[];
    wakeDropped?: number[];
  },
): Promise<QuestEvalOutcome> {
  const fallback: QuestEvalOutcome = { user, actionMatched: false };
  try {
    const world = c.get("world");
    const outcome = await timedAsync(c.get("timer"), "quests", () =>
      world.evaluateQuestsForUser(user.username, atSceneId, evalOpts),
    );
    const next = outcome?.user ?? world.getUser(user.username) ?? user;
    c.set("user", next);
    return {
      user: next,
      actionMatched: outcome?.actionMatched ?? false,
      actionOk: outcome?.actionOk,
    };
  } catch (err) {
    logQuestFault(`trigger (${user.username})`, err);
    c.set("user", user);
    return fallback;
  }
}
