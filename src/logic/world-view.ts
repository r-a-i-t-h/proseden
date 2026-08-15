import type { FlagValue, Pred } from "../model/logic.js";
import type { ArtefactRecord, ExitRecord, SceneRecord } from "../model/types.js";
import { logQuestFault } from "./log.js";
import { evaluateFlagPred } from "./pred.js";

export function visibleExits(
  exits: ExitRecord[],
  flags: Record<string, FlagValue>,
): ExitRecord[] {
  try {
    return exits.filter((e) => {
      if (!e.when) return true;
      const ok = evaluateFlagPred(e.when, flags);
      if (ok) return true;
      return !e.hidden;
    });
  } catch (err) {
    logQuestFault("visibleExits", err);
    return exits.filter((e) => !e.when);
  }
}

export function exitAllowed(exit: ExitRecord, flags: Record<string, FlagValue>): boolean {
  try {
    if (!exit.when) return true;
    return evaluateFlagPred(exit.when, flags);
  } catch (err) {
    logQuestFault("exitAllowed", err);
    return false;
  }
}

export function visibleArtefacts(
  artefacts: ArtefactRecord[],
  flags: Record<string, FlagValue>,
): ArtefactRecord[] {
  try {
    return artefacts.filter((a) => !a.when || evaluateFlagPred(a.when, flags));
  } catch (err) {
    logQuestFault("visibleArtefacts", err);
    return artefacts.filter((a) => !a.when);
  }
}

export function artefactVisible(artefact: ArtefactRecord, flags: Record<string, FlagValue>): boolean {
  try {
    if (!artefact.when) return true;
    return evaluateFlagPred(artefact.when, flags);
  } catch (err) {
    logQuestFault("artefactVisible", err);
    return false;
  }
}

/** Resolve which detail names/texts a reader sees (hide / show / swap). */
export function resolveSceneDetails(
  scene: SceneRecord,
  flags: Record<string, FlagValue>,
): Record<string, string> {
  try {
    return resolveSceneDetailsUnsafe(scene, flags);
  } catch (err) {
    logQuestFault("resolveSceneDetails", err);
    return { ...scene.details };
  }
}

function resolveSceneDetailsUnsafe(
  scene: SceneRecord,
  flags: Record<string, FlagValue>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const swaps = scene.detailSwap ?? {};
  const whens = scene.detailWhen ?? {};
  const swapSources = new Set(Object.values(swaps).flat());
  const slotNames = new Set([
    ...Object.keys(scene.details).filter((k) => !swapSources.has(k) || k in swaps),
    ...Object.keys(swaps),
  ]);

  for (const slot of slotNames) {
    const variantKeys = swaps[slot];
    if (variantKeys?.length) {
      let chosen: string | undefined;
      for (const key of variantKeys) {
        const gate = whens[key];
        if (gate && !evaluateFlagPred(gate, flags)) continue;
        if (scene.details[key] === undefined) continue;
        chosen = key;
        break;
      }
      if (chosen !== undefined) out[slot] = scene.details[chosen]!;
      continue;
    }
    const text = scene.details[slot];
    if (text === undefined) continue;
    const gate = whens[slot];
    if (gate && !evaluateFlagPred(gate, flags)) continue;
    out[slot] = text;
  }
  return out;
}

export function parseOptionalPred(raw: unknown): Pred | undefined {
  if (raw === undefined || raw === null) return undefined;
  return raw as Pred;
}
