import { createHash, randomBytes } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import type { SessionRecord } from "../model/types.js";
import { writeJsonAtomic } from "../store/fs.js";

/** Ephemeral SIGTERM handoff; loaded once on boot then deleted. Not a session database. */
export const SESSION_HANDOFF_FILE = ".sessions.json";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

interface FallbackRecord {
  tokenHash: string;
  username: string;
  createdAt: string;
  expiresAt: string;
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isExpired(expiresAt: string): boolean {
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t <= Date.now();
}

function parseFallbackRow(row: unknown): FallbackRecord | undefined {
  if (!row || typeof row !== "object") return undefined;
  const rec = row as Record<string, unknown>;
  if (
    typeof rec.tokenHash !== "string" ||
    typeof rec.username !== "string" ||
    typeof rec.createdAt !== "string" ||
    typeof rec.expiresAt !== "string"
  ) {
    return undefined;
  }
  if (!rec.tokenHash || !rec.username) return undefined;
  if (isExpired(rec.expiresAt)) return undefined;
  return {
    tokenHash: rec.tokenHash,
    username: rec.username,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
  };
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();
  private fallback = new Map<string, FallbackRecord>();
  /** One-shot HTML flash after Use/Input; not persisted in handoff. */
  private actionMessages = new Map<string, string>();

  constructor(private file?: string) {}

  static async load(file: string): Promise<SessionStore> {
    const store = new SessionStore(file);
    await store.loadFromDisk();
    return store;
  }

  create(username: string, ttlMs = DEFAULT_TTL_MS): SessionRecord {
    const token = randomBytes(32).toString("hex");
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const session: SessionRecord = { token, username, createdAt, expiresAt };
    this.sessions.set(token, session);
    return session;
  }

  get(token: string | undefined | null): SessionRecord | undefined {
    if (!token) return undefined;
    const live = this.sessions.get(token);
    if (live) {
      if (isExpired(live.expiresAt)) {
        this.sessions.delete(token);
        this.actionMessages.delete(token);
        return undefined;
      }
      return live;
    }

    const hash = hashSessionToken(token);
    const row = this.fallback.get(hash);
    if (!row) return undefined;
    this.fallback.delete(hash);
    if (isExpired(row.expiresAt)) return undefined;

    const session: SessionRecord = {
      token,
      username: row.username,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };
    this.sessions.set(token, session);
    return session;
  }

  /** Store a one-shot Use/Input result for the next HTML GET. */
  setActionMessage(token: string | undefined | null, message: string): void {
    if (!token) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    this.actionMessages.set(token, trimmed);
  }

  /** Consume and clear the pending Use/Input result, if any. */
  takeActionMessage(token: string | undefined | null): string | undefined {
    if (!token) return undefined;
    const message = this.actionMessages.get(token);
    if (message === undefined) return undefined;
    this.actionMessages.delete(token);
    return message;
  }

  destroy(token: string | undefined | null): void {
    if (!token) return;
    this.sessions.delete(token);
    this.actionMessages.delete(token);
    this.fallback.delete(hashSessionToken(token));
  }

  destroyAllForUser(username: string, exceptToken?: string): void {
    for (const [token, session] of this.sessions) {
      if (session.username === username && token !== exceptToken) {
        this.sessions.delete(token);
        this.actionMessages.delete(token);
      }
    }
    const exceptHash = exceptToken ? hashSessionToken(exceptToken) : undefined;
    for (const [hash, row] of this.fallback) {
      if (row.username === username && hash !== exceptHash) {
        this.fallback.delete(hash);
      }
    }
  }

  /** Write hashes of the live token map. Does not include leftover fallback rows. */
  async dump(): Promise<void> {
    if (!this.file) return;
    const sessions: FallbackRecord[] = [];
    for (const session of this.sessions.values()) {
      if (isExpired(session.expiresAt)) continue;
      sessions.push({
        tokenHash: hashSessionToken(session.token),
        username: session.username,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      });
    }
    await writeJsonAtomic(this.file, { sessions }, { mode: 0o600 });
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.file) return;
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return;
      throw err;
    }

    try {
      const parsed = JSON.parse(raw) as { sessions?: unknown };
      const rows = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      for (const row of rows) {
        const rec = parseFallbackRow(row);
        if (rec) this.fallback.set(rec.tokenHash, rec);
      }
    } catch {
      // Malformed handoff: treat as empty, still unlink so it cannot loop.
    }

    await unlink(this.file).catch(() => undefined);
  }
}
