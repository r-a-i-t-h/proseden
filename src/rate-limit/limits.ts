export type RateLimitBucket = {
  max: number;
  windowMs: number;
};

export type RateLimitConfig = {
  auth: RateLimitBucket;
  liveChat: RateLimitBucket;
  liveSse: RateLimitBucket;
  peerMail: RateLimitBucket;
  writes: RateLimitBucket;
};

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  auth: { max: 5, windowMs: 15 * 60 * 1000 },
  liveChat: { max: 8, windowMs: 10_000 },
  liveSse: { max: 10, windowMs: 60_000 },
  peerMail: { max: 10, windowMs: 60_000 },
  writes: { max: 60, windowMs: 60_000 },
};

export function mergeRateLimits(overrides?: Partial<RateLimitConfig>): RateLimitConfig {
  return {
    auth: { ...DEFAULT_RATE_LIMITS.auth, ...overrides?.auth },
    liveChat: { ...DEFAULT_RATE_LIMITS.liveChat, ...overrides?.liveChat },
    liveSse: { ...DEFAULT_RATE_LIMITS.liveSse, ...overrides?.liveSse },
    peerMail: { ...DEFAULT_RATE_LIMITS.peerMail, ...overrides?.peerMail },
    writes: { ...DEFAULT_RATE_LIMITS.writes, ...overrides?.writes },
  };
}
