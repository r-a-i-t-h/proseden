export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: number;
};

type WindowRecord = {
  times: number[];
  windowMs: number;
};

/**
 * In-process sliding-window counter. Each `hit` records the current time for
 * `key` and rejects when `max` timestamps fall inside `windowMs`.
 */
export class RateLimiter {
  private hits = new Map<string, WindowRecord>();
  private sincePrune = 0;

  hit(key: string, max: number, windowMs: number, now = Date.now()): RateLimitResult {
    this.sincePrune += 1;
    if (this.sincePrune >= 32) {
      this.pruneExpired(now);
    }

    const cutoff = now - windowMs;
    const rec = this.hits.get(key);
    const times = (rec?.times ?? []).filter((t) => t > cutoff);
    const resetAt = times.length ? times[0] + windowMs : now + windowMs;

    if (times.length >= max) {
      this.hits.set(key, { times, windowMs });
      return { ok: false, remaining: 0, resetAt };
    }

    times.push(now);
    this.hits.set(key, { times, windowMs });
    return { ok: true, remaining: max - times.length, resetAt: times[0] + windowMs };
  }

  pruneExpired(now = Date.now()): void {
    this.sincePrune = 0;
    for (const [key, rec] of this.hits) {
      const live = rec.times.filter((t) => t > now - rec.windowMs);
      if (live.length === 0) this.hits.delete(key);
      else rec.times = live;
    }
  }

  size(): number {
    return this.hits.size;
  }
}
