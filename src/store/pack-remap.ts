/**
 * Pure remappers for adventure pack export/import.
 * Numeric maps rewrite scene/artefact ids; quest renames rewrite namespaces.
 */
import type {
  AlchemyRecipe,
  FlagRef,
  Pred,
  QuestFile,
  QuestRule,
  QuestRuleOn,
  ThenEffect,
} from "../model/logic.js";
import type {
  ArtefactRecord,
  EntranceGroupRecord,
  ExitRecord,
  GroupRecord,
  SceneRecord,
} from "../model/types.js";

export class PackRemapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackRemapError";
  }
}

export type IdMap = ReadonlyMap<number, number>;
export type StringIdMap = ReadonlyMap<string, string>;

/** Ascending source ids → dense 1..N. */
export function buildDenseIdMap(ids: Iterable<number>): Map<number, number> {
  const sorted = [...new Set(ids)].filter((id) => Number.isFinite(id) && id > 0).sort((a, b) => a - b);
  const map = new Map<number, number>();
  sorted.forEach((id, i) => map.set(id, i + 1));
  return map;
}

/** Dense 1..N → host ids starting at `base` (inclusive). */
export function buildOffsetIdMap(denseCount: number, base: number): Map<number, number> {
  if (!Number.isFinite(base) || base < 1) {
    throw new PackRemapError(`Invalid id base ${base}`);
  }
  const map = new Map<number, number>();
  for (let d = 1; d <= denseCount; d++) {
    map.set(d, base + d - 1);
  }
  return map;
}

/** Ascending string ids (numeric when possible) → dense "1".."N". */
export function buildDenseStringIdMap(ids: Iterable<string>): Map<string, string> {
  const sorted = [...new Set([...ids].map((id) => String(id).trim()).filter(Boolean))].sort(
    (a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === a && String(nb) === b) {
        return na - nb;
      }
      return a.localeCompare(b);
    },
  );
  const map = new Map<string, string>();
  sorted.forEach((id, i) => map.set(id, String(i + 1)));
  return map;
}

/** Dense "1".."N" → host string ids starting at numeric `base`. */
export function buildOffsetStringIdMap(denseCount: number, base: number): Map<string, string> {
  if (!Number.isFinite(base) || base < 1) {
    throw new PackRemapError(`Invalid string id base ${base}`);
  }
  const map = new Map<string, string>();
  for (let d = 1; d <= denseCount; d++) {
    map.set(String(d), String(base + d - 1));
  }
  return map;
}

function mapId(map: IdMap, id: number, label: string): number {
  const next = map.get(id);
  if (next === undefined) {
    throw new PackRemapError(`Dangling ${label} id ${id}`);
  }
  return next;
}

function mapStringId(map: StringIdMap, id: string, label: string): string {
  const next = map.get(id);
  if (next === undefined) {
    throw new PackRemapError(`Dangling ${label} id ${id}`);
  }
  return next;
}

const HOLDS_RE = /\bholds:(not\.)?([1-9]\d*)\b/g;

/** Rewrite `holds:N` / `holds:not.N` using the artefact id map. */
export function remapFlagRef(ref: FlagRef, artefactMap: IdMap): FlagRef {
  if (!ref) return ref;
  return ref.replace(HOLDS_RE, (_full, notPrefix: string | undefined, idStr: string) => {
    const oldId = Number(idStr);
    const newId = mapId(artefactMap, oldId, "holds");
    return `holds:${notPrefix ?? ""}${newId}`;
  });
}

function remapDetailWhen(
  detailWhen: Record<string, FlagRef> | undefined,
  artefactMap: IdMap,
): Record<string, FlagRef> | undefined {
  if (!detailWhen) return undefined;
  const out: Record<string, FlagRef> = {};
  for (const [k, v] of Object.entries(detailWhen)) {
    out[k] = typeof v === "string" ? remapFlagRef(v, artefactMap) : v;
  }
  return out;
}

/**
 * Remap quest namespace prefix `from.` → `to.` at id token boundaries
 * (same spirit as migration 005 personal prefix rewrite).
 */
