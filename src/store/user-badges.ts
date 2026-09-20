import type { UserBadge } from "../model/types.js";

/** Load `*.badges.json`: array of `{ badge, grantTime? }`. */
export function parseUserBadges(raw: unknown): UserBadge[] {
  if (!Array.isArray(raw)) return [];
  const out: UserBadge[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const rec = parseUserBadgeEntry(entry);
    if (!rec || seen.has(rec.badge)) continue;
    seen.add(rec.badge);
    out.push(rec);
  }
  return out;
}

function parseUserBadgeEntry(entry: unknown): UserBadge | undefined {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const o = entry as Record<string, unknown>;
  const badge = typeof o.badge === "string" ? o.badge.trim() : "";
  if (!badge) return undefined;
  const grantRaw = o.grantTime;
  const grantTime =
    typeof grantRaw === "string" && grantRaw.trim() ? grantRaw.trim() : undefined;
  return grantTime ? { badge, grantTime } : { badge };
}

/** Keep existing rows (and their grantTime); stamp `now` on newly granted ids. */
export function mergeGrantedBadges(
  prior: UserBadge[],
  ids: string[],
  now: string,
): UserBadge[] {
  const held = new Map(prior.map((b) => [b.badge, b]));
  return ids.map((id) => held.get(id) ?? { badge: id, grantTime: now });
}
