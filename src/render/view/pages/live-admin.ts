import {
  button,
  form,
  heading,
  muted,
  nodes,
  pageView,
  rawText,
  table,
  textOnly,
  userLink,
} from "../factories.js";
import type { Node, PageView } from "../types.js";
import { backCrumb, type PageBackLink } from "./profile.js";

export type LiveAdminUser = {
  username: string;
  userKey: string;
  lastSeenAt?: string;
  lastSceneId?: number;
  sceneTitle?: string;
  live: boolean;
};

export type LiveAdminBuffer = {
  sceneId: number | "shouts";
  sceneTitle?: string;
  count: number;
  oldestAt?: string;
  newestAt?: string;
};

export type LiveAdminSecurity = {
  guestLiveEnabled: boolean;
  liveChatEnabled: boolean;
  registrationEnabled: boolean;
  nonManagerEditingEnabled: boolean;
  nonManagerViewEnabled: boolean;
};

function securityToggle(opts: {
  enabled: boolean;
  action: string;
  onHelp: string;
  offHelp: string;
  disableLabel: string;
  enableLabel: string;
}): Node {
  return {
    type: "fragment",
    children: [
      muted(opts.enabled ? opts.onHelp : opts.offHelp),
      form(
        { method: "post", action: opts.action, class: "stack" },
        { type: "field", label: "", control: { type: "hidden", name: "enabled", value: opts.enabled ? "false" : "true" } },
        button(opts.enabled ? opts.disableLabel : opts.enableLabel, {
          class: opts.enabled ? "edit-danger" : undefined,
        }),
      ),
    ],
  };
}

