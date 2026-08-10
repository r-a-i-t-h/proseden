import type { SessionStore } from "./auth/sessions.js";
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
};

declare module "hono" {
  interface ContextVariableMap extends AppVariables {}
}
