#!/usr/bin/env node
/**
 * Rewrite personal quest write namespaces from `<username>.*` to `user.<username>.*`.
 *
 * - `data/quests/users/<username>.json` name + namespaced string ids
 * - that user's flags / vars / badge ids
 * - FlagRef strings on scenes, artefacts, and exits (for known questor usernames)
 *
 * Fails if a manager quest file `quests/user.json` exists (`user` is reserved).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @param {string} username */
export function userQuestNamespace(username) {
  return `user.${username}`;
}

/**
 * Remap legacy personal prefix `username.` → `user.username.` without double-prefixing.
 * Only rewrites at the start of an id token (string start, after `:;,\s`, or after `not.`).
 * @param {string} text
 * @param {string} username
 */
export function remapPersonalPrefix(text, username) {
  if (typeof text !== "string" || !text || !username) return text;
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[:;,\\s]|not\\.)${escaped}\\.`, "g");
  return text.replace(re, (_m, lead) => `${lead}user.${username}.`);
}

/**
 * Deep-rewrite string leaves that contain the legacy personal prefix.
 * @param {unknown} value
 * @param {string} username
 * @returns {unknown}
 */
export function remapValue(value, username) {
  if (typeof value === "string") return remapPersonalPrefix(value, username);
  if (Array.isArray(value)) return value.map((v) => remapValue(v, username));
  if (!value || typeof value !== "object") return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const nextKey = remapPersonalPrefix(k, username);
    out[nextKey] = remapValue(v, username);
  }
  return out;
}

/**
 * @param {unknown} quest
 * @param {string} username
 * @returns {{ quest: unknown, changed: boolean }}
 */
export function rewriteUserQuestFile(quest, username) {
  if (!quest || typeof quest !== "object" || Array.isArray(quest)) {
    return { quest, changed: false };
  }
  const expected = userQuestNamespace(username);
  const o = /** @type {Record<string, unknown>} */ (quest);
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (name === expected) {
    const remapped = remapValue(o, username);
    const changed = JSON.stringify(remapped) !== JSON.stringify(o);
    return { quest: remapped, changed };
  }
  if (name !== username) {
    return { quest, changed: false };
  }
  const next = {
    .../** @type {Record<string, unknown>} */ (remapValue(o, username)),
    name: expected,
  };
  return { quest: next, changed: true };
}

/**
 * @param {unknown} raw
 * @param {string} username
 * @returns {{ value: unknown, changed: boolean }}
 */
export function rewriteKeyedRecord(raw, username) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: raw, changed: false };
  }
  const next = remapValue(raw, username);
  return { value: next, changed: JSON.stringify(next) !== JSON.stringify(raw) };
}

/**
 * @param {unknown} raw
 * @param {string} username
 * @returns {{ value: unknown, changed: boolean }}
 */
export function rewriteBadgeList(raw, username) {
  if (!Array.isArray(raw)) return { value: raw, changed: false };
  const next = raw.map((entry) => {
    if (typeof entry === "string") return remapPersonalPrefix(entry, username);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const o = /** @type {Record<string, unknown>} */ (entry);
    if (typeof o.badge !== "string") return entry;
    const badge = remapPersonalPrefix(o.badge, username);
    return badge === o.badge ? entry : { ...o, badge };
  });
  return { value: next, changed: JSON.stringify(next) !== JSON.stringify(raw) };
}

/** @param {string} dataDir @returns {string[]} */
export function listUserQuestUsernames(dataDir) {
  const dir = path.join(dataDir, "quests", "users");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

/**
 * @param {string} filePath
 * @param {(raw: unknown) => { value: unknown, changed: boolean }} rewrite
 * @returns {boolean}
 */
function rewriteJsonFile(filePath, rewrite) {
  if (!fs.existsSync(filePath)) return false;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return false;
  }
  const { value, changed } = rewrite(raw);
  if (!changed) return false;
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
  return true;
}

/**
 * Remap FlagRef fields on a scene / exit / artefact record.
 * @param {unknown} raw
 * @param {string[]} usernames
 * @returns {{ value: unknown, changed: boolean }}
 */
export function rewriteFlagRefFields(raw, usernames) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: raw, changed: false };
  }
  const o = /** @type {Record<string, unknown>} */ (raw);
  /** @type {Record<string, unknown>} */
  const next = { ...o };
  let changed = false;

  /** @param {string} field */
  function remapField(field) {
    if (typeof next[field] !== "string") return;
    let s = /** @type {string} */ (next[field]);
    for (const username of usernames) s = remapPersonalPrefix(s, username);
    if (s !== next[field]) {
      next[field] = s;
      changed = true;
    }
  }

  remapField("when");

  if (next.detailWhen && typeof next.detailWhen === "object" && !Array.isArray(next.detailWhen)) {
    /** @type {Record<string, unknown>} */
    const details = {};
    for (const [k, v] of Object.entries(
      /** @type {Record<string, unknown>} */ (next.detailWhen),
    )) {
      if (typeof v === "string") {
        let s = v;
        for (const username of usernames) s = remapPersonalPrefix(s, username);
        details[k] = s;
        if (s !== v) changed = true;
      } else {
        details[k] = v;
      }
    }
    next.detailWhen = details;
  }

  // Exit files are arrays of exit records.
  return { value: next, changed };
}

/**
 * @param {unknown} raw
 * @param {string[]} usernames
 */
function rewriteExitList(raw, usernames) {
  if (!Array.isArray(raw)) return rewriteFlagRefFields(raw, usernames);
  let changed = false;
  const value = raw.map((entry) => {
    const { value: next, changed: c } = rewriteFlagRefFields(entry, usernames);
    if (c) changed = true;
    return next;
  });
  return { value, changed };
}

/**
 * @param {string} dataDir
 * @param {string[]} usernames
 * @returns {number}
 */
function rewriteWorldFlagRefs(dataDir, usernames) {
  if (!usernames.length) return 0;
  let rewritten = 0;

  const scenesDir = path.join(dataDir, "scenes");
  if (fs.existsSync(scenesDir)) {
    for (const name of fs.readdirSync(scenesDir).sort()) {
      if (name.endsWith(".exits.json")) {
        const file = path.join(scenesDir, name);
        if (rewriteJsonFile(file, (raw) => rewriteExitList(raw, usernames))) rewritten += 1;
        continue;
      }
      if (!/^\d+\.json$/.test(name)) continue;
      const file = path.join(scenesDir, name);
      if (rewriteJsonFile(file, (raw) => rewriteFlagRefFields(raw, usernames))) rewritten += 1;
    }
  }

  const artefactsDir = path.join(dataDir, "artefacts");
  if (fs.existsSync(artefactsDir)) {
    for (const name of fs.readdirSync(artefactsDir).sort()) {
      if (!/^\d+\.json$/.test(name)) continue;
      const file = path.join(artefactsDir, name);
      if (rewriteJsonFile(file, (raw) => rewriteFlagRefFields(raw, usernames))) rewritten += 1;
    }
  }

  return rewritten;
}

/** @param {string} dataDir @returns {{ rewritten: number }} */
export function upgradeDataDir(dataDir) {
  if (!dataDir) throw new Error("PROSEDEN_DATA is required");
  const metaPath = path.join(dataDir, "meta.json");
  if (!fs.existsSync(metaPath)) throw new Error(`meta.json missing: ${metaPath}`);

  const reserved = path.join(dataDir, "quests", "user.json");
  if (fs.existsSync(reserved)) {
    throw new Error(
      "manager quest quests/user.json exists; rename or delete it — \"user\" is reserved for personal namespaces",
    );
  }

  let rewritten = 0;
  const usernames = listUserQuestUsernames(dataDir);

  for (const username of usernames) {
    const questPath = path.join(dataDir, "quests", "users", `${username}.json`);
    if (
      rewriteJsonFile(questPath, (raw) => {
        const { quest, changed } = rewriteUserQuestFile(raw, username);
        return { value: quest, changed };
      })
    ) {
      rewritten += 1;
    }

    const flagsPath = path.join(dataDir, "users", `${username}.flags.json`);
    if (rewriteJsonFile(flagsPath, (raw) => rewriteKeyedRecord(raw, username))) {
      rewritten += 1;
    }

    const varsPath = path.join(dataDir, "users", `${username}.vars.json`);
    if (rewriteJsonFile(varsPath, (raw) => rewriteKeyedRecord(raw, username))) {
      rewritten += 1;
    }

    const badgesPath = path.join(dataDir, "users", `${username}.badges.json`);
    if (rewriteJsonFile(badgesPath, (raw) => rewriteBadgeList(raw, username))) {
      rewritten += 1;
    }
  }

  rewritten += rewriteWorldFlagRefs(dataDir, usernames);

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.schemaVersion = 5;
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
    console.error("005-user-quest-namespace: PROSEDEN_DATA is required");
    process.exit(1);
  }
  try {
    const { rewritten } = upgradeDataDir(dataDir);
    console.log(`005-user-quest-namespace: rewrote ${rewritten} file(s)`);
  } catch (err) {
    console.error(`005-user-quest-namespace: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

if (isDirectRun()) main();
