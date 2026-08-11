import { randomBytes } from "node:crypto";
import type { SessionRecord } from "../model/types.js";

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();

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
    const session = this.sessions.get(token);
    if (!session) return undefined;
    if (Date.parse(session.expiresAt) <= Date.now()) {
      this.sessions.delete(token);
      return undefined;
    }
    return session;
  }

  destroy(token: string | undefined | null): void {
    if (token) this.sessions.delete(token);
  }

  destroyAllForUser(username: string, exceptToken?: string): void {
    for (const [token, session] of this.sessions) {
      if (session.username === username && token !== exceptToken) {
        this.sessions.delete(token);
      }
    }
  }
}
