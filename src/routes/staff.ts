import { Hono } from "hono";
import type { Context } from "hono";
import { isManager } from "../access/permissions.js";
import {
  aliasFormMethods,
  apiError,
  page,
  parseEnabledFlag,
  readRequestBody,
  respondMutation,
  sceneBackLink,
  wantsJson,
} from "../http.js";
import { prepareJsonTextarea } from "../json-textarea.js";
import type { InboxMessage, StaffRole } from "../model/types.js";
import {
  formatSlowLine,
  processSnapshot,
  recentSlowRequests,
  slowMsThreshold,
} from "../observe.js";
import { negotiateFormat } from "../render/format.js";
import {
  dashboardPageView,
  formatPlainMessage,
  msgPageView,
  staffPageView,
} from "../render/view/index.js";
import { updateSetting } from "../store/settings.js";

export const staffRoutes = new Hono();

staffRoutes.get("/dashboard", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const counts = world.overviewCounts();
  const presence = c.get("presence");
  const online = presence.online().length;
  const sseConnections = presence.connectionCount();
  const snap = processSnapshot();
  const slowMs = slowMsThreshold();
  const slowRequests = recentSlowRequests();
  const processStats = {
    ...snap,
    sseConnections,
    slowMs,
    slowLines: slowRequests.map((entry) => `${entry.at} ${formatSlowLine(entry)}`),
  };
  if (wantsJson(c)) {
    return c.json({
      ok: true,
      ...counts,
      online,
      sseConnections,
      ...snap,
      slowMs,
      slowRequests,
    });
  }
  const back = sceneBackLink(user!, world);
  return page(c, 200, dashboardPageView({ counts, online, process: processStats, back }));
});

staffRoutes.get("/msg", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const usernames = world.listUsers().map((u) => u.username);
  const peerMessagingEnabled = world.isPeerMessagingEnabled();
  const notice =
    msgSentNotice(c.req.query("sent"), c.req.query("n")) ??
    msgPeerNotice(c.req.query("peer")) ??
    msgPurgeNotice(c.req.query("purged"), c.req.query("from"), c.req.query("n"));
  if (wantsJson(c)) {
    return c.json({
      users: usernames,
      all: "*",
      peerMessagingEnabled,
      ...(notice ? { notice } : {}),
    });
  }
  const back = sceneBackLink(user!, world);
  return page(c, 200, msgPageView({ usernames, notice, back, peerMessagingEnabled }));
});

staffRoutes.post("/msg/peer-messaging", async (c) => setPeerMessaging(c));
staffRoutes.post("/msg/purge-from", async (c) => purgeInboxFromUser(c));
staffRoutes.post("/msg", async (c) => sendManagerMessage(c));

async function setPeerMessaging(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const body = await readRequestBody(c);
  const raw = body.enabled ?? body.peerMessagingEnabled;
  const settings = await updateSetting(world, "peerMessagingEnabled", parseEnabledFlag(raw));
  return respondMutation(c, {
    json: { ok: true, peerMessagingEnabled: settings.peerMessagingEnabled },
    redirect: "/msg",
    flash: { peer: settings.peerMessagingEnabled ? "on" : "off" },
  });
}

async function purgeInboxFromUser(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const body = await readRequestBody(c);
  const uid = String(body.uid ?? "").trim();
  const usernames = world.listUsers().map((u) => u.username);
  const peerMessagingEnabled = world.isPeerMessagingEnabled();

  const fail = (error: string) => {
    if (wantsJson(c) || negotiateFormat(c) === "text") {
      return apiError(c, 400, error);
    }
    const back = sceneBackLink(user!, world);
    return page(
      c,
      400,
      msgPageView({ usernames, error, back, peerMessagingEnabled }),
    );
  };

  if (!uid) return fail("Username is required.");
  const deleted = await world.deleteInboxFromUser(uid);
  if (wantsJson(c)) {
    return c.json({ ok: true, uid, deleted });
  }
  return c.redirect(
    `${c.get("assetBase")}/msg?purged=1&from=${encodeURIComponent(uid)}&n=${deleted}`,
  );
}

