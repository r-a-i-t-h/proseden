import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Serialize concurrent atomic writes to the same destination path. */
const writeQueues = new Map<string, Promise<void>>();

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

export async function writeTextAtomic(path: string, contents: string): Promise<void> {
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => writeTextAtomicUnqueued(path, contents));
  writeQueues.set(path, next);
  try {
    await next;
  } finally {
    if (writeQueues.get(path) === next) writeQueues.delete(path);
  }
}

async function writeTextAtomicUnqueued(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(tmp, contents, "utf8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Append a line (creates file if missing). Uses OS append for concurrent safety. */
export async function appendLineAtomic(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = line.endsWith("\n") ? line : `${line}\n`;
  await appendFile(path, payload, "utf8");
}
