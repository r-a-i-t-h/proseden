import type { FlagRef, FlagValue, Pred } from "../model/logic.js";
import { logQuestFault } from "./log.js";

const NOT_PREFIX = "not.";

/** True when `flags[id] === true`. Empty / whitespace ref is treated as ungated by callers. */
export function flagIsTrue(flags: Record<string, FlagValue>, flagId: string): boolean {
  return flags[flagId] === true;
}

/**
 * Evaluate a world-gate FlagRef. `not.foo` inverts `foo` (not a stored flag).
 * Empty string is ungated (true).
 */
export function evaluateFlagRef(
  ref: FlagRef | undefined | null,
  flags: Record<string, FlagValue>,
): boolean {
  if (ref === undefined || ref === null) return true;
  const trimmed = String(ref).trim();
  if (!trimmed) return true;
  try {
    if (trimmed.startsWith(NOT_PREFIX)) {
      const id = trimmed.slice(NOT_PREFIX.length).trim();
      if (!id) return false;
      return !flagIsTrue(flags, id);
    }
    return flagIsTrue(flags, trimmed);
  } catch (err) {
    logQuestFault("evaluateFlagRef", err);
    return false;
  }
}

/** Normalize / validate a FlagRef from input; empty → undefined. */
export function parseOptionalFlagRef(raw: unknown): FlagRef | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  if (s.startsWith(NOT_PREFIX) && !s.slice(NOT_PREFIX.length).trim()) {
    return undefined;
  }
  return s;
}

export function parseDetailWhenMap(raw: unknown): Record<string, FlagRef> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, FlagRef> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ref = parseOptionalFlagRef(v);
    if (ref) out[k] = ref;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface PredContext {
  flags: Record<string, FlagValue>;
  badges: ReadonlySet<string>;
  inventoryIds: ReadonlySet<number>;
  /** artefact id → tags */
  artefactTags: ReadonlyMap<number, readonly string[]>;
  atSceneId?: number;
  scenesOwned: number;
}

export function evaluatePred(pred: Pred, ctx: PredContext): boolean {
  try {
    return evaluatePredUnsafe(pred, ctx);
  } catch (err) {
    logQuestFault("evaluatePred", err);
    return false;
  }
}

function evaluatePredUnsafe(pred: Pred, ctx: PredContext): boolean {
  if (!pred || typeof pred !== "object") return false;
  if ("not" in pred) return !evaluatePredUnsafe(pred.not, ctx);
  if ("all" in pred) {
    if (!Array.isArray(pred.all)) return false;
    return pred.all.every((p) => evaluatePredUnsafe(p, ctx));
  }
  if ("any" in pred) {
    if (!Array.isArray(pred.any)) return false;
    return pred.any.some((p) => evaluatePredUnsafe(p, ctx));
  }
  if ("flag" in pred) {
    const cur = ctx.flags[pred.flag];
    if (cur === undefined) return false;
    const expect = pred.is !== undefined ? pred.is : true;
    return cur === expect;
  }
  if ("holds" in pred) return ctx.inventoryIds.has(pred.holds);
  if ("holdsTag" in pred) {
    for (const id of ctx.inventoryIds) {
      const tags = ctx.artefactTags.get(id);
      if (tags?.includes(pred.holdsTag)) return true;
    }
    return false;
  }
  if ("hasBadge" in pred) return ctx.badges.has(pred.hasBadge);
  if ("atScene" in pred) return ctx.atSceneId === pred.atScene;
  if ("scenesOwned" in pred) {
    const gte = pred.scenesOwned?.gte;
    if (typeof gte !== "number") return false;
    return ctx.scenesOwned >= gte;
  }
  return false;
}

/** World gates may only compose flag atoms. */
export function isFlagOnlyPred(pred: Pred): boolean {
  try {
    return isFlagOnlyPredUnsafe(pred);
  } catch (err) {
    logQuestFault("isFlagOnlyPred", err);
    return false;
  }
}

function isFlagOnlyPredUnsafe(pred: Pred): boolean {
  if (!pred || typeof pred !== "object") return false;
  if ("not" in pred) return isFlagOnlyPredUnsafe(pred.not);
  if ("all" in pred) {
    if (!Array.isArray(pred.all)) return false;
    return pred.all.every(isFlagOnlyPredUnsafe);
  }
  if ("any" in pred) {
    if (!Array.isArray(pred.any)) return false;
    return pred.any.every(isFlagOnlyPredUnsafe);
  }
  return "flag" in pred;
}

export function evaluateFlagPred(pred: Pred | undefined, flags: Record<string, FlagValue>): boolean {
  if (!pred) return true;
  try {
    if (!isFlagOnlyPred(pred)) return false;
    return evaluatePred(pred, {
      flags,
      badges: new Set(),
      inventoryIds: new Set(),
      artefactTags: new Map(),
      scenesOwned: 0,
    });
  } catch (err) {
    logQuestFault("evaluateFlagPred", err);
    return false;
  }
}
