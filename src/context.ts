import type { SessionStore } from "./auth/sessions.js";
import type { WorldStore } from "./store/world.js";
import type { UserRecord } from "./model/types.js";

export type AppVariables = {
  world: WorldStore;
  sessions: SessionStore;
  user?: UserRecord;
  assetBase: string;
};

declare module "hono" {
  interface ContextVariableMap extends AppVariables {}
}