async function sendManagerMessage(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const body = await readRequestBody(c);
  const toRaw = String(body.to ?? body.toUser ?? "").trim();
  const text = typeof body.body === "string" ? body.body : String(body.body ?? "");
  const trimmed = text.trim();
  const usernames = world.listUsers().map((u) => u.username);

  const fail = (error: string) => {
    if (wantsJson(c) || negotiateFormat(c) === "text") {
      return apiError(c, 400, error);
    }
    const back = sceneBackLink(user!, world);
    return page(
      c,
      400,
      msgPageView({
        usernames,
        selected: toRaw,
        body: text,
        error,
        back,
        peerMessagingEnabled: world.isPeerMessagingEnabled(),
      }),
    );
  };

  if (!toRaw) return fail("Choose a recipient.");
  if (!trimmed) return fail("Message is required.");

  const all = toRaw === "*" || /^all(?:\s+users)?$/i.test(toRaw);
  let recipients: string[];
  if (all) {
    if (!usernames.length) return fail("No users to message.");
    recipients = usernames;
  } else if (!world.getUser(toRaw)) {
    return fail(`User not found: ${toRaw}`);
  } else {
    recipients = [toRaw];
  }

  const subject = `Manager message from ${user!.username}`;
  const sentTo: string[] = [];
  const messages: InboxMessage[] = [];
  try {
    for (const toUser of recipients) {
      const message = await world.createInboxMessage({
        type: "notice",
        toUser,
        fromUser: user!.username,
        subject,
        body: trimmed,
      });
      messages.push(message);
      sentTo.push(toUser);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Could not send message";
    const partial = sentTo.length
      ? ` Sent to ${sentTo.length} of ${recipients.length} before failing.`
      : "";
    return fail(`${detail}.${partial}`);
  }

  if (wantsJson(c)) {
    return c.json({ ok: true, to: sentTo, count: sentTo.length, messages }, 201);
  }
  const summary = msgDeliveredSummary(all, sentTo);
  if (negotiateFormat(c) === "text") {
    return c.text(formatPlainMessage("Msg", summary), 201);
  }
  const qs = all
    ? `sent=all&n=${sentTo.length}`
    : `sent=${encodeURIComponent(sentTo[0]!)}`;
  return c.redirect(`${c.get("assetBase")}/msg?${qs}`);
}

function msgSentNotice(sent?: string, nRaw?: string): string | undefined {
  if (!sent) return undefined;
  if (sent === "all") {
    const n = Number(nRaw);
    const count = Number.isFinite(n) && n > 0 ? n : 0;
    return `Message sent to all ${count} ${count === 1 ? "user" : "users"}.`;
  }
  return `Message sent to ${sent}.`;
}

function msgPeerNotice(peer?: string): string | undefined {
  if (peer === "on") return "Peer messaging enabled.";
  if (peer === "off") return "Peer messaging disabled.";
  return undefined;
}

function msgPurgeNotice(purged?: string, from?: string, nRaw?: string): string | undefined {
  if (!purged) return undefined;
  const n = Number(nRaw);
  const count = Number.isFinite(n) && n >= 0 ? n : 0;
  const who = from?.trim() || "user";
  return `Deleted ${count} ${count === 1 ? "message" : "messages"} from ${who}.`;
}

function msgDeliveredSummary(all: boolean, sentTo: string[]): string {
  if (all) {
    const n = sentTo.length;
    return `Message sent to all ${n} ${n === 1 ? "user" : "users"}.`;
  }
  return `Message sent to ${sentTo[0]}.`;
}

staffRoutes.get("/staff", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  if (wantsJson(c)) return c.json(world.staff);
  const back = user ? sceneBackLink(user, world) : undefined;
  return page(c, 200, staffPageView({ roles: world.staff.roles, back }));
});

aliasFormMethods(staffRoutes, "put", "/staff/:username", (c) => setStaff(c));

async function setStaff(c: Context) {
  const world = c.get("world");
  const user = c.get("user");
  if (!isManager(user, world)) {
    return apiError(c, user ? 403 : 401, "Manager role required");
  }
  const username = String(c.req.param("username") ?? "");
  const body = await readRequestBody(c);
  let roles: StaffRole[] = [];
  if (Array.isArray(body.roles)) {
    roles = body.roles.map(String) as StaffRole[];
  } else if (typeof body.roles === "string") {
    roles = body.roles.split(",").map((s) => s.trim()).filter(Boolean) as StaffRole[];
  } else if (typeof body.rolesJson === "string") {
    try {
      roles = JSON.parse(prepareJsonTextarea(body.rolesJson)) as StaffRole[];
    } catch {
      return apiError(c, 400, "Invalid rolesJson");
    }
  }
  try {
    const before = world.rolesFor(username);
    const staff = await world.setStaffRoles(username, roles);
    const after = staff.roles[username] ?? [];
    if (!sameStaffRoles(before, after)) {
      await world.createInboxMessage({
        type: "notice",
        toUser: username,
        fromUser: user!.username,
        subject: `Role change from ${user!.username}`,
        body: staffRoleChangeBody(user!.username, after),
      });
    }
    return respondMutation(c, { json: { username, roles: after }, redirect: `/staff` });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not set roles");
  }
}

function sameStaffRoles(a: StaffRole[], b: StaffRole[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((role, i) => role === right[i]);
}

function staffRoleChangeBody(manager: string, roles: StaffRole[]): string {
  if (!roles.length) {
    return `${manager} removed your staff roles.`;
  }
  return `${manager} set your staff roles to: ${roles.join(", ")}.`;
}
