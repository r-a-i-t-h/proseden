/** Quest / flag / alchemy types (see docs/QUESTS.md and docs/PUZZLES.md). */

export type FlagValue = boolean;

/**
 * World-gate condition string. No colon → flag scheme (`quest.local`);
 * `flag:` is optional. Also `holds:<id>` and `badge:<id>`. Invert with
 * `not.` on the payload (`not.x`, `flag:not.x`, `holds:not.1`). Unknown
 * schemes are false. Empty = ungated.
 */
export type FlagRef = string;

export type QuestTrigger = "always" | "use" | "input";

export type Pred =
  | { flag: string }
  | { holds: number }
  | { holdsTag: string }
  | { hasBadge: string }
  | { atScene: number }
  | { scenesOwned: { gte: number } }
  | { uses: number }
  | { input: string }
  | { not: Pred }
  | { all: Pred[] }
  | { any: Pred[] };

export type FlagEffect =
  | { setFlag: string }
  | { clearFlag: string };

export type KnockOn = { grantBadge: string } | { giveArtefact: number };

export interface QuestRule {
  id: string;
  when: Pred;
  then: FlagEffect[];
  /** Default `always`. Omit on disk when always. */
  on?: QuestTrigger;
  /** Reader prose for Use/Input notices; ignored for Always. */
  ok?: string;
}

export interface BadgeDef {
  id: string;
  title: string;
  description?: string;
}

export interface QuestFile {
  name: string;
  title?: string;
  description?: string;
  rules: QuestRule[];
  onFlag?: Record<string, { onTrue?: KnockOn[]; onFalse?: KnockOn[] }>;
  badges?: BadgeDef[];
  /**
   * In-memory only: set when loaded from `quests/users/<author>.json`.
   * Absent on manager quests. Never persisted to disk.
   */
  author?: string;
}

export interface AlchemyRecipe {
  id: string;
  inputs: Array<number | { tag: string }>;
  gives: number | number[];
  ok?: string;
  /**
   * In-memory only: set when loaded from `alchemy/users/<author>.json`.
   * Absent on master recipes. Never persisted to disk.
   */
  author?: string;
}

export const QUEST_EVAL_MAX_ITERATIONS = 16;
export const INPUT_PHRASE_MAX = 200;
