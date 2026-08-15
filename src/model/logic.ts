/** Quest / flag / alchemy types (see docs/QUESTS.md and docs/PUZZLES.md). */

export type FlagValue = boolean | number | string;

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
}

export interface AlchemyRecipe {
  id: string;
  inputs: Array<number | { tag: string }>;
  gives: number | number[];
  ok?: string;
}

export const QUEST_EVAL_MAX_ITERATIONS = 16;
