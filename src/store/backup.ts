import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SESSION_HANDOFF_FILE } from "../auth/sessions.js";

export const BACKUP_NAME_RE = /^\d{4}-\d{2}-\d{2}T\d{6}Z\.tar\.gz$/;

export interface BackupInfo {
  name: string;
  size: number;
  mtime: string;
}

export function defaultBackupDir(dataDir: string): string {
  return join(dirname(dataDir), "backup");
}

export function isBackupName(name: string): boolean {
  return BACKUP_NAME_RE.test(name);
}

export function utcBackupName(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}${mm}${ss}Z.tar.gz`;
}

export function backupPath(backupDir: string, name: string): string | undefined {
  if (!isBackupName(name)) return undefined;
  return join(backupDir, name);
}

export async function listBackups(backupDir: string): Promise<BackupInfo[]> {
  let names: string[];
  try {
    names = await readdir(backupDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  const out: BackupInfo[] = [];
  for (const name of names) {
    if (!isBackupName(name)) continue;
    const path = join(backupDir, name);
    const st = await stat(path);
    if (!st.isFile()) continue;
    out.push({ name, size: st.size, mtime: st.mtime.toISOString() });
  }
  out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return out;
}

export async function createDataBackup(dataDir: string, backupDir: string): Promise<BackupInfo> {
  await mkdir(backupDir, { recursive: true });
  let name = utcBackupName();
  let dest = join(backupDir, name);
  try {
    await stat(dest);
    name = utcBackupName(new Date(Date.now() + 1000));
    dest = join(backupDir, name);
  } catch {
    // dest does not exist yet
  }

  const partial = `${dest}.partial`;
  try {
    await runTar(partial, dataDir);
    await rename(partial, dest);
  } catch (err) {
    await rm(partial, { force: true });
    throw err;
  }

  const st = await stat(dest);
  return { name, size: st.size, mtime: st.mtime.toISOString() };
}

export async function deleteBackup(backupDir: string, name: string): Promise<boolean> {
  const path = backupPath(backupDir, name);
  if (!path) return false;
  try {
    await rm(path);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw err;
  }
}

export interface RestoreResult {
  restored: string;
  safetyBackup: string;
}

/** Replace all files under `dataDir` from a timestamped archive in `backupDir`. */
export async function restoreDataBackup(
  dataDir: string,
  backupDir: string,
  name: string,
): Promise<RestoreResult> {
  const archive = backupPath(backupDir, name);
  if (!archive) throw new Error("Invalid backup name");

  try {
    const st = await stat(archive);
    if (!st.isFile()) throw new Error("Backup not found");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new Error("Backup not found");
    throw err;
  }

  const probeDir = await mkdtemp(join(tmpdir(), "proseden-restore-probe-"));
  try {
    await extractTar(archive, probeDir);
    await stat(join(probeDir, "meta.json"));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error("Archive is not a valid data backup (missing meta.json)");
    }
    throw err;
  } finally {
    await rm(probeDir, { recursive: true, force: true });
  }

  const safetyBackup = await createDataBackup(dataDir, backupDir);
  await clearDataDir(dataDir);
  await extractTar(archive, dataDir);

  return { restored: name, safetyBackup: safetyBackup.name };
}

async function clearDataDir(dataDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      await mkdir(dataDir, { recursive: true });
      return;
    }
    throw err;
  }
  await Promise.all(entries.map((entry) => rm(join(dataDir, entry), { recursive: true, force: true })));
}

function runTar(archive: string, dataDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "tar",
      ["-czf", archive, `--exclude=${SESSION_HANDOFF_FILE}`, "-C", dataDir, "."],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited ${code}`));
    });
  });
}

function extractTar(archive: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-xzf", archive, "-C", destDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited ${code}`));
    });
  });
}
