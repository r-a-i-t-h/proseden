import { randomBytes } from "node:crypto";
import type { LiveEvent, PresenceConnection, PresencePerson } from "./types.js";
import { PRESENCE_IDLE_MS, PRESENCE_RECONNECT_GRACE_MS } from "./types.js";

export type PresenceListener = (event: LiveEvent) => void;

interface PendingLeave {
  person: PresencePerson;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * In-memory live presence. Coalesce who's-here / online by userKey.
 * Leave is emitted only when the last connection for a userKey drops —
 * and then only after a reconnect grace so navigations and brief socket
 * drops do not flicker leave/arrive.
 */
export class PresenceStore {
  private connections = new Map<string, PresenceConnection>();
  private pendingLeaves = new Map<string, PendingLeave>();
  private listeners = new Set<PresenceListener>();
  private idleTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    this.idleTimer = setInterval(() => this.sweepIdle(), 30_000);
    this.idleTimer.unref?.();
  }

  onEvent(listener: PresenceListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(opts: {
    userKey: string;
    displayName: string;
    sceneId: number;
    send?: (event: LiveEvent) => void;
  }): PresenceConnection {
    const now = new Date().toISOString();
    const connectionId = randomBytes(16).toString("hex");
    const pending = this.takePendingLeave(opts.userKey);
    const prior = this.primaryForUser(opts.userKey);
    const priorSceneId = prior?.sceneId ?? pending?.person.sceneId;
    const conn: PresenceConnection = {
      connectionId,
      userKey: opts.userKey,
      displayName: opts.displayName,
      sceneId: opts.sceneId,
      connectedAt: now,
      lastSeenAt: now,
      send: opts.send,
    };
    this.connections.set(connectionId, conn);

    if (!prior && !pending) {
      this.emit({
        kind: "presence.join",
        ts: now,
        sceneId: opts.sceneId,
        person: this.toPerson(conn),
      });
    } else if (priorSceneId !== undefined && priorSceneId !== opts.sceneId) {
      for (const c of this.connections.values()) {
        if (c.userKey === opts.userKey) {
          c.sceneId = opts.sceneId;
          c.lastSeenAt = now;
          c.displayName = opts.displayName;
        }
      }
      this.emitMove(opts.userKey, opts.displayName, priorSceneId, opts.sceneId);
    }
    // Same-scene reconnect (including within grace): silent — still present.

    return conn;
  }

  setSend(connectionId: string, send: (event: LiveEvent) => void): void {
    const conn = this.connections.get(connectionId);
    if (conn) conn.send = send;
  }

  setAbort(connectionId: string, abort: () => void): void {
    const conn = this.connections.get(connectionId);
    if (conn) conn.abort = abort;
  }

  heartbeat(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.lastSeenAt = new Date().toISOString();
  }

  /** Client proof-of-life (ping / chat). Server SSE pings must not call this. */
  heartbeatUser(userKey: string): boolean {
    const now = new Date().toISOString();
    let found = false;
    for (const conn of this.connections.values()) {
      if (conn.userKey !== userKey) continue;
      conn.lastSeenAt = now;
      found = true;
    }
    return found;
  }

  /**
   * Update scene for one connection; if coalesced userKey scene changes, emit move.
   */
  setScene(connectionId: string, sceneId: number): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    const fromSceneId = this.coalescedScene(conn.userKey) ?? conn.sceneId;
    conn.sceneId = sceneId;
    conn.lastSeenAt = new Date().toISOString();
    const toSceneId = this.coalescedScene(conn.userKey) ?? sceneId;
    if (fromSceneId !== toSceneId) {
      this.emitMove(conn.userKey, conn.displayName, fromSceneId, toSceneId);
    }
  }

  /** Move all connections for a userKey (e.g. after navigation on one tab). */
  moveUser(userKey: string, toSceneId: number): void {
    const fromSceneId = this.coalescedScene(userKey);
    if (fromSceneId === undefined) return;
    const now = new Date().toISOString();
    let displayName = userKey;
    for (const conn of this.connections.values()) {
      if (conn.userKey !== userKey) continue;
      displayName = conn.displayName;
      conn.sceneId = toSceneId;
      conn.lastSeenAt = now;
    }
    if (fromSceneId !== toSceneId) {
      this.emitMove(userKey, displayName, fromSceneId, toSceneId);
    }
  }

  disconnect(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    this.connections.delete(connectionId);
    const remaining = this.connectionsForUser(conn.userKey);
    if (remaining.length === 0) {
      this.scheduleLeave(this.toPerson(conn));
    }
    this.runAbort(conn);
  }

  /**
   * Drop every connection for a userKey and emit leave immediately (no reconnect grace).
   * Used for login guest handoff, logout, and moderator kick.
   */
  kick(userKey: string, opts?: { reason?: "logout" }): boolean {
    const pending = this.takePendingLeave(userKey);
    const conns = this.connectionsForUser(userKey);
    const person = conns[0] ? this.toPerson(conns[0]) : pending?.person;
    for (const conn of conns) {
      this.connections.delete(conn.connectionId);
    }
    if (!person) return false;
    this.emit({
      kind: "presence.leave",
      ts: new Date().toISOString(),
      sceneId: person.sceneId,
      person,
      ...(opts?.reason ? { leaveReason: opts.reason } : {}),
    });
    for (const conn of conns) this.runAbort(conn);
    return true;
  }

