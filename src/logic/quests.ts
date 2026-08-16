import type {
  AlchemyRecipe,
  BadgeDef,
  FlagEffect,
  FlagValue,
  KnockOn,
  Pred,
  QuestFile,
  QuestRule,
} from "../model/logic.js";
import { QUEST_EVAL_MAX_ITERATIONS } from "../model/logic.js";
import { logQuestFault } from "./log.js";
import { evaluatePred, isFlagOnlyPred, type PredContext } from "./pred.js";

export class QuestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestValidationError";
  }
}

export function parseQuestFile(raw: unknown): QuestFile {
  if (!raw || typeof raw !== "object") throw new QuestValidationError("Quest must be an object");
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!name || !/^[a-z][a-z0-9_-]*$/i.test(name)) {
    throw new QuestValidationError("Quest name must be a simple identifier");
  }
  if (!Array.isArray(o.rules)) throw new QuestValidationError("Quest rules must be an array");
  const rules = o.rules.map((r, i) => parseRule(r, name, i));
  const onFlag = o.onFlag !== undefined ? parseOnFlag(o.onFlag, name) : undefined;
  const badges = o.badges !== undefined ? parseBadges(o.badges, name) : undefined;
  return {
    name,
    title: o.title !== undefined ? String(o.title) : undefined,
    description: o.description !== undefined ? String(o.description) : undefined,
    rules,
    onFlag,
    badges,
  };
}

function parseRule(raw: unknown, questName: string, index: number): QuestRule {
  if (!raw || typeof raw !== "object") {
    throw new QuestValidationError(`Rule ${index} must be an object`);
  }
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? `rule-${index}`);
  if (!o.when) throw new QuestValidationError(`Rule ${id}: when required`);
  const when = o.when as Pred;
  assertPredShape(when, `Rule ${id} when`);
  if (!Array.isArray(o.then) || !o.then.length) {
    throw new QuestValidationError(`Rule ${id}: then must be a non-empty array`);
  }
  const then = o.then.map((t, i) => parseFlagEffect(t, questName, `${id}.then[${i}]`));
  return { id, when, then };
}

function parseFlagEffect(raw: unknown, questName: string, label: string): FlagEffect {
  if (!raw || typeof raw !== "object") throw new QuestValidationError(`${label}: invalid effect`);
  const o = raw as Record<string, unknown>;
  if ("setFlag" in o) {
    const flag = String(o.setFlag);
    assertNamespace(flag, questName, label);
    const to = o.to !== undefined ? (o.to as FlagValue) : true;
    return { setFlag: flag, to };
  }
  if ("clearFlag" in o) {
    const flag = String(o.clearFlag);
    assertNamespace(flag, questName, label);
    return { clearFlag: flag };
  }
  throw new QuestValidationError(`${label}: only setFlag/clearFlag allowed`);
}

function parseOnFlag(
  raw: unknown,
  questName: string,
): Record<string, { onTrue?: KnockOn[]; onFalse?: KnockOn[] }> {
  if (!raw || typeof raw !== "object") throw new QuestValidationError("onFlag must be an object");
  const out: Record<string, { onTrue?: KnockOn[]; onFalse?: KnockOn[] }> = {};
  for (const [flag, body] of Object.entries(raw as Record<string, unknown>)) {
    assertNamespace(flag, questName, `onFlag.${flag}`);
    if (!body || typeof body !== "object") {
      throw new QuestValidationError(`onFlag.${flag} must be an object`);
    }
    const b = body as Record<string, unknown>;
    out[flag] = {
      onTrue: b.onTrue !== undefined ? parseKnockOns(b.onTrue, questName, `onFlag.${flag}.onTrue`) : undefined,
      onFalse: b.onFalse !== undefined ? parseKnockOns(b.onFalse, questName, `onFlag.${flag}.onFalse`) : undefined,
    };
  }
  return out;
}

function parseKnockOns(raw: unknown, questName: string, label: string): KnockOn[] {
  if (!Array.isArray(raw)) throw new QuestValidationError(`${label} must be an array`);
  return raw.map((k, i) => {
    if (!k || typeof k !== "object") throw new QuestValidationError(`${label}[${i}] invalid`);
    const o = k as Record<string, unknown>;
    if ("grantBadge" in o) {
      const id = String(o.grantBadge);
      assertNamespace(id, questName, `${label}[${i}]`);
      return { grantBadge: id };
    }
    if ("giveArtefact" in o) {
      const id = Number(o.giveArtefact);
      if (!Number.isFinite(id)) throw new QuestValidationError(`${label}[${i}]: bad artefact id`);
      return { giveArtefact: id };
    }
    throw new QuestValidationError(`${label}[${i}]: only grantBadge/giveArtefact`);
  });
}

