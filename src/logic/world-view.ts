import type { FlagRef } from "../model/logic.js";
import type { ArtefactRecord, ExitRecord, SceneRecord } from "../model/types.js";
import { logQuestFault } from "./log.js";
import { evaluateFlagRef, type GateFacts } from "./pred.js";

export function visibleExits(exits: ExitRecord[], facts: GateFacts): ExitRecord[] {
  try {
    return exits.filter((e) => {
      if (!e.when) return true;
      const ok = evaluateFlagRef(e.when, facts);
      if (ok) return true;
      return !e.hidden;
    });
  } catch (err) {
    logQuestFault("visibleExits", err);
    return exits.filter((e) => !e.when);
  }
}

export function exitAllowed(exit: ExitRecord, facts: GateFacts): boolean {
  try {
    if (!exit.when) return true;
    return evaluateFlagRef(exit.when, facts);
  } catch (err) {
    logQuestFault("exitAllowed", err);
    return false;
  }
}

export function visibleArtefacts(artefacts: ArtefactRecord[], facts: GateFacts): ArtefactRecord[] {
  try {
    return artefacts.filter((a) => !a.when || evaluateFlagRef(a.when, facts));
  } catch (err) {
    logQuestFault("visibleArtefacts", err);
    return artefacts.filter((a) => !a.when);
  }
}

export function artefactVisible(artefact: ArtefactRecord, facts: GateFacts): boolean {
  try {
    if (!artefact.when) return true;
    return evaluateFlagRef(artefact.when, facts);
  } catch (err) {
    logQuestFault("artefactVisible", err);
    return false;
  }
}

/** Scene access gate after ACL (body never gated). */
export function sceneAllowed(scene: SceneRecord, facts: GateFacts): boolean {
  try {
    if (!scene.when) return true;
    return evaluateFlagRef(scene.when, facts);
  } catch (err) {
    logQuestFault("sceneAllowed", err);
    return false;
  }
}

/** Resolve which detail names/texts a reader sees (hide / legacy swap). */
export function resolveSceneDetails(scene: SceneRecord, facts: GateFacts): Record<string, string> {
  try {
    return resolveDetailsUnsafe(scene.details, scene.detailWhen, scene.detailSwap, facts);
  } catch (err) {
    logQuestFault("resolveSceneDetails", err);
    return { ...scene.details };
  }
}

export function resolveArtefactDetails(
  artefact: ArtefactRecord,
  facts: GateFacts,
): Record<string, string> {
  try {
    return resolveDetailsUnsafe(artefact.details, artefact.detailWhen, artefact.detailSwap, facts);
  } catch (err) {
    logQuestFault("resolveArtefactDetails", err);
    return { ...artefact.details };
  }
}

function resolveDetailsUnsafe(
  details: Record<string, string>,
  detailWhen: Record<string, FlagRef> | undefined,
  detailSwap: Record<string, string[]> | undefined,
  facts: GateFacts,
): Record<string, string> {
  const out: Record<string, string> = {};
  const swaps = detailSwap ?? {};
  const whens = detailWhen ?? {};
  const swapSources = new Set(Object.values(swaps).flat());
  const slotNames = new Set([
    ...Object.keys(details).filter((k) => !swapSources.has(k) || k in swaps),
    ...Object.keys(swaps),
  ]);

  for (const slot of slotNames) {
    const variantKeys = swaps[slot];
    if (variantKeys?.length) {
      let chosen: string | undefined;
      for (const key of variantKeys) {
        const gate = whens[key];
        if (gate && !evaluateFlagRef(gate, facts)) continue;
        if (details[key] === undefined) continue;
        chosen = key;
        break;
      }
      if (chosen !== undefined) out[slot] = details[chosen]!;
      continue;
    }
    const text = details[slot];
    if (text === undefined) continue;
    const gate = whens[slot];
    if (gate && !evaluateFlagRef(gate, facts)) continue;
    out[slot] = text;
  }
  return out;
}
