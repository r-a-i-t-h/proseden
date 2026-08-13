export type LiveEventKind =
  | "presence.snapshot"
  | "presence.join"
  | "presence.leave"
  | "presence.move"
  | "chat.say"
  | "chat.shout"
  | "chat.system"
  | "chat.purged";

export interface PresencePerson {
  userKey: string;
  displayName: string;
  sceneId: number;
  lastSeenAt: string;
}

export interface ChatMessage {
  id: string;
  kind: "chat.say" | "chat.shout" | "chat.system";
  ts: string;
  sceneId?: number;
  /** Display title for shouts (where the shouter stood). */
  sceneTitle?: string;
  fromKey?: string;
  fromName?: string;
  text: string;
}

export interface LiveEvent {
  kind: LiveEventKind;
  ts: string;
  /** Scene this event is scoped to (omit for global shout fanout metadata). */
  sceneId?: number;
  person?: PresencePerson;
  fromSceneId?: number;
  toSceneId?: number;
  message?: ChatMessage;
  /** Snapshot payload */
  here?: PresencePerson[];
  messages?: ChatMessage[];
  shouts?: ChatMessage[];
  /** After purge */
  purgedSceneId?: number | "all";
}

export interface PresenceConnection {
  connectionId: string;
  userKey: string;
  displayName: string;
  sceneId: number;
  connectedAt: string;
  lastSeenAt: string;
  /** Optional send callback for SSE; cleared on close. */
  send?: (event: LiveEvent) => void;
}

export const SCENE_BUFFER_MAX = 100;
export const SCENE_BUFFER_TTL_MS = 30 * 60 * 1000;
export const SHOUT_BUFFER_MAX = 50;
export const PRESENCE_IDLE_MS = 3 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 20_000;
