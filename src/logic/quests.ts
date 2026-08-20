import type {
  AlchemyRecipe,
  BadgeDef,
  FlagValue,
  Pred,
  QuestFile,
  QuestRule,
  QuestRuleOn,
  QuestWake,
  ThenEffect,
} from "../model/logic.js";
import { logQuestFault } from "./log.js";
import { evaluatePred, isFlagOnlyPred, normalizeInputPhrase, type PredContext } from "./pred.js";

export class QuestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestValidationError";
  }
}

/** Keep only set flags (`true`); drop false, numbers, strings, and other leftovers. */
export function sanitizeUserFlags(raw: unknown): Record<string, FlagValue> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, FlagValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true) out[k] = true;
  }
  return out;
}

/** Keep finite numbers; drop non-numbers; omit zeros (unset ≡ 0). */
export function sanitizeUserVars(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) out[k] = v;
  }
  return out;
}

export function parseQuestFile(raw: unknown): QuestFile {
  if (!raw || typeof raw !== "object") throw new QuestValidationError("Quest must be an object");
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? "").trim();
  if (!name || !/^[a-z][a-z0-9_-]*$/i.test(name)) {
    throw new QuestValidationError("Quest name must be a simple identifier");
  }
  if (!Array.isArray(o.rules)) throw new QuestValidationError("Quest rules must be an array");
  const rules: QuestRule[] = [];
  for (let i = 0; i < o.rules.length; i++) {
    try {
      rules.push(parseRule(o.rules[i], name, i));
    } catch (err) {
      logQuestFault(`quest ${name} skip rule[${i}]`, err);
    }
  }
  const badges = o.badges !== undefined ? parseBadges(o.badges, name) : undefined;
  return {
    name,
    title: o.title !== undefined ? String(o.title) : undefined,
    description: o.description !== undefined ? String(o.description) : undefined,
    rules,
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
  const on = parseRuleOn(o.on, `Rule ${id}`);
  const when = parsePred(o.when, `Rule ${id} when`, on);
  if (!Array.isArray(o.then) || !o.then.length) {
    throw new QuestValidationError(`Rule ${id}: then must be a non-empty array`);
  }
  const then = o.then.map((t, i) => parseThenEffect(t, questName, `${id}.then[${i}]`));
  const okRaw = o.ok !== undefined ? String(o.ok).trim() : "";
  return {
    id,
    when,
    then,
    ...(on !== undefined ? { on } : {}),
    ...(okRaw ? { ok: okRaw } : {}),
  };
}

function parseRuleOn(raw: unknown, label: string): QuestRuleOn | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    if ("flag" in o) {
      const flag = String(o.flag ?? "").trim();
      if (!flag) throw new QuestValidationError(`${label}: on.flag must be non-empty`);
      return { flag };
    }
    if ("clearFlag" in o) {
      const flag = String(o.clearFlag ?? "").trim();
      if (!flag) throw new QuestValidationError(`${label}: on.clearFlag must be non-empty`);
      return { clearFlag: flag };
    }
    throw new QuestValidationError(`${label}: on object must be { flag } or { clearFlag }`);
  }
  const on = String(raw);
  if (on === "always") {
    throw new QuestValidationError(`${label}: omit on for always (do not write "always")`);
  }
  if (on === "use" || on === "input" || on === "gain" || on === "drop") return on;
  throw new QuestValidationError(`${label}: on must be use, input, gain, drop, or { flag|clearFlag }`);
}

function parsePred(raw: unknown, label: string, on: QuestRuleOn | undefined): Pred {
  const pred = raw as Pred;
  assertPredShape(pred, label);
  const rewritten = rewritePred(pred);
  assertPredAtomsForOn(rewritten, on, label);
  return rewritten;
}

function rewritePred(pred: Pred): Pred {
  if ("not" in pred) return { not: rewritePred(pred.not) };
  if ("all" in pred) return { all: pred.all.map(rewritePred) };
  if ("any" in pred) return { any: pred.any.map(rewritePred) };
  if ("input" in pred) return { input: normalizeInputPhrase(pred.input) };
  if ("use" in pred) return { use: Number(pred.use) };
  if ("gain" in pred) return { gain: Number(pred.gain) };
  if ("drop" in pred) return { drop: Number(pred.drop) };
  if ("scenesOwned" in pred) return { scenesOwned: Number(pred.scenesOwned) };
  if ("var" in pred) {
    const id = String(pred.var).trim();
    if ("=" in pred) return { var: id, "=": Number(pred["="]) };
    if (">" in pred) return { var: id, ">": Number(pred[">"]) };
    if ("<" in pred) return { var: id, "<": Number(pred["<"]) };
  }
  return pred;
}

