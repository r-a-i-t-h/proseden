import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

const LAG_WINDOW_MS = 10_000;
const SLOW_RING_MAX = 20;
const DEFAULT_SLOW_MS = 500;

const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

const lagReset = setInterval(() => {
  lag.reset();
}, LAG_WINDOW_MS);
lagReset.unref?.();

const timerAls = new AsyncLocalStorage<RequestTimer>();

export type SpanRecord = { name: string; durMs: number };

export class RequestTimer {
  private readonly t0 = performance.now();
  readonly spans: SpanRecord[] = [];

  span<T>(name: string, fn: () => T): T {
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.spans.push({ name, durMs: performance.now() - start });
    }
  }

  async spanAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.spans.push({ name, durMs: performance.now() - start });
    }
  }

  totalMs(): number {
    return performance.now() - this.t0;
  }
}

export function currentTimer(): RequestTimer | undefined {
  return timerAls.getStore();
}

export function runWithTimer<T>(timer: RequestTimer, fn: () => T): T {
  return timerAls.run(timer, fn);
}

export function timed<T>(timer: RequestTimer | undefined, name: string, fn: () => T): T {
  return timer ? timer.span(name, fn) : fn();
}

export async function timedAsync<T>(
  timer: RequestTimer | undefined,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  return timer ? timer.spanAsync(name, fn) : fn();
}

export type ProcessSnapshot = {
  uptimeSec: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  lagP99Ms: number;
  lagMaxMs: number;
};

export type HealthFields = {
  uptimeSec: number;
  rssMb: number;
  lagP99Ms: number;
  lagMaxMs: number;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function nsToMs(ns: number): number {
  if (!Number.isFinite(ns) || ns < 0) return 0;
  return round1(ns / 1e6);
}

export function processSnapshot(): ProcessSnapshot {
  const mem = process.memoryUsage();
  return {
    uptimeSec: Math.round(process.uptime()),
    rssMb: round1(mem.rss / 1024 / 1024),
    heapUsedMb: round1(mem.heapUsed / 1024 / 1024),
    heapTotalMb: round1(mem.heapTotal / 1024 / 1024),
    lagP99Ms: nsToMs(lag.percentile(99)),
    lagMaxMs: nsToMs(lag.max),
  };
}

export function healthFields(): HealthFields {
  const snap = processSnapshot();
  return {
    uptimeSec: snap.uptimeSec,
    rssMb: snap.rssMb,
    lagP99Ms: snap.lagP99Ms,
    lagMaxMs: snap.lagMaxMs,
  };
}

export type SlowRequest = {
  at: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  spans: SpanRecord[];
};

const slowRing: SlowRequest[] = [];

export function recentSlowRequests(): SlowRequest[] {
  return [...slowRing];
}

export function slowMsThreshold(): number {
  const raw = Number(process.env.PROSEDEN_SLOW_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SLOW_MS;
}

export function formatSlowSpans(spans: SpanRecord[]): string {
  return spans.map((s) => `${s.name}=${Math.round(s.durMs)}`).join(" ");
}

export function formatSlowLine(entry: Pick<SlowRequest, "method" | "path" | "status" | "ms" | "spans">): string {
  const extra = formatSlowSpans(entry.spans);
  const line = `${entry.method} ${entry.path} ${entry.status} ${entry.ms}ms`;
  return extra ? `${line} ${extra}` : line;
}

export function recordFinishedRequest(opts: {
  method: string;
  path: string;
  status: number;
  timer: RequestTimer;
}): void {
  const ms = opts.timer.totalMs();
  if (ms < slowMsThreshold()) return;
  const entry: SlowRequest = {
    at: new Date().toISOString(),
    method: opts.method,
    path: opts.path,
    status: opts.status,
    ms: Math.round(ms),
    spans: opts.timer.spans.map((s) => ({ name: s.name, durMs: Math.round(s.durMs) })),
  };
  slowRing.push(entry);
  if (slowRing.length > SLOW_RING_MAX) slowRing.shift();
  if (!process.env.VITEST) {
    console.warn(`[proseden:slow] ${formatSlowLine(entry)}`);
  }
}

export function serverTimingHeader(timer: RequestTimer): string {
  const parts = [
    `app;dur=${timer.totalMs().toFixed(1)}`,
    ...timer.spans.map((s) => `${sanitizeMetric(s.name)};dur=${s.durMs.toFixed(1)}`),
  ];
  return parts.join(", ");
}

function sanitizeMetric(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function isLiveEventsPath(path: string): boolean {
  return path === "/live/events";
}
