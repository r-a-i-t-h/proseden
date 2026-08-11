#!/usr/bin/env node
/**
 * Rewrite curated link prefixes in scene/artefact prose (and history snapshots).
 *
 *   pedia:  → wikipedia:
 *   srch:   → search:
 *   media:  → search:   (Commons expander is gone)
 *
 * Only touches [label](dest) destinations. Code spans stay literal.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEME_MAP = {
  pedia: "wikipedia",
  srch: "search",
  media: "search",
};

/**
 * Rewrite legacy curated schemes in one prose string.
 * @param {string} text
 * @returns {string}
 */
export function rewriteLegacyLinkSchemes(text) {
  const slots = [];
  const park = (raw) => {
    slots.push(raw);
    return `\0${slots.length - 1}\0`;
  };

  let s = text.replace(/`([^`\n]+)`/g, (m) => park(m));
  s = rewriteLinks(s, (label, dest) => `[${label}](${rewriteDest(dest)})`);
  return s.replace(/\0(\d+)\0/g, (_m, idx) => slots[Number(idx)]);
}

function rewriteDest(dest) {
  const lead = dest.match(/^\s*/)[0];
  const trail = dest.match(/\s*$/)[0];
  const inner = dest.slice(lead.length, dest.length - trail.length);
  const match = inner.match(/^(pedia|media|srch):([\s\S]*)$/i);
  if (!match) return dest;
  const next = SCHEME_MAP[match[1].toLowerCase()];
  return `${lead}${next}:${match[2]}${trail}`;
}

/** Walk [label](dest) spans; dest may contain balanced parentheses. */
function rewriteLinks(text, replace) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("[", i);
    if (open === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, open);
    const closeLabel = text.indexOf("]", open + 1);
    const newline = text.indexOf("\n", open);
    if (
      closeLabel === -1 ||
      text[closeLabel + 1] !== "(" ||
      (newline !== -1 && newline < closeLabel)
    ) {
      out += "[";
      i = open + 1;
      continue;
    }
    let depth = 1;
    let j = closeLabel + 2;
    while (j < text.length && depth > 0) {
      const ch = text[j];
      if (ch === "\n") break;
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      j += 1;
    }
    if (depth !== 0) {
      out += "[";
      i = open + 1;
      continue;
    }
    const label = text.slice(open + 1, closeLabel);
    const dest = text.slice(closeLabel + 2, j - 1);
    out += replace(label, dest);
    i = j;
  }
  return out;
}

/** @param {string} dataDir @returns {string[]} */
export function listProseFiles(dataDir) {
  const files = [];
  for (const kind of ["scenes", "artefacts"]) {
    const dir = path.join(dataDir, kind);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isFile() && name.endsWith(".md")) {
        files.push(full);
        continue;
      }
      if (stat.isDirectory() && name.endsWith(".versions")) {
        for (const snap of fs.readdirSync(full)) {
          if (snap.endsWith(".md")) files.push(path.join(full, snap));
        }
      }
    }
  }
  return files.sort();
}

/** @param {string} dataDir @returns {{ rewritten: number }} */
export function upgradeDataDir(dataDir) {
  if (!dataDir) throw new Error("PROSEDEN_DATA is required");
  const metaPath = path.join(dataDir, "meta.json");
  if (!fs.existsSync(metaPath)) throw new Error(`meta.json missing: ${metaPath}`);

  let rewritten = 0;
  for (const file of listProseFiles(dataDir)) {
    const before = fs.readFileSync(file, "utf8");
    const after = rewriteLegacyLinkSchemes(before);
    if (after !== before) {
      fs.writeFileSync(file, after);
      rewritten += 1;
    }
  }

  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.schemaVersion = 2;
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
    console.error("002-rewrite-link-schemes: PROSEDEN_DATA is required");
    process.exit(1);
  }
  const { rewritten } = upgradeDataDir(dataDir);
  console.log(`002-rewrite-link-schemes: rewrote ${rewritten} file(s)`);
}

if (isDirectRun()) main();