function assertPredAtomsForOn(pred: Pred, on: QuestRuleOn | undefined, label: string): void {
  let hasUse = false;
  let hasInput = false;
  let hasGain = false;
  let hasDrop = false;
  walkPredAtoms(pred, (atom) => {
    if ("use" in atom) {
      if (on !== "use") throw new QuestValidationError(`${label}: use is only valid on use rules`);
      hasUse = true;
    }
    if ("input" in atom) {
      if (on !== "input") throw new QuestValidationError(`${label}: input is only valid on input rules`);
      hasInput = true;
    }
    if ("gain" in atom) {
      if (on !== "gain") throw new QuestValidationError(`${label}: gain is only valid on gain rules`);
      hasGain = true;
    }
    if ("drop" in atom) {
      if (on !== "drop") throw new QuestValidationError(`${label}: drop is only valid on drop rules`);
      hasDrop = true;
    }
  });
  if (on === "use" && !hasUse) {
    throw new QuestValidationError(`${label}: use rules must include { use }`);
  }
  if (on === "input" && !hasInput) {
    throw new QuestValidationError(`${label}: input rules must include { input }`);
  }
  if (on === "gain" && !hasGain) {
    throw new QuestValidationError(`${label}: gain rules must include { gain }`);
  }
  if (on === "drop" && !hasDrop) {
    throw new QuestValidationError(`${label}: drop rules must include { drop }`);
  }
}

function walkPredAtoms(pred: Pred, visit: (atom: Pred) => void): void {
  if ("not" in pred) {
    walkPredAtoms(pred.not, visit);
    return;
  }
  if ("all" in pred) {
    for (const p of pred.all) walkPredAtoms(p, visit);
    return;
  }
  if ("any" in pred) {
    for (const p of pred.any) walkPredAtoms(p, visit);
    return;
  }
  visit(pred);
}

function parseThenEffect(raw: unknown, questName: string, label: string): ThenEffect {
  if (!raw || typeof raw !== "object") throw new QuestValidationError(`${label}: invalid effect`);
  const o = raw as Record<string, unknown>;
  if ("setFlag" in o) {
    const flag = String(o.setFlag);
    assertNamespace(flag, questName, label);
    if (o.to !== undefined) {
      if (o.to === false) {
        throw new QuestValidationError(`${label}: use clearFlag instead of setFlag to false`);
      }
      if (o.to !== true) {
        throw new QuestValidationError(`${label}: setFlag to must be true if present`);
      }
    }
    return { setFlag: flag };
  }
  if ("clearFlag" in o) {
    const flag = String(o.clearFlag);
    assertNamespace(flag, questName, label);
    return { clearFlag: flag };
  }
  if ("setVar" in o) {
    const id = String(o.setVar);
    assertNamespace(id, questName, label);
    const to = Number(o.to);
    if (!Number.isFinite(to)) {
      throw new QuestValidationError(`${label}: setVar to must be a finite number`);
    }
    return { setVar: id, to };
  }
  if ("grantBadge" in o) {
    const id = String(o.grantBadge);
    assertNamespace(id, questName, label);
    return { grantBadge: id };
  }
  if ("giveArtefact" in o) {
    const id = Number(o.giveArtefact);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new QuestValidationError(`${label}: giveArtefact must be a finite artefact id`);
    }
    return { giveArtefact: id };
  }
  throw new QuestValidationError(
    `${label}: only setFlag/clearFlag/setVar/grantBadge/giveArtefact allowed`,
  );
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

