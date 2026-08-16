import { randomBytes } from "node:crypto";
import type { PresenceStore } from "./presence.js";
import type { ChatMessage, LiveEvent, PresencePerson } from "./types.js";
import {
  SCENE_BUFFER_MAX,
  SCENE_BUFFER_TTL_MS,
  SHOUT_BUFFER_MAX,
} from "./types.js";

export interface ChatBufferStats {
  sceneId: number | "shouts";
  count: number;
  oldestAt?: string;
  newestAt?: string;
}

/**
 * Scene chat buffers + shout ring + snapshot helper.
 * PresenceStore owns connection fanout; hub owns message linger.
 */
export class SceneHub {
  private sceneBuffers = new Map<number, ChatMessage[]>();
  private shouts: ChatMessage[] = [];

  constructor(private presence: PresenceStore) {
    this.presence.onEvent((event) => {
      if (event.kind === "presence.join" && event.person && event.sceneId !== undefined) {
        this.appendSystem(event.sceneId, event.person, "arrive");
      } else if (event.kind === "presence.leave" && event.person && event.sceneId !== undefined) {
        this.appendSystem(
          event.sceneId,
          event.person,
          event.leaveReason === "logout" ? "logout" : "leave",
        );
      } else if (
        event.kind === "presence.move" &&
        event.person &&
        event.fromSceneId !== undefined &&
        event.toSceneId !== undefined
      ) {
        this.appendSystem(event.fromSceneId, event.person, "leave");
        this.appendSystem(event.toSceneId, event.person, "arrive");
      }
    });
  }

  snapshot(sceneId: number): {
    here: PresencePerson[];
    messages: ChatMessage[];
    shouts: ChatMessage[];
  } {
    this.pruneScene(sceneId);
    this.pruneShouts();
    return {
      here: this.presence.here(sceneId),
      messages: [...(this.sceneBuffers.get(sceneId) ?? [])],
      shouts: [...this.shouts],
    };
  }

  say(opts: {
    sceneId: number;
    fromKey: string;
    fromName: string;
    text: string;
  }): ChatMessage {
    const message = this.makeMessage({
      kind: "chat.say",
      sceneId: opts.sceneId,
      fromKey: opts.fromKey,
      fromName: opts.fromName,
      text: opts.text,
    });
    this.pushScene(opts.sceneId, message);
    const event: LiveEvent = {
      kind: "chat.say",
      ts: message.ts,
      sceneId: opts.sceneId,
      message,
    };
    this.presence.fanout(event, { sceneId: opts.sceneId });
    return message;
  }

  shout(opts: {
    fromKey: string;
    fromName: string;
    text: string;
    sceneId: number;
    sceneTitle?: string;
  }): ChatMessage {
    const message = this.makeMessage({
      kind: "chat.shout",
      fromKey: opts.fromKey,
      fromName: opts.fromName,
      text: opts.text,
      sceneId: opts.sceneId,
      sceneTitle: opts.sceneTitle,
    });
    this.pushShout(message);
    const event: LiveEvent = {
      kind: "chat.shout",
      ts: message.ts,
      message,
    };
    this.presence.fanout(event, { all: true });
    return message;
  }

  purgeScene(sceneId: number): void {
    this.sceneBuffers.delete(sceneId);
    const event: LiveEvent = {
      kind: "chat.purged",
      ts: new Date().toISOString(),
      purgedSceneId: sceneId,
      sceneId,
    };
    this.presence.fanout(event, { sceneId });
  }

  purgeAll(): void {
    this.sceneBuffers.clear();
    this.shouts = [];
    const event: LiveEvent = {
      kind: "chat.purged",
      ts: new Date().toISOString(),
      purgedSceneId: "all",
    };
    this.presence.fanout(event, { all: true });
  }

