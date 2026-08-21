/** Quest / flag / alchemy types (see docs/QUESTS.md and docs/PUZZLES.md). */

export type FlagValue = boolean;

/** Shared var compare ops for Pred JSON keys and world-gate `var:` strings. */
export type VarOp = "=" | "!=" | ">" | "<";

/**
 * World-gate condition string. No colon → flag scheme (`quest.local`);
 * `flag:` is optional. Also `holds:<id>`, `badge:<id>`, and
 * `var:<id>=N` / `!=` / `>` / `<` (unset var reads as 0). Invert with `not.`
 * on the payload. Unknown schemes are false. Empty = ungated.
 */
export type FlagRef = string;

/** Why a quest evaluation started (wake). Internal `"always"` = omit-on wakes. */
export type QuestWake = "always" | "use" | "input" | "gain" | "drop";

/**
 * Rule eligibility (`on` field). Omit for always. Never write `"always"` on disk.
 * String events require a matching `when` atom (`use` / `input` / `gain` / `drop`).
 */
export type QuestRuleOn =
  | "use"
  | "input"
  | "gain"
  | "drop"
  | { flag: string }
  | { clearFlag: string };

export type Pred =
  | { flag: string }
  | { holds: number }
  | { holdsTag: string }
  | { hasBadge: string }
  | { atScene: number }
  | { scenesOwned: number }
  | { use: number }
  | { input: string }
  | { gain: number }
  | { drop: number }
  | { var: string; "=": number }
  | { var: string; "!=": number }
  | { var: string; ">": number }
  | { var: string; "<": number }
  | { not: Pred }
  | { all: Pred[] }
  | { any: Pred[] };

export type ThenEffect =
  | { setFlag: string }
  | { clearFlag: string }
  | { setVar: string; to: number }
  | { incVar: string; by: number }
  | { decVar: string; by: number }
  | { clearVar: string }
  | { grantBadge: string }
  | { giveArtefact: number };

export interface QuestRule {
  id: string;
  when: Pred;
  then: ThenEffect[];
  /** Omit for always. */
  on?: QuestRuleOn;
  /** Reader prose for Use/Input notices only. */
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
  badges?: BadgeDef[];
  /**
   * In-memory only: set when loaded from `quests/users/<author>.json`
   * (`name` is `user.<author>`). Absent on manager quests. Never persisted to disk.
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

export const INPUT_PHRASE_MAX = 200;