function parseBadges(raw: unknown, questName: string): BadgeDef[] {
  if (!Array.isArray(raw)) throw new QuestValidationError("badges must be an array");
  return raw.map((b, i) => {
    if (!b || typeof b !== "object") throw new QuestValidationError(`badges[${i}] invalid`);
    const o = b as Record<string, unknown>;
    const id = String(o.id ?? "");
    assertNamespace(id, questName, `badges[${i}]`);
    return {
      id,
      title: String(o.title ?? id),
      description: o.description !== undefined ? String(o.description) : undefined,
    };
  });
}

function assertNamespace(id: string, questName: string, label: string): void {
  const prefix = `${questName}.`;
  if (!id.startsWith(prefix) || id.length <= prefix.length) {
    throw new QuestValidationError(`${label}: id must be prefixed with "${prefix}"`);
  }
}

function assertPredShape(pred: Pred, label: string): void {
  if (!pred || typeof pred !== "object") throw new QuestValidationError(`${label}: invalid pred`);
  if ("not" in pred) {
    assertPredShape(pred.not, label);
    return;
  }
  if ("all" in pred) {
    if (!Array.isArray(pred.all)) throw new QuestValidationError(`${label}: all must be array`);
    pred.all.forEach((p, i) => assertPredShape(p, `${label}.all[${i}]`));
    return;
  }
  if ("any" in pred) {
    if (!Array.isArray(pred.any)) throw new QuestValidationError(`${label}: any must be array`);
    pred.any.forEach((p, i) => assertPredShape(p, `${label}.any[${i}]`));
    return;
  }
  if ("flag" in pred || "holds" in pred || "holdsTag" in pred || "hasBadge" in pred || "atScene" in pred || "scenesOwned" in pred) {
    return;
  }
  throw new QuestValidationError(`${label}: unknown predicate shape`);
}

export function assertFlagOnlyPred(pred: Pred, label: string): void {
  assertPredShape(pred, label);
  if (!isFlagOnlyPred(pred)) {
    throw new QuestValidationError(`${label}: world gates must be flag-only`);
  }
}

export function parseAlchemyRecipes(raw: unknown): AlchemyRecipe[] {
  if (!Array.isArray(raw)) throw new QuestValidationError("Alchemy recipes must be an array");
  return raw.map((r, i) => {
    if (!r || typeof r !== "object") throw new QuestValidationError(`recipes[${i}] invalid`);
    const o = r as Record<string, unknown>;
    const id = String(o.id ?? `recipe-${i}`);
    if (!Array.isArray(o.inputs) || o.inputs.length < 2) {
      throw new QuestValidationError(`recipes[${i}]: inputs must have at least 2 entries`);
    }
    const inputs = o.inputs.map((inp, j) => {
      if (typeof inp === "number") return inp;
      if (inp && typeof inp === "object" && "tag" in inp) return { tag: String((inp as { tag: unknown }).tag) };
      throw new QuestValidationError(`recipes[${i}].inputs[${j}]: id or { tag }`);
    });
    let gives: number | number[];
    if (Array.isArray(o.gives)) {
      gives = o.gives.map(Number);
      if (!gives.every(Number.isFinite)) throw new QuestValidationError(`recipes[${i}]: bad gives`);
    } else {
      gives = Number(o.gives);
      if (!Number.isFinite(gives)) throw new QuestValidationError(`recipes[${i}]: bad gives`);
    }
    return {
      id,
      inputs,
      gives,
      ok: o.ok !== undefined ? String(o.ok) : undefined,
    };
  });
}

export interface FlagChange {
  flag: string;
  from: FlagValue | undefined;
  to: FlagValue | undefined;
}

export function applyFlagEffects(
  flags: Record<string, FlagValue>,
  effects: FlagEffect[],
): { flags: Record<string, FlagValue>; changes: FlagChange[] } {
  const next = { ...flags };
  const changes: FlagChange[] = [];
  for (const effect of effects) {
    if ("setFlag" in effect) {
      const to = effect.to !== undefined ? effect.to : true;
      const from = next[effect.setFlag];
      if (from !== to) {
        next[effect.setFlag] = to;
        changes.push({ flag: effect.setFlag, from, to });
      }
    } else {
      const from = next[effect.clearFlag];
      if (from !== undefined) {
        delete next[effect.clearFlag];
        changes.push({ flag: effect.clearFlag, from, to: undefined });
      }
    }
  }
  return { flags: next, changes };
}

export interface EvalResult {
  flags: Record<string, FlagValue>;
  badges: string[];
  grantedArtefactIds: number[];
  iterations: number;
}

/**
 * Evaluate all quest rules with cascade. Knock-ons run when flags change.
 * giveArtefact ids are returned for the caller to apply to inventory.
 * Quests are processed in the order given (manager files first, then users).
 * Never throws: bad rules are skipped and logged.
 */
export function evaluateQuests(opts: {
  quests: QuestFile[];
  flags: Record<string, FlagValue>;
  badges: string[];
  predContext: Omit<PredContext, "flags" | "badges">;
}): EvalResult {
  try {
    return evaluateQuestsUnsafe(opts);
  } catch (err) {
    logQuestFault("evaluateQuests", err);
    return {
      flags: { ...opts.flags },
      badges: [...opts.badges],
      grantedArtefactIds: [],
      iterations: 0,
    };
  }
}