export function liveAdminPageView(opts: {
  users: LiveAdminUser[];
  buffers: LiveAdminBuffer[];
  back?: PageBackLink;
  security?: LiveAdminSecurity;
}): PageView {
  const userRows = opts.users.map((u) => {
    const name: Node = u.userKey.startsWith("g:")
      ? { type: "para", text: u.username }
      : userLink(u.username);
    const loc =
      u.lastSceneId !== undefined
        ? `${u.sceneTitle ?? "Untitled"} (#${u.lastSceneId})`
        : "—";
    const kick: Node = u.live
      ? form(
          { method: "post", action: "live/admin/kick", class: "live-admin-kick" },
          { type: "field", label: "", control: { type: "hidden", name: "userKey", value: u.userKey } },
          button("Kick"),
        )
      : { type: "para", text: "" };
    return {
      cells: [
        {
          type: "fragment" as const,
          children: [name, u.live ? muted("live") : undefined].filter(Boolean) as Node[],
        },
        u.lastSeenAt
          ? { type: "muted" as const, parts: [{ type: "relativeAge" as const, iso: u.lastSeenAt }] }
          : { type: "para" as const, text: "—" },
        { type: "para" as const, text: loc },
        kick,
      ],
    };
  });

  const bufRows = opts.buffers.map((b) => {
    const label =
      b.sceneId === "shouts" ? "Shouts" : `${b.sceneTitle ?? "Untitled"} (#${b.sceneId})`;
    return {
      cells: [
        { type: "para" as const, text: label },
        { type: "para" as const, text: String(b.count) },
        b.oldestAt
          ? { type: "muted" as const, parts: [{ type: "relativeAge" as const, iso: b.oldestAt }] }
          : { type: "para" as const, text: "—" },
        b.newestAt
          ? { type: "muted" as const, parts: [{ type: "relativeAge" as const, iso: b.newestAt }] }
          : { type: "para" as const, text: "—" },
      ],
    };
  });

  const security = opts.security;
  const securityNodes = security
    ? nodes(
        heading(2, "Security"),
        muted("Manager-only kill switches for abuse response. Existing sessions may linger briefly."),
        heading(3, "Live"),
        securityToggle({
          enabled: security.guestLiveEnabled,
          action: "live/admin/guest-live",
          onHelp: "Guests may open Live on public scenes. Disable if anonymous presence or chat becomes abusive.",
          offHelp: "Guest Live is off. Only signed-in readers can connect.",
          disableLabel: "Disable guest live",
          enableLabel: "Enable guest live",
        }),
        securityToggle({
          enabled: security.liveChatEnabled,
          action: "live/admin/live-chat",
          onHelp: "Say and shout are allowed. Disable to keep presence while blocking new chat.",
          offHelp: "Live chat is off. Presence and join still work; say and shout are blocked.",
          disableLabel: "Disable live chat",
          enableLabel: "Enable live chat",
        }),
        heading(3, "Access"),
        securityToggle({
          enabled: security.registrationEnabled,
          action: "live/admin/registration",
          onHelp: "Anyone may create an account. Disable to stop new sign-ups during abuse.",
          offHelp: "New registrations are off. Existing accounts may still log in.",
          disableLabel: "Disable registration",
          enableLabel: "Enable registration",
        }),
        securityToggle({
          enabled: security.nonManagerEditingEnabled,
          action: "live/admin/non-manager-editing",
          onHelp:
            "Signed-in readers may edit scenes, artefacts, exits, and profile when they have rights.",
          offHelp:
            "Editing is off for non-managers. Gameplay, chat, and inbox still work; only managers may change content.",
          disableLabel: "Disable non-manager editing",
          enableLabel: "Enable non-manager editing",
        }),
        securityToggle({
          enabled: security.nonManagerViewEnabled,
          action: "live/admin/non-manager-view",
          onHelp: "The site is readable as usual.",
          offHelp:
            "The site is closed to non-managers. Only managers may view pages; others see a login screen.",
          disableLabel: "Close site to non-managers",
          enableLabel: "Open site to non-managers",
        }),
      )
    : [];

  const textLines = [
    "Live admin",
    "",
    "Users:",
    ...opts.users.map(
      (u) =>
        `- ${u.username}${u.live ? " [live]" : ""} · last ${u.lastSeenAt ?? "—"} · scene ${u.lastSceneId ?? "—"} ${u.sceneTitle ?? ""}`,
    ),
    "",
    "Buffers:",
    ...opts.buffers.map(
      (b) =>
        `- ${b.sceneId} ${b.sceneTitle ?? ""} · ${b.count} msgs · oldest ${b.oldestAt ?? "—"} · newest ${b.newestAt ?? "—"}`,
    ),
    "",
    "Kick: POST /live/admin/kick { userKey }",
    "Purge all: POST /live/admin/purge",
  ];
  if (security) {
    textLines.push(
      "",
      "Security (manager):",
      `- guest live: ${security.guestLiveEnabled ? "on" : "off"} — POST /live/admin/guest-live { enabled }`,
      `- live chat: ${security.liveChatEnabled ? "on" : "off"} — POST /live/admin/live-chat { enabled }`,
      `- registration: ${security.registrationEnabled ? "on" : "off"} — POST /live/admin/registration { enabled }`,
      `- non-manager editing: ${security.nonManagerEditingEnabled ? "on" : "off"} — POST /live/admin/non-manager-editing { enabled }`,
      `- non-manager view: ${security.nonManagerViewEnabled ? "on" : "off"} — POST /live/admin/non-manager-view { enabled }`,
    );
  }

  return pageView(
    "Live admin",
    nodes(
      backCrumb(opts.back),
      heading(1, "Live admin"),
      muted(
        "Recently seen users and in-memory chat buffer stats (no message text). Kick drops a live connection immediately.",
      ),
      heading(2, "Users"),
      table(["User", "Last seen", "Location", ""], userRows, {
        class: "live-admin-table",
        empty: "None yet",
      }),
      heading(2, "Chat buffers"),
      table(["Scene", "Count", "Oldest", "Newest"], bufRows, {
        class: "live-admin-table",
        empty: "Empty",
      }),
      form(
        { method: "post", action: "live/admin/purge", class: "stack" },
        button("Purge all chats", { class: "edit-danger" }),
      ),
      ...securityNodes,
      textOnly(rawText(textLines)),
    ),
  );
}
