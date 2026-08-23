import { Hono } from "hono";
import type { Context } from "hono";
import { canAddExit, canRead } from "../access/permissions.js";
import {
  aliasFormMethods,
  apiError,
  isResponse,
  page,
  readRequestBody,
  requireUser,
  respondMutation,
  sceneBackLink,
  wantsJson,
} from "../http.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { negotiateFormat } from "../render/format.js";
import { formatPlainMessage, inboxPageView, messagePageView } from "../render/view/index.js";
import { PEER_MESSAGE_MAX, sceneLabel } from "./helpers.js";

const peerMailLimit = rateLimit({
  name: "peer-mail",
  bucket: (limits) => limits.peerMail,
  key: (c) => {
    const user = c.get("user");
    return user ? `user:${user.username}` : `ip:unknown`;
  },
});

export const inboxRoutes = new Hono();

inboxRoutes.get("/inbox", (c) => {
  const world = c.get("world");
  const user = c.get("user");
  if (!user) {
    return page(c, 401, messagePageView("Messages", "Log in to view your messages."));
  }

  const flash = c.req.query("confirmed")
    ? "Exit confirmed."
    : c.req.query("deleted")
      ? "Message deleted."
      : c.req.query("sent")
        ? "Message sent."
        : undefined;
  const peerMessagingEnabled = world.isPeerMessagingEnabled();
  const messages = world.listInboxFor(user.username);
  const back = sceneBackLink(user, world);
  const composeTo = String(c.req.query("to") ?? "").trim();
  if (wantsJson(c)) {
    return c.json({ messages, peerMessagingEnabled });
  }
  return page(
    c,
    200,
    inboxPageView({
      messages,
      message: flash,
      back,
      peerMessagingEnabled,
      composeTo: composeTo || undefined,
    }),
  );
});

inboxRoutes.post("/inbox/send", peerMailLimit, async (c) => sendPeerMessage(c));
inboxRoutes.post("/inbox/:id/confirm", async (c) => confirmInboxMessage(c));
aliasFormMethods(inboxRoutes, "delete", "/inbox/:id", (c) => deleteInboxMessage(c));

async function sendPeerMessage(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const body = await readRequestBody(c);
  const toRaw = String(body.uid ?? "").trim();
  const text = typeof body.body === "string" ? body.body : String(body.body ?? "");
  const trimmed = text.trim();

  const fail = (status: 400 | 403 | 404, error: string) => {
    if (wantsJson(c) || negotiateFormat(c) === "text") {
      return apiError(c, status, error);
    }
    const back = sceneBackLink(user, world);
    return page(
      c,
      status,
      inboxPageView({
        messages: world.listInboxFor(user.username),
        error,
        back,
        peerMessagingEnabled: world.isPeerMessagingEnabled(),
        composeTo: toRaw,
        composeBody: text,
      }),
    );
  };

  if (!world.isPeerMessagingEnabled()) {
    return fail(403, "Peer messaging is disabled.");
  }
  if (!toRaw) return fail(400, "Choose a recipient.");
  if (toRaw === user.username) return fail(400, "You cannot message yourself.");
  if (!world.getUser(toRaw)) return fail(404, `User not found: ${toRaw}`);
  if (!trimmed) return fail(400, "Message is required.");

  const bodyText =
    trimmed.length > PEER_MESSAGE_MAX ? trimmed.slice(0, PEER_MESSAGE_MAX) : trimmed;
  const subject = `Personal message from ${user.username}`;

  try {
    const message = await world.createInboxMessage({
      type: "message",
      toUser: toRaw,
      fromUser: user.username,
      subject,
      body: bodyText,
    });
    if (wantsJson(c)) return c.json({ ok: true, message }, 201);
    if (negotiateFormat(c) === "text") {
      return c.text(formatPlainMessage("Messages", `Message sent to ${toRaw}.`), 201);
    }
    return c.redirect(`${c.get("assetBase")}/inbox?sent=1`);
  } catch (err) {
    return fail(400, err instanceof Error ? err.message : "Could not send message");
  }
}

async function confirmInboxMessage(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const message = world.getInboxMessage(id);
  if (!message || message.toUser !== user.username) {
    return apiError(c, 404, "Inbox message not found");
  }
  if (message.type !== "exit_request") {
    return apiError(c, 400, "Only exit requests can be confirmed");
  }

  const origin = world.getScene(message.fromSceneId);
  if (!origin) return apiError(c, 404, "Origin scene not found");
  if (!canAddExit(user, origin, world)) {
    return apiError(c, 403, "Not allowed to add exits from this scene");
  }

  const dest = world.getScene(message.toSceneId);
  if (!dest) return apiError(c, 404, "Destination scene not found");
  if (!canRead(user, dest, world)) {
    return apiError(c, 403, "Destination must be reachable");
  }

  try {
    const exit = await world.addExit(message.fromSceneId, message.nickname, message.toSceneId);
    await world.deleteInboxMessage(message.id);
    const notice = await world.createInboxMessage({
      type: "notice",
      toUser: message.fromUser,
      fromUser: user.username,
      subject: `Exit confirmed: ${message.nickname}`,
      body: [
        `${user.username} confirmed your exit request.`,
        `Exit "${message.nickname}" now leads from ${sceneLabel(origin)} to ${sceneLabel(dest)}.`,
      ].join("\n\n"),
    });
    return respondMutation(c, {
      json: { exit, notice },
      redirect: "/inbox",
      flash: { confirmed: "1" },
    });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not confirm exit request");
  }
}

async function deleteInboxMessage(c: Context) {
  const world = c.get("world");
  const user = requireUser(c);
  if (isResponse(user)) return user;

  const id = Number(c.req.param("id"));
  const message = world.getInboxMessage(id);
  if (!message || message.toUser !== user.username) {
    return apiError(c, 404, "Inbox message not found");
  }

  try {
    await world.deleteInboxMessage(id);
    return respondMutation(c, {
      json: { ok: true, id },
      redirect: "/inbox",
      flash: { deleted: "1" },
    });
  } catch (err) {
    return apiError(c, 400, err instanceof Error ? err.message : "Could not delete message");
  }
}
