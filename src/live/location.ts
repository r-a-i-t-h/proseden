import type { WorldStore } from "../store/world.js";

const DEBOUNCE_MS = 30_000;

/**
 * Debounced lastSceneId / lastSeenAt writes to users/*.json.
 * Disk persistence is best-effort: failures are logged, never thrown to callers.
 */
export class LocationTracker {
  private pending = new Map<string, { sceneId: number; timers: ReturnType<typeof setTimeout> }>();
  /** Coalesce overlapping saves per user (disconnect flush vs debounce timer). */
  private inflight = new Map<string, Promise<void>>();

  constructor(private world: WorldStore) {}

  noteVisit(username: string, sceneId: number): void {
    const user = this.world.getUser(username);
    if (!user) return;
    const now = new Date().toISOString();
    const updated = { ...user, lastSceneId: sceneId, lastSeenAt: now };
    // Immediate in-memory update via save is async — keep a sync patch on the map.
    void this.scheduleSave(username, sceneId, updated);
  }

  async flush(username: string): Promise<void> {
    const entry = this.pending.get(username);
    if (entry) {
      clearTimeout(entry.timers);
      this.pending.delete(username);
    }
    const user = this.world.getUser(username);
    if (!user?.lastSceneId && !entry) return;
    const sceneId = entry?.sceneId ?? user?.lastSceneId;
    if (sceneId === undefined || !user) return;
    Object.assign(user, {
      lastSceneId: sceneId,
      lastSeenAt: new Date().toISOString(),
    });
    this.world.users.set(username, user);
    await this.persist(username);
  }

  async flushAll(): Promise<void> {
    const names = [...this.pending.keys()];
    for (const name of names) await this.flush(name);
  }

  private async scheduleSave(
    username: string,
    sceneId: number,
    draft: { lastSceneId: number; lastSeenAt: string },
  ): Promise<void> {
    const user = this.world.getUser(username);
    if (!user) return;
    // Patch memory immediately so login resume sees fresh values even before disk write.
    Object.assign(user, draft);
    this.world.users.set(username, user);

    const existing = this.pending.get(username);
    if (existing) clearTimeout(existing.timers);
    const timers = setTimeout(() => {
      this.pending.delete(username);
      void this.persist(username);
    }, DEBOUNCE_MS);
    timers.unref?.();
    this.pending.set(username, { sceneId, timers });
  }

  private async persist(username: string): Promise<void> {
    const previous = this.inflight.get(username) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const latest = this.world.getUser(username);
      if (!latest) return;
      await this.world.saveUser(latest);
    });
    this.inflight.set(username, next);
    try {
      await next;
    } catch (err) {
      console.error(`[location] failed to save ${username}:`, err);
    } finally {
      if (this.inflight.get(username) === next) this.inflight.delete(username);
    }
  }
}