const VAR_OPS = ["=", ">", "<"] as const;

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
  if ("flag" in pred) {
    const rawFlag = pred as { flag: string; is?: unknown };
    if ("is" in rawFlag) {
      throw new QuestValidationError(
        `${label}: flag "is" is not allowed; use "not." prefix or { not: { flag } }`,
      );
    }
    const raw = String(rawFlag.flag).trim();
    const invert = raw.startsWith("not.");
    const id = invert ? raw.slice("not.".length).trim() : raw;
    if (!id) {
      throw new QuestValidationError(`${label}: flag id must be non-empty`);
    }
    return;
  }
  if ("holds" in pred || "holdsTag" in pred || "hasBadge" in pred || "atScene" in pred) {
    return;
  }
  if ("scenesOwned" in pred) {
    const n = Number((pred as { scenesOwned: unknown }).scenesOwned);
    if (!Number.isFinite(n)) {
      throw new QuestValidationError(`${label}: scenesOwned must be a number`);
    }
    if (typeof (pred as { scenesOwned: unknown }).scenesOwned === "object") {
      throw new QuestValidationError(`${label}: scenesOwned must be a number (not { gte })`);
    }
    return;
  }
  if ("use" in pred) {
    const id = Number(pred.use);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new QuestValidationError(`${label}: use must be a finite artefact id`);
    }
    return;
  }
  if ("gain" in pred) {
    const id = Number(pred.gain);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new QuestValidationError(`${label}: gain must be a finite artefact id`);
    }
    return;
  }
  if ("drop" in pred) {
    const id = Number(pred.drop);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new QuestValidationError(`${label}: drop must be a finite artefact id`);
    }
    return;
  }
  if ("input" in pred) {
    if (typeof pred.input !== "string") {
      throw new QuestValidationError(`${label}: input must be a string`);
    }
    const normalized = normalizeInputPhrase(pred.input);
    if (!normalized) {
      throw new QuestValidationError(`${label}: input must be a non-empty phrase`);
    }
    return;
  }
  if ("var" in pred) {
    const id = String(pred.var ?? "").trim();
    if (!id) throw new QuestValidationError(`${label}: var id must be non-empty`);
    const keys = VAR_OPS.filter((op) => op in pred);
    if (keys.length !== 1) {
      throw new QuestValidationError(`${label}: var needs exactly one of =, >, <`);
    }
    const op = keys[0]!;
    const n = Number((pred as Record<string, unknown>)[op]);
    if (!Number.isFinite(n)) {
      throw new QuestValidationError(`${label}: var ${op} must be a finite number`);
    }
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

export function applyThenEffects(
  flags: Record<string, FlagValue>,
  vars: Record<string, number>,
  effects: ThenEffect[],
  opts: {
    inventoryIds: Set<number>;
    canGiveArtefact: (id: number) => boolean;
    badges?: string[];
  },
): {
  flags: Record<string, FlagValue>;
  vars: Record<string, number>;
  badges: string[];
  flagChanges: FlagChange[];
  flagsSet: Set<string>;
  flagsCleared: Set<string>;
  gained: number[];
  grantedArtefactIds: number[];
} {
  const nextFlags = { ...flags };
  const nextVars = { ...vars };
  const badges = [...(opts.badges ?? [])];
  const flagChanges: FlagChange[] = [];
  const flagsSet = new Set<string>();
  const flagsCleared = new Set<string>();
  const gained: number[] = [];
  const grantedArtefactIds: number[] = [];

  for (const effect of effects) {
    if ("setFlag" in effect) {
      const from = nextFlags[effect.setFlag];
      if (from !== true) {
        nextFlags[effect.setFlag] = true;
        flagChanges.push({ flag: effect.setFlag, from, to: true });
        flagsSet.add(effect.setFlag);
      }
    } else if ("clearFlag" in effect) {
      const from = nextFlags[effect.clearFlag];
      if (from !== undefined) {
        delete nextFlags[effect.clearFlag];
        flagChanges.push({ flag: effect.clearFlag, from, to: undefined });
        flagsCleared.add(effect.clearFlag);
      }
    } else if ("setVar" in effect) {
      const cur = nextVars[effect.setVar] ?? 0;
      if (cur !== effect.to) {
        if (effect.to === 0) delete nextVars[effect.setVar];
        else nextVars[effect.setVar] = effect.to;
      }
    } else if ("grantBadge" in effect) {
      if (!badges.includes(effect.grantBadge)) badges.push(effect.grantBadge);
    } else if ("giveArtefact" in effect) {
      const id = effect.giveArtefact;
      if (opts.inventoryIds.has(id)) continue;
      if (!opts.canGiveArtefact(id)) continue;
      opts.inventoryIds.add(id);
      gained.push(id);
      grantedArtefactIds.push(id);
    }
  }

  return {
    flags: nextFlags,
    vars: nextVars,
    badges,
    flagChanges,
    flagsSet,
    flagsCleared,
    gained,
    grantedArtefactIds,
  };
}

export interface EvalResult {
  flags: Record<string, FlagValue>;
  vars: Record<string, number>;
  badges: string[];
  grantedArtefactIds: number[];
  actionMatched: boolean;
  actionOk?: string;
}

export const QUEST_ACTION_DONE = "Done.";
export const QUEST_ACTION_NOTHING = "Nothing happens.";

export function questActionMessage(outcome: { actionMatched: boolean; actionOk?: string }): string {
  if (!outcome.actionMatched) return QUEST_ACTION_NOTHING;
  const ok = outcome.actionOk?.trim();
  return ok || QUEST_ACTION_DONE;
}

export function ruleEligible(
  rule: QuestRule,
  wake: QuestWake,
  edges: { flagsSet: ReadonlySet<string>; flagsCleared: ReadonlySet<string> },
): boolean {
  const on = rule.on;
  if (on === undefined) return true;
  if (on === "use") return wake === "use";
  if (on === "input") return wake === "input";
  if (on === "gain" || on === "drop") return true;
  if ("flag" in on) return edges.flagsSet.has(on.flag);
  if ("clearFlag" in on) return edges.flagsCleared.has(on.clearFlag);
  return false;
}

/**
 * Single-pass quest evaluation in document order.
 * Mid-eval giveArtefact updates inventoryIds and the gained set immediately.
 * Never throws: bad rules are skipped and logged.
 */
export function evaluateQuests(opts: {
  quests: QuestFile[];
  flags: Record<string, FlagValue>;
  vars?: Record<string, number>;
  badges: string[];
  predContext: Omit<PredContext, "flags" | "badges" | "vars">;
  wake?: QuestWake;
  /** Artefact ids already in the gained set at wake (e.g. collect). */
  wakeGained?: Iterable<number>;
  /** Artefact ids already in the dropped set at wake (e.g. player drop). */
  wakeDropped?: Iterable<number>;
  canGiveArtefact?: (id: number) => boolean;
}): EvalResult {
  try {
    return evaluateQuestsUnsafe(opts);
  } catch (err) {
    logQuestFault("evaluateQuests", err);
    return {
      flags: { ...opts.flags },
      vars: { ...(opts.vars ?? {}) },
      badges: [...opts.badges],
      grantedArtefactIds: [],
      actionMatched: false,
    };
  }
}

function evaluateQuestsUnsafe(opts: {
  quests: QuestFile[];
  flags: Record<string, FlagValue>;
  vars?: Record<string, number>;
  badges: string[];
  predContext: Omit<PredContext, "flags" | "badges" | "vars">;
  wake?: QuestWake;
  wakeGained?: Iterable<number>;
  wakeDropped?: Iterable<number>;
  canGiveArtefact?: (id: number) => boolean;
}): EvalResult {
  let flags = { ...opts.flags };
  let vars = { ...(opts.vars ?? {}) };
  let badges = [...opts.badges];
  const inventoryIds = new Set(opts.predContext.inventoryIds);
  const gained = new Set<number>(opts.wakeGained ?? []);
  const dropped = new Set<number>(opts.wakeDropped ?? []);
  const flagsSet = new Set<string>();
  const flagsCleared = new Set<string>();
  const grantedArtefactIds: number[] = [];
  const canGive = opts.canGiveArtefact ?? (() => true);
  const wake = opts.wake ?? "always";
  let actionMatched = false;
  let actionOk: string | undefined;

  for (const quest of opts.quests) {
    for (const rule of quest.rules ?? []) {
      try {
        if (!ruleEligible(rule, wake, { flagsSet, flagsCleared })) continue;
        const ctx: PredContext = {
          ...opts.predContext,
          inventoryIds,
          flags,
          badges: new Set(badges),
          vars,
          gainedIds: gained,
          droppedIds: dropped,
        };
        if (!evaluatePred(rule.when, ctx)) continue;
        if ((rule.on === "use" || rule.on === "input") && rule.on === wake) {
          actionMatched = true;
          if (actionOk === undefined) {
            const ok = rule.ok?.trim();
            if (ok) actionOk = ok;
          }
        }
        const applied = applyThenEffects(flags, vars, rule.then ?? [], {
          inventoryIds,
          canGiveArtefact: canGive,
          badges,
        });
        flags = applied.flags;
        vars = applied.vars;
        badges = applied.badges;
        for (const f of applied.flagsSet) flagsSet.add(f);
        for (const f of applied.flagsCleared) flagsCleared.add(f);
        for (const id of applied.gained) gained.add(id);
        for (const id of applied.grantedArtefactIds) {
          if (!grantedArtefactIds.includes(id)) grantedArtefactIds.push(id);
        }
      } catch (err) {
        logQuestFault(`quest ${quest.name} rule ${rule.id ?? "?"}`, err);
      }
    }
  }

  return { flags, vars, badges, grantedArtefactIds, actionMatched, actionOk };
}

export function alchemyGivesIds(recipe: AlchemyRecipe): number[] {
  return Array.isArray(recipe.gives) ? recipe.gives : [recipe.gives];
}

/** Artefact ids a quest may grant via then giveArtefact. */
export function questGiveArtefactIds(quest: QuestFile): number[] {
  const ids: number[] = [];
  for (const rule of quest.rules ?? []) {
    for (const effect of rule.then ?? []) {
      if ("giveArtefact" in effect) ids.push(effect.giveArtefact);
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
