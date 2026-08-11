import { serve } from "@hono/node-server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionStore } from "./auth/sessions.js";
import { createApp } from "./app.js";
import { WorldStore } from "./store/world.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dataDir = process.env.PROSEDEN_DATA ?? join(root, "data");
const seedDir = process.env.PROSEDEN_SEED ?? join(root, "seed");
const backupDir = process.env.PROSEDEN_BACKUP ?? join(dirname(dataDir), "backup");
const port = Number(process.env.PORT ?? 3336);
const assetBase = process.env.PROSEDEN_BASE_PATH ?? "";

const world = new WorldStore(dataDir);
await world.load(seedDir);

const sessions = new SessionStore();
const app = createApp({
  world,
  sessions,
  assetBase,
  staticRoot: join(root, "public"),
  backupDir,
});

const baseLabel = assetBase ? `/${assetBase.replace(/^\/+|\/+$/g, "")}` : "";
console.log(`Proseden listening on http://127.0.0.1:${port}${baseLabel}/`);
console.log(`Data directory: ${dataDir}`);
console.log(`Backup directory: ${backupDir}`);

serve({ fetch: app.fetch, port });