export function remapQuestPrefix(text: string, from: string, to: string): string {
  if (typeof text !== "string" || !text || !from || from === to) return text;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[:;,\\s]|not\\.)${escaped}\\.`, "g");
  return text.replace(re, (_m, lead: string) => `${lead}${to}.`);
}

export function remapQuestPrefixes(text: string, renames: ReadonlyMap<string, string>): string {
  let s = text;
  for (const [from, to] of renames) {
    if (from !== to) s = remapQuestPrefix(s, from, to);
  }
  return s;
}

function remapFlagRefFields<T extends { when?: FlagRef; detailWhen?: Record<string, FlagRef> }>(
  record: T,
  artefactMap: IdMap,
  questRenames?: ReadonlyMap<string, string>,
): T {
  const next = { ...record };
  if (typeof next.when === "string") {
    let when = remapFlagRef(next.when, artefactMap);
    if (questRenames?.size) when = remapQuestPrefixes(when, questRenames);
    next.when = when;
  }
  if (next.detailWhen) {
    const details: Record<string, FlagRef> = {};
    for (const [k, v] of Object.entries(next.detailWhen)) {
      let s = typeof v === "string" ? remapFlagRef(v, artefactMap) : v;
      if (typeof s === "string" && questRenames?.size) s = remapQuestPrefixes(s, questRenames);
      details[k] = s;
    }
    next.detailWhen = details;
  }
  return next;
}

export function remapExit(
  exit: ExitRecord,
  sceneMap: IdMap,
  artefactMap: IdMap,
  questRenames?: ReadonlyMap<string, string>,
): ExitRecord {
  const next: ExitRecord = {
    ...exit,
    toSceneId: mapId(sceneMap, exit.toSceneId, "exit toSceneId"),
  };
  return remapFlagRefFields(next, artefactMap, questRenames);
}

export function remapScene(
  scene: SceneRecord,
  sceneMap: IdMap,
  artefactMap: IdMap,
  groupMap: StringIdMap,
  entranceGroupMap: StringIdMap,
  questRenames?: ReadonlyMap<string, string>,
): SceneRecord {
  let next: SceneRecord = {
    ...scene,
    id: mapId(sceneMap, scene.id, "scene"),
  };
  if (next.groupId != null && next.groupId !== "") {
    next.groupId = mapStringId(groupMap, String(next.groupId), "group");
  }
  if (next.entranceGroupId != null && next.entranceGroupId !== "") {
    next.entranceGroupId = mapStringId(entranceGroupMap, String(next.entranceGroupId), "entrance group");
  }
  next = remapFlagRefFields(next, artefactMap, questRenames);
  return next;
}

export function remapArtefact(
  artefact: ArtefactRecord,
  sceneMap: IdMap,
  artefactMap: IdMap,
  questRenames?: ReadonlyMap<string, string>,
): ArtefactRecord {
  let next: ArtefactRecord = {
    ...artefact,
    id: mapId(artefactMap, artefact.id, "artefact"),
    homeSceneId: mapId(sceneMap, artefact.homeSceneId, "homeSceneId"),
  };
  next = remapFlagRefFields(next, artefactMap, questRenames);
  return next;
}

export function remapGroup(group: GroupRecord, sceneMap: IdMap, groupMap: StringIdMap): GroupRecord {
  return {
    ...group,
    id: mapStringId(groupMap, group.id, "group"),
    sceneIds: group.sceneIds.map((id) => mapId(sceneMap, id, "group sceneIds")),
  };
}

export function remapEntranceGroup(
  group: EntranceGroupRecord,
  sceneMap: IdMap,
  entranceGroupMap: StringIdMap,
): EntranceGroupRecord {
  return {
    ...group,
    id: mapStringId(entranceGroupMap, group.id, "entrance group"),
    entranceSceneId: mapId(sceneMap, group.entranceSceneId, "entranceSceneId"),
    sceneIds: group.sceneIds.map((id) => mapId(sceneMap, id, "entrance group sceneIds")),
  };
}

export function remapAlchemyRecipes(
  recipes: AlchemyRecipe[],
  artefactMap: IdMap,
): AlchemyRecipe[] {
  return recipes.map((recipe) => ({
    ...recipe,
    inputs: recipe.inputs.map((inp) =>
      typeof inp === "number" ? mapId(artefactMap, inp, "alchemy input") : inp,
    ),
    gives: Array.isArray(recipe.gives)
      ? recipe.gives.map((id) => mapId(artefactMap, id, "alchemy gives"))
      : mapId(artefactMap, recipe.gives, "alchemy gives"),
  }));
}

function remapPred(pred: Pred, sceneMap: IdMap, artefactMap: IdMap, questRenames?: ReadonlyMap<string, string>): Pred {
  if ("flag" in pred) {
    const flag =
      questRenames?.size ? remapQuestPrefixes(pred.flag, questRenames) : pred.flag;
    return { flag };
  }
  if ("holds" in pred) return { holds: mapId(artefactMap, pred.holds, "holds") };
  if ("holdsTag" in pred) return { holdsTag: pred.holdsTag };
  if ("hasBadge" in pred) {
    const hasBadge =
      questRenames?.size ? remapQuestPrefixes(pred.hasBadge, questRenames) : pred.hasBadge;
    return { hasBadge };
  }
  if ("atScene" in pred) return { atScene: mapId(sceneMap, pred.atScene, "atScene") };
  if ("scenesOwned" in pred) return { scenesOwned: pred.scenesOwned };
  if ("use" in pred) return { use: mapId(artefactMap, pred.use, "use") };
  if ("input" in pred) return { input: pred.input };
  if ("gain" in pred) return { gain: mapId(artefactMap, pred.gain, "gain") };
  if ("drop" in pred) return { drop: mapId(artefactMap, pred.drop, "drop") };
  if ("chance" in pred) return { chance: pred.chance };
  if ("var" in pred) {
    const id = questRenames?.size ? remapQuestPrefixes(String(pred.var), questRenames) : pred.var;
    const rest = { ...pred, var: id };
    return rest as Pred;
  }
  if ("not" in pred) return { not: remapPred(pred.not, sceneMap, artefactMap, questRenames) };
  if ("all" in pred) {
    return { all: pred.all.map((p) => remapPred(p, sceneMap, artefactMap, questRenames)) };
  }
  if ("any" in pred) {
    return { any: pred.any.map((p) => remapPred(p, sceneMap, artefactMap, questRenames)) };
  }
  return pred;
}

function remapThenEffect(
  effect: ThenEffect,
  artefactMap: IdMap,
  questRenames?: ReadonlyMap<string, string>,
): ThenEffect {
  if ("setFlag" in effect) {
    const setFlag =
      questRenames?.size ? remapQuestPrefixes(effect.setFlag, questRenames) : effect.setFlag;
    return { setFlag };
  }
  if ("clearFlag" in effect) {
    const clearFlag =
      questRenames?.size ? remapQuestPrefixes(effect.clearFlag, questRenames) : effect.clearFlag;
    return { clearFlag };
  }
  if ("setVar" in effect) {
    const id = questRenames?.size ? remapQuestPrefixes(effect.setVar, questRenames) : effect.setVar;
    if ("to" in effect) return { setVar: id, to: effect.to };
    return { setVar: id, random: effect.random };
  }
  if ("incVar" in effect) {
    const id = questRenames?.size ? remapQuestPrefixes(effect.incVar, questRenames) : effect.incVar;
    return { incVar: id, by: effect.by };
  }
  if ("decVar" in effect) {
    const id = questRenames?.size ? remapQuestPrefixes(effect.decVar, questRenames) : effect.decVar;
    return { decVar: id, by: effect.by };
  }
  if ("clearVar" in effect) {
    const clearVar =
      questRenames?.size ? remapQuestPrefixes(effect.clearVar, questRenames) : effect.clearVar;
    return { clearVar };
  }
  if ("grantBadge" in effect) {
    const grantBadge =
      questRenames?.size ? remapQuestPrefixes(effect.grantBadge, questRenames) : effect.grantBadge;
    return { grantBadge };
  }
  if ("giveArtefact" in effect) {
    return { giveArtefact: mapId(artefactMap, effect.giveArtefact, "giveArtefact") };
  }
  return effect;
}

function remapRuleOn(
  on: QuestRuleOn | undefined,
  questRenames?: ReadonlyMap<string, string>,
): QuestRuleOn | undefined {
  if (on === undefined) return undefined;
  if (typeof on === "string") return on;
  if ("flag" in on) {
    const flag = questRenames?.size ? remapQuestPrefixes(on.flag, questRenames) : on.flag;
    return { flag };
  }
  if ("clearFlag" in on) {
    const clearFlag =
      questRenames?.size ? remapQuestPrefixes(on.clearFlag, questRenames) : on.clearFlag;
    return { clearFlag };
  }
  return on;
}

function remapRule(
  rule: QuestRule,
  sceneMap: IdMap,
  artefactMap: IdMap,
  questRenames?: ReadonlyMap<string, string>,
): QuestRule {
  return {
    ...rule,
    when: remapPred(rule.when, sceneMap, artefactMap, questRenames),
    then: rule.then.map((t) => remapThenEffect(t, artefactMap, questRenames)),
    ...(rule.on !== undefined
      ? { on: remapRuleOn(rule.on, questRenames) }
      : {}),
  };
}

export function remapQuest(
  quest: QuestFile,
  sceneMap: IdMap,
  artefactMap: IdMap,
  questRenames?: ReadonlyMap<string, string>,
): QuestFile {
  const name =
    questRenames?.get(quest.name) && questRenames.get(quest.name) !== quest.name
      ? questRenames.get(quest.name)!
      : quest.name;
  const next: QuestFile = {
    ...quest,
    name,
    rules: quest.rules.map((r) => remapRule(r, sceneMap, artefactMap, questRenames)),
  };
  if (quest.badges) {
    next.badges = quest.badges.map((b) => ({
      ...b,
      id: questRenames?.size ? remapQuestPrefixes(b.id, questRenames) : b.id,
    }));
  }
  if (quest.alchemy?.length) {
    next.alchemy = remapAlchemyRecipes(quest.alchemy, artefactMap);
  }
  return next;
}