  bufferStats(): ChatBufferStats[] {
    const out: ChatBufferStats[] = [];
    for (const sceneId of [...this.sceneBuffers.keys()]) {
      this.pruneScene(sceneId);
      const buf = this.sceneBuffers.get(sceneId);
      if (!buf?.length) {
        this.sceneBuffers.delete(sceneId);
        continue;
      }
      out.push({
        sceneId,
        count: buf.length,
        oldestAt: buf[0]?.ts,
        newestAt: buf[buf.length - 1]?.ts,
      });
    }
    this.pruneShouts();
    if (this.shouts.length) {
      out.push({
        sceneId: "shouts",
        count: this.shouts.length,
        oldestAt: this.shouts[0]?.ts,
        newestAt: this.shouts[this.shouts.length - 1]?.ts,
      });
    }
    return out.sort((a, b) => String(a.sceneId).localeCompare(String(b.sceneId)));
  }

  private appendSystem(
    sceneId: number,
    person: PresencePerson,
    systemKind: "arrive" | "leave" | "logout",
  ): void {
    const text =
      systemKind === "arrive"
        ? `${person.displayName} arrives.`
        : systemKind === "logout"
          ? `${person.displayName} logged out.`
          : `${person.displayName} leaves.`;
    const message = this.makeMessage({
      kind: "chat.system",
      sceneId,
      fromKey: person.userKey,
      fromName: person.displayName,
      systemKind,
      text,
    });

    // Consecutive arrive→leave for the same person: fanout leave, but drop both from linger.
    if (
      (systemKind === "leave" || systemKind === "logout") &&
      this.tryCancelArrive(sceneId, person.userKey)
    ) {
      this.presence.fanout(
        { kind: "chat.system", ts: message.ts, sceneId, message },
        { sceneId },
      );
      return;
    }

    this.pushScene(sceneId, message);
    this.presence.fanout(
      { kind: "chat.system", ts: message.ts, sceneId, message },
      { sceneId },
    );
  }

  /** If the last linger line is this person's arrive, pop it and return true. */
  private tryCancelArrive(sceneId: number, userKey: string): boolean {
    this.pruneScene(sceneId);
    const buf = this.sceneBuffers.get(sceneId);
    if (!buf?.length) return false;
    const last = buf[buf.length - 1];
    if (
      last?.kind !== "chat.system" ||
      last.systemKind !== "arrive" ||
      last.fromKey !== userKey
    ) {
      return false;
    }
    buf.pop();
    if (buf.length) this.sceneBuffers.set(sceneId, buf);
    else this.sceneBuffers.delete(sceneId);
    return true;
  }

  private makeMessage(opts: {
    kind: ChatMessage["kind"];
    text: string;
    sceneId?: number;
    sceneTitle?: string;
    fromKey?: string;
    fromName?: string;
    systemKind?: ChatMessage["systemKind"];
  }): ChatMessage {
    return {
      id: randomBytes(8).toString("hex"),
      kind: opts.kind,
      ts: new Date().toISOString(),
      sceneId: opts.sceneId,
      sceneTitle: opts.sceneTitle,
      fromKey: opts.fromKey,
      fromName: opts.fromName,
      systemKind: opts.systemKind,
      text: opts.text.slice(0, 2000),
    };
  }

  private pushScene(sceneId: number, message: ChatMessage): void {
    this.pruneScene(sceneId);
    const buf = this.sceneBuffers.get(sceneId) ?? [];
    buf.push(message);
    while (buf.length > SCENE_BUFFER_MAX) buf.shift();
    if (buf.length) this.sceneBuffers.set(sceneId, buf);
    else this.sceneBuffers.delete(sceneId);
  }

  private pushShout(message: ChatMessage): void {
    this.pruneShouts();
    this.shouts.push(message);
    while (this.shouts.length > SHOUT_BUFFER_MAX) this.shouts.shift();
  }

  private pruneScene(sceneId: number): void {
    const buf = this.sceneBuffers.get(sceneId);
    if (!buf) return;
    const cutoff = Date.now() - SCENE_BUFFER_TTL_MS;
    const kept = buf.filter((m) => Date.parse(m.ts) >= cutoff);
    if (kept.length) this.sceneBuffers.set(sceneId, kept);
    else this.sceneBuffers.delete(sceneId);
  }

  private pruneShouts(): void {
    const cutoff = Date.now() - SCENE_BUFFER_TTL_MS;
    this.shouts = this.shouts.filter((m) => Date.parse(m.ts) >= cutoff);
  }
}
