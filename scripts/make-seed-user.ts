import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../src/auth/password.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const username = process.argv[2] ?? "gardener";
const password = process.argv[3] ?? "garden";

const { hash, salt } = await hashPassword(password);
const user = {
  username,
  passwordHash: hash,
  passwordSalt: salt,
  createdAt: "2026-08-10T20:00:00.000Z",
  inventory: [],
};

const dir = join(root, "seed", "users");
await mkdir(dir, { recursive: true });
const path = join(dir, `${username}.json`);
await writeFile(path, `${JSON.stringify(user, null, 2)}\n`, "utf8");
console.log(`Wrote ${path} (password: ${password})`);