  /** Drop connections whose last *client* heartbeat is older than PRESENCE_IDLE_MS. */
  sweepIdle(): void {
    const cutoff = Date.now() - PRESENCE_IDLE_MS;
    for (const conn of [...this.connections.values()]) {
      if (Date.parse(conn.lastSeenAt) < cutoff) {
        this.disconnect(conn.connectionId);
      }
    }
  }

  here(sceneId: number): PresencePerson[] {
    const byKey = new Map<string, PresencePerson>();
    for (const conn of this.connections.values()) {
      if (conn.sceneId !== sceneId) continue;
      const existing = byKey.get(conn.userKey);
      if (!existing || conn.lastSeenAt > existing.lastSeenAt) {
        byKey.set(conn.userKey, this.toPerson(conn));
      }
    }
    for (const pending of this.pendingLeaves.values()) {
      if (pending.person.sceneId !== sceneId) continue;
      if (!byKey.has(pending.person.userKey)) {
        byKey.set(pending.person.userKey, pending.person);
      }
    }
    return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  online(): PresencePerson[] {
    const byKey = new Map<string, PresencePerson>();
    for (const conn of this.connections.values()) {
      const existing = byKey.get(conn.userKey);
      if (!existing || conn.lastSeenAt > existing.lastSeenAt) {
        byKey.set(conn.userKey, this.toPerson(conn));
      }
    }
    for (const pending of this.pendingLeaves.values()) {
      if (!byKey.has(pending.person.userKey)) {
        byKey.set(pending.person.userKey, pending.person);
      }
    }
    return [...byKey.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  findByUserKey(userKey: string): PresencePerson | undefined {
    return this.online().find((p) => p.userKey === userKey);
  }

  getConnection(connectionId: string): PresenceConnection | undefined {
    return this.connections.get(connectionId);
  }

  /** Fanout to connections subscribed to a scene (or all if sceneId omitted for shouts). */
  fanout(event: LiveEvent, opts?: { sceneId?: number; all?: boolean }): void {
    for (const conn of this.connections.values()) {
      if (!conn.send) continue;
      if (opts?.all) {
        conn.send(event);
        continue;
      }
      if (opts?.sceneId !== undefined && conn.sceneId === opts.sceneId) {
        conn.send(event);
      }
    }
  }

  destroy(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    for (const pending of this.pendingLeaves.values()) clearTimeout(pending.timer);
    this.pendingLeaves.clear();
    this.connections.clear();
    this.listeners.clear();
  }

  private scheduleLeave(person: PresencePerson): void {
    const existing = this.pendingLeaves.get(person.userKey);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const pending = this.pendingLeaves.get(person.userKey);
      if (!pending) return;
      this.pendingLeaves.delete(person.userKey);
      this.emit({
        kind: "presence.leave",
        ts: new Date().toISOString(),
        sceneId: pending.person.sceneId,
        person: pending.person,
      });
    }, PRESENCE_RECONNECT_GRACE_MS);
    timer.unref?.();
    this.pendingLeaves.set(person.userKey, { person, timer });
  }

  private takePendingLeave(userKey: string): PendingLeave | undefined {
    const pending = this.pendingLeaves.get(userKey);
    if (!pending) return undefined;
    clearTimeout(pending.timer);
    this.pendingLeaves.delete(userKey);
    return pending;
  }

  private connectionsForUser(userKey: string): PresenceConnection[] {
    return [...this.connections.values()].filter((c) => c.userKey === userKey);
  }

  private primaryForUser(userKey: string): PresenceConnection | undefined {
    const list = this.connectionsForUser(userKey);
    if (!list.length) return undefined;
    return list.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
  }

  private coalescedScene(userKey: string): number | undefined {
    return this.primaryForUser(userKey)?.sceneId ?? this.pendingLeaves.get(userKey)?.person.sceneId;
  }

  private toPerson(conn: PresenceConnection): PresencePerson {
    return {
      userKey: conn.userKey,
      displayName: conn.displayName,
      sceneId: conn.sceneId,
      lastSeenAt: conn.lastSeenAt,
    };
  }

  private emitMove(
    userKey: string,
    displayName: string,
    fromSceneId: number,
    toSceneId: number,
  ): void {
    const ts = new Date().toISOString();
    this.emit({
      kind: "presence.move",
      ts,
      person: { userKey, displayName, sceneId: toSceneId, lastSeenAt: ts },
      fromSceneId,
      toSceneId,
    });
  }

  private runAbort(conn: PresenceConnection): void {
    const abort = conn.abort;
    conn.abort = undefined;
    abort?.();
  }

  private emit(event: LiveEvent): void {
    for (const listener of this.listeners) listener(event);
    if (event.kind === "presence.join" && event.sceneId !== undefined) {
      this.fanout(event, { sceneId: event.sceneId });
    } else if (event.kind === "presence.leave" && event.sceneId !== undefined) {
      this.fanout(event, { sceneId: event.sceneId });
    } else if (event.kind === "presence.move") {
      if (event.fromSceneId !== undefined) this.fanout(event, { sceneId: event.fromSceneId });
      if (event.toSceneId !== undefined) this.fanout(event, { sceneId: event.toSceneId });
    }
  }

}
