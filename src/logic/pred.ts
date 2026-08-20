import type { FlagRef, FlagValue, Pred } from "../model/logic.js";
import { logQuestFault } from "./log.js";

const NOT_PREFIX = "not.";
const HOLDS_ID = /^[1-9]\d*$/;
const GATE_SCHEMES = new Set(["flag", "holds", "badge"]);

/** Reader facts for world-gate FlagRef evaluation (not quest Pred trees). */
export type GateFacts = {
  flags: Record<string, FlagValue>;
  inventoryIds: ReadonlySet<number>;
  badges: ReadonlySet<string>;
};

export function gateFacts(partial?: Partial<GateFacts>): GateFacts {
  return {
    flags: partial?.flags ?? {},
    inventoryIds: partial?.inventoryIds ?? new Set(),
    badges: partial?.badges ?? new Set(),
  };
}

export function emptyGateFacts(): GateFacts {
  return gateFacts();
}

/** Build GateFacts for a reader (anonymous → empty flags / inventory / badges). */
export function gateFactsFor(
  world: {
    getUserFlags(username: string): Record<string, FlagValue>;
    getUserBadges(username: string): ReadonlyArray<{ badge: string }>;
  },
  user: { username: string; inventory: ReadonlyArray<{ artefactId: number }> } | undefined,
): GateFacts {
  if (!user) return emptyGateFacts();
  return gateFacts({
    flags: world.getUserFlags(user.username),
    inventoryIds: new Set(user.inventory.map((i) => i.artefactId)),
    badges: new Set(world.getUserBadges(user.username).map((b) => b.badge)),
  });
}

/** True when `flags[id] === true`. Empty / whitespace ref is treated as ungated by callers. */
export function flagIsTrue(flags: Record<string, FlagValue>, flagId: string): boolean {
  return flags[flagId] === true;
}

/**
 * Evaluate a world-gate FlagRef. Empty string is ungated (true).
 * No colon → `flag` scheme. Unknown schemes are false.
 */
export function evaluateFlagRef(
  ref: FlagRef | undefined | null,
  facts: GateFacts,
): boolean {
  if (ref === undefined || ref === null) return true;
  const trimmed = String(ref).trim();
  if (!trimmed) return true;
  try {
    return evaluateFlagRefUnsafe(trimmed, facts);
  } catch (err) {
    logQuestFault("evaluateFlagRef", err);
    return false;
  }
}

function evaluateFlagRefUnsafe(trimmed: string, facts: GateFacts): boolean {
  const colon = trimmed.indexOf(":");
  const scheme = colon < 0 ? "flag" : trimmed.slice(0, colon);
  const rest = colon < 0 ? trimmed : trimmed.slice(colon + 1);
  if (colon === 0 || !GATE_SCHEMES.has(scheme)) return false;

  const restTrimmed = rest.trim();
  const invert = restTrimmed.startsWith(NOT_PREFIX);
  const payload = invert ? restTrimmed.slice(NOT_PREFIX.length).trim() : restTrimmed;
  if (!payload) return false;

  let ok = false;
  if (scheme === "flag") {
    ok = flagIsTrue(facts.flags, payload);
  } else if (scheme === "holds") {
    if (!HOLDS_ID.test(payload)) return false;
    const id = Number(payload);
    if (!Number.isSafeInteger(id)) return false;
    ok = facts.inventoryIds.has(id);
  } else if (scheme === "badge") {
    ok = facts.badges.has(payload);
  } else {
    return false;
  }
  return invert ? !ok : ok;
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
  usesArtefactId?: number;
  /** Already normalized (`normalizeInputPhrase`). */
  inputPhrase?: string;
}

/** Trim, NFKC, collapse whitespace, en-US lower case. */
export function normalizeInputPhrase(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
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
    const raw = String(pred.flag).trim();
    const invert = raw.startsWith(NOT_PREFIX);
    const id = invert ? raw.slice(NOT_PREFIX.length).trim() : raw;
    if (!id) return false;
    const set = flagIsTrue(ctx.flags, id);
    return invert ? !set : set;
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
  if ("uses" in pred) return ctx.usesArtefactId === pred.uses;
  if ("input" in pred) {
    if (ctx.inputPhrase === undefined) return false;
    return ctx.inputPhrase === normalizeInputPhrase(pred.input);
  }
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