function evaluateQuestsUnsafe(opts: {
  quests: QuestFile[];
  flags: Record<string, FlagValue>;
  badges: string[];
  predContext: Omit<PredContext, "flags" | "badges">;
}): EvalResult {
  let flags = { ...opts.flags };
  let badges = [...opts.badges];
  const badgeSet = () => new Set(badges);
  const grantedArtefactIds: number[] = [];
  const quests = [...opts.quests];

  let iterations = 0;
  while (iterations < QUEST_EVAL_MAX_ITERATIONS) {
    iterations += 1;
    const passChanges: FlagChange[] = [];

    for (const quest of quests) {
      for (const rule of quest.rules ?? []) {
        try {
          const ctx: PredContext = {
            ...opts.predContext,
            flags,
            badges: badgeSet(),
          };
          if (!evaluatePred(rule.when, ctx)) continue;
          const applied = applyFlagEffects(flags, rule.then ?? []);
          flags = applied.flags;
          passChanges.push(...applied.changes);
        } catch (err) {
          logQuestFault(`quest ${quest.name} rule ${rule.id ?? "?"}`, err);
        }
      }
    }

    if (!passChanges.length) break;

    for (const change of passChanges) {
      try {
        const questName = change.flag.split(".")[0] ?? "";
        const quest = quests.find((q) => q.name === questName);
        const handlers = quest?.onFlag?.[change.flag];
        if (!handlers) continue;
        const knocks =
          change.to === undefined || change.to === false ? handlers.onFalse : handlers.onTrue;
        if (!knocks) continue;
        for (const k of knocks) {
          if ("grantBadge" in k) {
            if (!badges.includes(k.grantBadge)) badges.push(k.grantBadge);
          } else if (!grantedArtefactIds.includes(k.giveArtefact)) {
            grantedArtefactIds.push(k.giveArtefact);
          }
        }
      } catch (err) {
        logQuestFault(`onFlag ${change.flag}`, err);
      }
    }
  }

  return { flags, badges, grantedArtefactIds, iterations };
}

export function alchemyGivesIds(recipe: AlchemyRecipe): number[] {
  return Array.isArray(recipe.gives) ? recipe.gives : [recipe.gives];
}

/** Artefact ids a quest may grant via onFlag knock-ons. */
export function questGiveArtefactIds(quest: QuestFile): number[] {
  const ids: number[] = [];
  for (const handlers of Object.values(quest.onFlag ?? {})) {
    for (const list of [handlers.onTrue, handlers.onFalse]) {
      for (const k of list ?? []) {
        if ("giveArtefact" in k) ids.push(k.giveArtefact);
      }
    }
  }
  return ids;
}

/** Strip in-memory-only fields before writing a quest file. */
export function questFileForDisk(quest: QuestFile): QuestFile {
  const { author: _author, ...rest } = quest;
  return rest;
}

/** Strip in-memory-only fields before writing a recipe file. */
export function alchemyRecipesForDisk(recipes: AlchemyRecipe[]): AlchemyRecipe[] {
  return recipes.map(({ id, inputs, gives, ok }) =>
    ok !== undefined ? { id, inputs, gives, ok } : { id, inputs, gives },
  );
}

export function matchAlchemyRecipe(
  recipes: AlchemyRecipe[],
  selectedIds: number[],
  artefactTags: ReadonlyMap<number, readonly string[]>,
  /** When false, skip this recipe (e.g. grant ACL revoked). Default: allow all. */
  recipeAllowed?: (recipe: AlchemyRecipe) => boolean,
): AlchemyRecipe | undefined {
  if (selectedIds.length < 2) return undefined;
  const selected = [...selectedIds];
  for (const recipe of recipes) {
    if (recipeAllowed && !recipeAllowed(recipe)) continue;
    if (recipe.inputs.length !== selected.length) continue;
    if (multisetMatches(recipe.inputs, selected, artefactTags)) return recipe;
  }
  return undefined;
}

function multisetMatches(
  inputs: Array<number | { tag: string }>,
  selectedIds: number[],
  artefactTags: ReadonlyMap<number, readonly string[]>,
): boolean {
  const pool = [...selectedIds];
  for (const inp of inputs) {
    const idx =
      typeof inp === "number"
        ? pool.findIndex((id) => id === inp)
        : pool.findIndex((id) => artefactTags.get(id)?.includes(inp.tag));
    if (idx < 0) return false;
    pool.splice(idx, 1);
  }
  return pool.length === 0;
}

export function badgeDefsById(quests: QuestFile[]): Map<string, BadgeDef> {
  const map = new Map<string, BadgeDef>();
  for (const q of quests) {
    for (const b of q.badges ?? []) map.set(b.id, b);
  }
  return map;
}
