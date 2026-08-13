import type { WorldStore } from "../store/world.js";

const DEBOUNCE_MS = 30_000;

/**
 * Debounced lastSceneId / lastSeenAt writes to users/*.json.
 */
export class LocationTracker {
  private pending = new Map<string, { sceneId: number; timers: ReturnType<typeof setTimeout> }>();

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
    await this.world.saveUser({
      ...user,
      lastSceneId: sceneId,
      lastSeenAt: new Date().toISOString(),
    });
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
      const latest = this.world.getUser(username);
      if (!latest) return;
      void this.world.saveUser({
        ...latest,
        lastSceneId: sceneId,
        lastSeenAt: new Date().toISOString(),
      });
    }, DEBOUNCE_MS);
    timers.unref?.();
    this.pending.set(username, { sceneId, timers });
  }
}
