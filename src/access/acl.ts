import { prepareJsonTextarea } from "../json-textarea.js";
import type { Deny, Grant, Right } from "../model/types.js";
import { RIGHT_RANK } from "../model/types.js";

/** True if `have` covers `need` (manage ⊃ edit ⊃ read). */
export function rightsCover(have: Right[], need: Right): boolean {
  const needRank = RIGHT_RANK[need];
  return have.some((r) => RIGHT_RANK[r] >= needRank);
}

export function matchesDeny(denies: Deny[] | undefined, who: string, right: Right): boolean {
  if (!denies?.length) return false;
  for (const d of denies) {
    if (d.who !== who) continue;
    if (!d.rights || d.rights.length === 0) return true;
    if (d.rights.includes(right)) return true;
  }
  return false;
}

/** Highest rights granted to `who` (including `"*"`) for the needed check. */
export function grantedRights(grants: Grant[] | undefined, who: string | undefined): Right[] {
  if (!grants?.length) return [];
  const out = new Set<Right>();
  for (const g of grants) {
    if (g.who === "*") {
      for (const r of g.rights) out.add(r);
      continue;
    }
    if (who && g.who === who) {
      for (const r of g.rights) out.add(r);
    }
  }
  return [...out];
}

export function grantCovers(
  grants: Grant[] | undefined,
  who: string | undefined,
  right: Right,
): boolean {
  return rightsCover(grantedRights(grants, who), right);
}

export function normalizeGrants(raw: unknown, legacyInvites?: unknown): Grant[] {
  const fromInvites = (): Grant[] => {
    const invites = Array.isArray(legacyInvites)
      ? legacyInvites
      : Array.isArray(raw) && raw.every((x) => typeof x === "string")
        ? raw
        : [];
    return invites.map((who) => ({ who: String(who), rights: ["read" as Right] }));
  };

  if (!Array.isArray(raw) || raw.length === 0) {
    return fromInvites();
  }

  if (raw.every((x) => typeof x === "string")) {
    return fromInvites();
  }

  const out: Grant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const who = String(obj.who ?? "").trim();
    if (!who) continue;
    const rights = normalizeRightsList(obj.rights);
    if (!rights.length) continue;
    out.push({ who, rights });
  }
  return out;
}

export function normalizeDenies(raw: unknown): Deny[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // Legacy string[] = deny all for that username
  if (raw.every((x) => typeof x === "string")) {
    return raw.map((who) => ({ who: String(who) }));
  }

  const out: Deny[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const who = String(obj.who ?? "").trim();
    if (!who) continue;
    if (obj.rights === undefined || obj.rights === null) {
      out.push({ who });
      continue;
    }
    const rights = normalizeRightsList(obj.rights);
    out.push(rights.length ? { who, rights } : { who });
  }
  return out;
}

export function normalizeRightsList(raw: unknown): Right[] {
  if (!Array.isArray(raw)) return [];
  const out: Right[] = [];
  for (const r of raw) {
    const s = String(r);
    if (s === "read" || s === "edit" || s === "manage") out.push(s);
  }
  return out;
}

export function parseAccessPayload(body: Record<string, unknown>): {
  grants?: Grant[];
  denies?: Deny[];
} {
  const out: { grants?: Grant[]; denies?: Deny[] } = {};
  if (body.grants !== undefined || body.grantsJson !== undefined) {
    out.grants = normalizeGrants(parseJsonField(body.grantsJson ?? body.grants));
  }
  if (body.denies !== undefined || body.deniesJson !== undefined) {
    out.denies = normalizeDenies(parseJsonField(body.deniesJson ?? body.denies));
  }
  return out;
}

function parseJsonField(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    return JSON.parse(prepareJsonTextarea(trimmed)) as unknown;
  }
  return value;
}

export function formatAccessSummary(grants: Grant[] | undefined, denies: Deny[] | undefined): string {
  const lines: string[] = [];
  lines.push("Grants:");
  if (!grants?.length) {
    lines.push("  (none)");
  } else {
    for (const g of grants) {
      lines.push(`  ${g.who} [${g.rights.join(", ")}]`);
    }
  }
  lines.push("Denies:");
  if (!denies?.length) {
    lines.push("  (none)");
  } else {
    for (const d of denies) {
      const rights = d.rights?.length ? d.rights.join(", ") : "all";
      lines.push(`  ${d.who} [${rights}]`);
    }
  }
  return lines.join("\n");
}

export function stripLegacyInvites<T extends { invites?: string[]; grants?: Grant[] }>(
  meta: T,
): Omit<T, "invites"> {
  const { invites: _invites, ...rest } = meta;
  return rest;
}
