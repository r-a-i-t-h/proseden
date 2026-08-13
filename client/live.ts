import { mergeChatTimeline } from "../src/live/types.js";
import type { EditBootstrap } from "./edit.js";

interface PresencePerson {
  userKey: string;
  displayName: string;
  sceneId: number;
  lastSeenAt: string;
}

interface ChatMessage {
  id: string;
  kind: string;
  ts: string;
  fromName?: string;
  sceneTitle?: string;
  sceneId?: number;
  text: string;
}

interface LiveEvent {
  kind: string;
  here?: PresencePerson[];
  messages?: ChatMessage[];
  shouts?: ChatMessage[];
  person?: PresencePerson;
  message?: ChatMessage;
  fromSceneId?: number;
  toSceneId?: number;
  purgedSceneId?: number | "all";
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export interface LiveController {
  connect: () => void;
  disconnect: () => void;
  destroy: () => void;
}

/**
 * Mount live UI once into `pane`. SSE starts via connect() and stays up across Live↔Edit.
 */
export function mountLive(boot: EditBootstrap, pane: HTMLElement): LiveController {
  const sceneId = boot.liveSceneId;
  const selfKey = boot.user ? `u:${boot.user.username}` : undefined;

  const hereList = el("ul", { class: "live-here" });
  const onlineList = el("ul", { class: "live-online" });
  const log = el("div", { class: "live-log", "aria-live": "polite" });
  const status = el("p", { class: "live-status muted" });
  const sayInput = el("input", {
    type: "text",
    name: "say",
    maxlength: "2000",
    placeholder: "Say…",
    autocomplete: "off",
  }) as HTMLInputElement;
  const shoutInput = el("input", {
    type: "text",
    name: "shout",
    maxlength: "2000",
    placeholder: "Shout…",
    autocomplete: "off",
  }) as HTMLInputElement;

  const sayForm = el("form", { class: "live-compose" }, sayInput, el("button", { type: "submit" }, "Say"));
  const shoutForm = el(
    "form",
    { class: "live-compose" },
    shoutInput,
    el("button", { type: "submit" }, "Shout"),
  );

  sayForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = sayInput.value.trim();
    if (!text) return;
    sayInput.value = "";
    try {
      await postJson("live/say", { text });
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "Say failed";
    }
  });
  shoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = shoutInput.value.trim();
    if (!text) return;
    shoutInput.value = "";
    try {
      await postJson("live/shout", { text });
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : "Shout failed";
    }
  });

  const purgeBtn = boot.isModerator
    ? el("button", { type: "button", class: "edit-danger live-purge" }, "Purge this scene")
    : null;
  if (purgeBtn && sceneId !== undefined) {
    purgeBtn.addEventListener("click", async () => {
      if (!window.confirm("Clear the in-memory chat buffer for this scene?")) return;
      try {
        await postJson("live/purge", { sceneId });
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : "Purge failed";
      }
    });
  }

  pane.replaceChildren(
    el("h3", { class: "live-heading" }, "Who's here"),
    hereList,
    el("details", { class: "live-online-wrap" }, el("summary", {}, "Online"), onlineList),
    el("h3", { class: "live-heading" }, "Chat"),
    log,
    sayForm,
    shoutForm,
    status,
    ...(purgeBtn ? [purgeBtn] : []),
  );

  let source: EventSource | null = null;
  let seenIds = new Set<string>();

  function appendMessage(msg: ChatMessage): void {
    if (seenIds.has(msg.id)) return;
    seenIds.add(msg.id);
    const line = el("div", { class: `live-line live-${msg.kind.replace(".", "-")}` });
    line.append(el("span", { class: "live-time" }, formatTime(msg.ts)), document.createTextNode(" "));
    if (msg.kind === "chat.system") {
      line.append(el("span", { class: "live-system" }, msg.text));
    } else if (msg.kind === "chat.shout") {
      const fromWhere = msg.sceneTitle
        ? `Shout from ${msg.sceneTitle}`
        : msg.sceneId !== undefined
          ? `Shout from Scene ${msg.sceneId}`
          : "Shout";
      line.append(
        el("span", { class: "live-shout-label" }, fromWhere),
        document.createTextNode(" "),
        el("strong", {}, msg.fromName ?? "?"),
        document.createTextNode(`: ${msg.text}`),
      );
    } else {
      line.append(el("strong", {}, msg.fromName ?? "?"), document.createTextNode(`: ${msg.text}`));
    }
    log.append(line);
    log.scrollTop = log.scrollHeight;
  }

  function renderHere(people: PresencePerson[]): void {
    hereList.replaceChildren();
    for (const p of people) {
      const row = el("li", {}, p.displayName);
      if (selfKey && p.userKey !== selfKey && boot.user) {
        row.append(
          document.createTextNode(" "),
          el("a", { href: `live/join/${encodeURIComponent(p.userKey)}` }, "Join"),
        );
      }
      hereList.append(row);
    }
    if (!people.length) hereList.append(el("li", { class: "muted" }, "No one else here."));
  }

  async function refreshOnline(): Promise<void> {
    if (!boot.user) {
      onlineList.replaceChildren(el("li", { class: "muted" }, "Sign in to see everyone online."));
      return;
    }
    try {
      const res = await fetch("live/online", { headers: { Accept: "application/json" } });
      const data = (await res.json()) as { online?: PresencePerson[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      onlineList.replaceChildren();
      for (const p of data.online ?? []) {
        if (selfKey && p.userKey === selfKey) continue;
        const label = `${p.displayName} · s/${p.sceneId}`;
        const row = el(
          "li",
          {},
          label,
          document.createTextNode(" "),
          el("a", { href: `live/join/${encodeURIComponent(p.userKey)}` }, "Join"),
        );
        onlineList.append(row);
      }
      if (!onlineList.childNodes.length) {
        onlineList.append(el("li", { class: "muted" }, "No one else online."));
      }
    } catch (err) {
      onlineList.replaceChildren(
        el("li", { class: "muted" }, err instanceof Error ? err.message : "Could not load online list"),
      );
    }
  }

  function handleEvent(event: LiveEvent): void {
    if (event.kind === "presence.snapshot") {
      seenIds = new Set();
      log.replaceChildren();
      for (const m of mergeChatTimeline(event.messages ?? [], event.shouts ?? [])) {
        appendMessage(m);
      }
      renderHere(event.here ?? []);
      void refreshOnline();
      status.textContent = "Connected";
      return;
    }
    if (event.kind === "presence.join" || event.kind === "presence.leave" || event.kind === "presence.move") {
      void refreshOnline();
      // Snapshot-shaped here list is refreshed via system lines + optional poll; fetch here.
      if (sceneId !== undefined) {
        void fetch(`live/here?scene=${sceneId}`, { headers: { Accept: "application/json" } })
          .then((r) => r.json())
          .then((data: { here?: PresencePerson[] }) => renderHere(data.here ?? []))
          .catch(() => undefined);
      }
      return;
    }
    if (event.message) appendMessage(event.message);
    if (event.kind === "chat.purged") {
      if (event.purgedSceneId === "all" || event.purgedSceneId === sceneId) {
        seenIds = new Set();
        log.replaceChildren();
        status.textContent = "Chat purged";
      }
    }
  }

  function connect(): void {
    if (sceneId === undefined || source) return;
    status.textContent = "Connecting…";
    const es = new EventSource(`live/events?scene=${sceneId}`);
    source = es;
    const kinds = [
      "presence.snapshot",
      "presence.join",
      "presence.leave",
      "presence.move",
      "chat.say",
      "chat.shout",
      "chat.system",
      "chat.purged",
    ];
    for (const kind of kinds) {
      es.addEventListener(kind, (ev) => {
        try {
          handleEvent(JSON.parse((ev as MessageEvent).data) as LiveEvent);
        } catch {
          /* ignore */
        }
      });
    }
    es.onerror = () => {
      status.textContent = "Reconnecting…";
    };
  }

  function disconnect(): void {
    if (source) {
      source.close();
      source = null;
    }
    status.textContent = "Offline (View)";
    hereList.replaceChildren(el("li", { class: "muted" }, "—"));
  }

  function destroy(): void {
    disconnect();
  }

  window.addEventListener("pageshow", (ev) => {
    if (ev.persisted && source) {
      disconnect();
      connect();
    }
  });

  if (sceneId === undefined) {
    pane.replaceChildren(el("p", { class: "muted" }, "Live is available on scene pages."));
  }

  return { connect, disconnect, destroy };
}

async function postJson(action: string, body: unknown): Promise<void> {
  const res = await fetch(action, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? res.statusText);
}

/** Local wall-clock HH:MM:SS from an ISO timestamp. */
function formatTime(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
