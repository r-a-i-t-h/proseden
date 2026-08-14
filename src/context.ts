import type { SessionStore } from "./auth/sessions.js";
import type { SceneHub } from "./live/hub.js";
import type { LocationTracker } from "./live/location.js";
import type { PresenceStore } from "./live/presence.js";
import type { RateLimitConfig } from "./rate-limit/limits.js";
import type { RateLimiter } from "./rate-limit/limiter.js";
import type { WorldStore } from "./store/world.js";
import type { UserRecord } from "./model/types.js";

export type AppVariables = {
  world: WorldStore;
  sessions: SessionStore;
  user?: UserRecord;
  /** Normalized URL prefix, e.g. "" or "/proseden" */
  assetBase: string;
  /** Cookie name scoped to assetBase so multiple mounts on one domain do not clash */
  sessionCookieName: string;
  /** Timestamped data archives; sibling of data/ by default */
  backupDir: string;
  presence: PresenceStore;
  hub: SceneHub;
  locations: LocationTracker;
  rateLimiter: RateLimiter;
  rateLimits: RateLimitConfig;
};

declare module "hono" {
  interface ContextVariableMap extends AppVariables {}
}
