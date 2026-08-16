/** Quest / flag / alchemy types (see docs/QUESTS.md and docs/PUZZLES.md). */

export type FlagValue = boolean | number | string;

/**
 * World-gate flag reference. Require `flags[id] === true`, or invert with a
 * `not.` prefix (`not.builders.hamlet` is not a stored flag).
 */
export type FlagRef = string;

export type Pred =
  | { flag: string; is?: FlagValue }
  | { holds: number }
  | { holdsTag: string }
  | { hasBadge: string }
  | { atScene: number }
  | { scenesOwned: { gte: number } }
  | { not: Pred }
  | { all: Pred[] }
  | { any: Pred[] };

export type FlagEffect =
  | { setFlag: string; to?: FlagValue }
  | { clearFlag: string };

export type KnockOn = { grantBadge: string } | { giveArtefact: number };

export interface QuestRule {
  id: string;
  when: Pred;
  then: FlagEffect[];
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
