#!/usr/bin/env node
/**
 * Convert `data/users/*.badges.json` from a string-id array to objects.
 *
 *   ["builders.hamlet"]  →  [{ "badge": "builders.hamlet" }]
 *
 * Does not invent grantTime. Already-object files are left alone.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {unknown} raw
 * @returns {Array<{ badge: string, grantTime?: string }>}
 */
export function convertBadgeList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    const rec = convertBadgeEntry(entry);
    if (!rec || seen.has(rec.badge)) continue;
    seen.add(rec.badge);
    out.push(rec);
  }
  return out;
}

/** @param {unknown} entry */
function convertBadgeEntry(entry) {
  if (typeof entry === "string") {
    const badge = entry.trim();
    return badge ? { badge } : undefined;
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const badge = typeof entry.badge === "string" ? entry.badge.trim() : "";
  if (!badge) return undefined;
  const grantRaw = entry.grantTime;
  const grantTime =
    typeof grantRaw === "string" && grantRaw.trim() ? grantRaw.trim() : undefined;
  return grantTime ? { badge, grantTime } : { badge };
}

/** True when the on-disk array still has legacy string ids. */
export function badgeListNeedsConvert(raw) {
  return Array.isArray(raw) && raw.some((entry) => typeof entry === "string");
}

/** @param {string} dataDir @returns {string[]} */
export function listBadgeFiles(dataDir) {
  const dir = path.join(dataDir, "users");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".badges.json"))
    .map((name) => path.join(dir, name))
    .sort();
}

/** @param {string} dataDir @returns {{ rewritten: number }} */
export function upgradeDataDir(dataDir) {
  if (!dataDir) throw new Error("PROSEDEN_DATA is required");
  const metaPath = path.join(dataDir, "meta.json");
  if (!fs.existsSync(metaPath)) throw new Error(`meta.json missing: ${metaPath}`);

  let rewritten = 0;
  for (const file of listBadgeFiles(dataDir)) {
    const before = fs.readFileSync(file, "utf8");
    let raw;
    try {
      raw = JSON.parse(before);
    } catch {
      continue;
    }
    if (!badgeListNeedsConvert(raw)) continue;
    fs.writeFileSync(file, `${JSON.stringify(convertBadgeList(raw), null, 2)}\n`);
    rewritten += 1;
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.schemaVersion = 4;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  return { rewritten };
}

function isDirectRun() {
  const self = fs.realpathSync(fileURLToPath(import.meta.url));
  const invoked = process.argv[1] && fs.realpathSync(process.argv[1]);
  return invoked === self;
}

function main() {
  const dataDir = process.env.PROSEDEN_DATA;
  if (!dataDir) {
    console.error("004-badge-objects: PROSEDEN_DATA is required");
    process.exit(1);
  }
  const { rewritten } = upgradeDataDir(dataDir);
  console.log(`004-badge-objects: rewrote ${rewritten} file(s)`);
}

if (isDirectRun()) main();
