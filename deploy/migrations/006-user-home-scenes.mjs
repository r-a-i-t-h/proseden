#!/usr/bin/env node
/**
 * Create a permanent home scene for every user (`homeSceneId` on user JSON).
 * Always allocates a new scene when homeSceneId is absent; skips users already migrated.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Keep in sync with src/user-home.ts */
export function userHomeSceneTitle(username) {
  return `${username} home`;
}

/** Keep in sync with src/user-home.ts */
export function userHomeSceneBody() {
  return `This is your home scene — a private place for artefacts ejected from other scenes or orphaned when a scene is deleted.

Keep it private and do not link it into the world with exits unless you are sure. You cannot change which scene is your home; this one was assigned when you registered. If you make it too open, you cannot swap to a fresh private home.

You may edit this scene and its contents freely. It cannot be deleted.`;
}

/** @param {string} dataDir */
export function listUserAccountFiles(dataDir) {
  const dir = path.join(dataDir, "users");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name.endsWith(".json") &&
        !name.endsWith(".flags.json") &&
        !name.endsWith(".vars.json") &&
        !name.endsWith(".badges.json"),
    )
    .map((name) => path.join(dir, name))
    .sort();
}

/**
 * @param {object} opts
 * @param {number} opts.id
 * @param {string} opts.owner
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} opts.createdAt
 */
export function serializeSceneMarkdown({ id, owner, title, body, createdAt }) {
  const yamlTitle = JSON.stringify(title);
  return `---
id: ${id}
owner: ${owner}
visibility: private
title: ${yamlTitle}
createdAt: ${createdAt}
modifiedAt: []
---

${body}
`;
}

/**
 * @param {string} dataDir
 * @returns {{ created: number, skipped: number }}
 */
export function upgradeDataDir(dataDir) {
  const metaPath = path.join(dataDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    throw new Error("meta.json missing");
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  let nextSceneId = Number(meta.nextSceneId);
  if (!Number.isFinite(nextSceneId) || nextSceneId < 1) nextSceneId = 1;

  const scenesDir = path.join(dataDir, "scenes");
  fs.mkdirSync(scenesDir, { recursive: true });

  let created = 0;
  let skipped = 0;

  for (const userPath of listUserAccountFiles(dataDir)) {
    const raw = JSON.parse(fs.readFileSync(userPath, "utf8"));
    const username = String(raw.username ?? path.basename(userPath, ".json"));
    const existingHome = Number(raw.homeSceneId);
    if (Number.isFinite(existingHome) && existingHome > 0) {
      const scenePath = path.join(scenesDir, `${existingHome}.md`);
      if (fs.existsSync(scenePath)) {
        skipped += 1;
        continue;
      }
    }

    const id = nextSceneId++;
    const createdAt = new Date().toISOString();
    const title = userHomeSceneTitle(username);
    const body = userHomeSceneBody();
    const sceneMd = serializeSceneMarkdown({ id, owner: username, title, body, createdAt });
    fs.writeFileSync(path.join(scenesDir, `${id}.md`), sceneMd);
    fs.writeFileSync(path.join(scenesDir, `${id}.exits.json`), "[]\n");
    fs.writeFileSync(
      userPath,
      `${JSON.stringify({ ...raw, username, homeSceneId: id }, null, 2)}\n`,
    );
    created += 1;
  }

  meta.nextSceneId = nextSceneId;
  meta.schemaVersion = 6;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  return { created, skipped };
}

function isDirectRun() {
  const self = fs.realpathSync(fileURLToPath(import.meta.url));
  const invoked = process.argv[1] && fs.realpathSync(process.argv[1]);
  return invoked === self;
}

function main() {
  const dataDir = process.env.PROSEDEN_DATA;
  if (!dataDir) {
    console.error("006-user-home-scenes: PROSEDEN_DATA is required");
    process.exit(1);
  }
  try {
    const { created, skipped } = upgradeDataDir(dataDir);
    console.log(`006-user-home-scenes: created ${created} home scene(s), skipped ${skipped}`);
  } catch (err) {
    console.error(`006-user-home-scenes: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

if (isDirectRun()) main();
